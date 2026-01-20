// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/html/atom"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	util2 "github.com/88250/lute/util"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func HTML2Markdown(htmlStr string, luteEngine *lute.Lute) (markdown string, withMath bool, err error) {
	tree, withMath := HTML2Tree(htmlStr, luteEngine)

	var formatted []byte
	renderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	for nodeType, rendererFunc := range luteEngine.HTML2MdRendererFuncs {
		renderer.ExtRendererFuncs[nodeType] = rendererFunc
	}
	formatted = renderer.Render()
	markdown = gulu.Str.FromBytes(formatted)
	return
}

func HTML2Tree(htmlStr string, luteEngine *lute.Lute) (tree *parse.Tree, withMath bool) {
	htmlStr = gulu.Str.RemovePUA(htmlStr)
	assetDirPath := filepath.Join(util.DataDir, "assets")
	tree = luteEngine.HTML2Tree(htmlStr)
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		switch n.Type {
		case ast.NodeHTMLBlock:
			if bytes.HasPrefix(n.Tokens, []byte("<pre ")) && bytes.HasSuffix(n.Tokens, []byte("</pre>")) {
				if bytes.Contains(n.Tokens, []byte("data:image/svg+xml;base64")) {
					matches := regexp.MustCompile(`(?sU)<pre [^>]*>(.*)</pre>`).FindSubmatch(n.Tokens)
					if len(matches) >= 2 {
						n.Tokens = matches[1]
					}
					subTree := parse.Inline("", n.Tokens, luteEngine.ParseOptions)
					if nil != subTree && nil != subTree.Root && nil != subTree.Root.FirstChild {
						n.Type = ast.NodeParagraph
						var children []*ast.Node
						for c := subTree.Root.FirstChild.FirstChild; nil != c; c = c.Next {
							children = append(children, c)
						}
						for _, c := range children {
							n.AppendChild(c)
						}
					}
				} else if bytes.Contains(n.Tokens, []byte("<svg")) {
					processHTMLBlockSvgImg(n, assetDirPath)
				}
			}
		case ast.NodeText:
			if n.ParentIs(ast.NodeTableCell) {
				n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("\\|"), []byte("|"))
				n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("|"), []byte("\\|"))
				n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("\\<br /\\>"), []byte("<br />"))
			}
		case ast.NodeInlineMath:
			withMath = true
		case ast.NodeLinkDest:
			dest := n.TokensStr()
			if strings.HasPrefix(dest, "data:image") && strings.Contains(dest, ";base64,") {
				processBase64Img(n, dest, assetDirPath)
			}
		}
		return ast.WalkContinue
	})
	return
}

func ImportSY(zipPath, boxID, toPath string) (err error) {
	util.PushEndlessProgress(Conf.Language(73))
	defer util.ClearPushProgress(100)

	lockSync()
	defer unlockSync()

	baseName := filepath.Base(zipPath)
	ext := filepath.Ext(baseName)
	baseName = strings.TrimSuffix(baseName, ext)
	unzipPath := filepath.Join(filepath.Dir(zipPath), baseName+"-"+gulu.Rand.String(7))
	err = gulu.Zip.Unzip(zipPath, unzipPath)
	if err != nil {
		return
	}
	defer os.RemoveAll(unzipPath)

	var syPaths []string
	filelock.Walk(unzipPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d == nil {
			return nil
		}
		if !d.IsDir() && strings.HasSuffix(d.Name(), ".sy") {
			syPaths = append(syPaths, path)
		}
		return nil
	})

	entries, err := os.ReadDir(unzipPath)
	if err != nil {
		logging.LogErrorf("read unzip dir [%s] failed: %s", unzipPath, err)
		return
	}
	if 1 != len(entries) {
		logging.LogErrorf("invalid .sy.zip [%v]", entries)
		return errors.New(Conf.Language(199))
	}
	unzipRootPath := filepath.Join(unzipPath, entries[0].Name())
	name := filepath.Base(unzipRootPath)
	if strings.HasPrefix(name, "data-20") && len("data-20230321175442") == len(name) {
		logging.LogErrorf("invalid .sy.zip [unzipRootPath=%s, baseName=%s]", unzipRootPath, name)
		return errors.New(Conf.Language(199))
	}

	luteEngine := util.NewLute()
	blockIDs := map[string]string{}
	trees := map[string]*parse.Tree{}

	// 重新生成块 ID
	for i, syPath := range syPaths {
		data, readErr := os.ReadFile(syPath)
		if nil != readErr {
			logging.LogErrorf("read .sy [%s] failed: %s", syPath, readErr)
			err = readErr
			return
		}
		tree, _, parseErr := dataparser.ParseJSON(data, luteEngine.ParseOptions)
		if nil != parseErr {
			logging.LogErrorf("parse .sy [%s] failed: %s", syPath, parseErr)
			err = parseErr
			return
		}
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || "" == n.ID {
				return ast.WalkContinue
			}

			// 新 ID 保留时间部分，仅修改随机值，避免时间变化导致更新时间早于创建时间
			// Keep original creation time when importing .sy.zip https://github.com/siyuan-note/siyuan/issues/9923
			newNodeID := util.TimeFromID(n.ID) + "-" + util.RandString(7)
			blockIDs[n.ID] = newNodeID
			n.ID = newNodeID
			n.SetIALAttr("id", newNodeID)

			if icon := n.IALAttr("icon"); "" != icon {
				// XSS through emoji name https://github.com/siyuan-note/siyuan/issues/15034
				icon = util.FilterUploadEmojiFileName(icon)
				n.SetIALAttr("icon", icon)
			}

			return ast.WalkContinue
		})
		tree.ID = tree.Root.ID
		tree.Path = filepath.ToSlash(strings.TrimPrefix(syPath, unzipRootPath))
		trees[tree.ID] = tree
		util.PushEndlessProgress(Conf.language(73) + " " + fmt.Sprintf(Conf.language(70), fmt.Sprintf("%d/%d", i+1, len(syPaths))))
	}

	// 引用和嵌入指向重新生成的块 ID
	for _, tree := range trees {
		util.PushEndlessProgress(Conf.language(73) + " " + fmt.Sprintf(Conf.language(70), tree.Root.IALAttr("title")))
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if treenode.IsBlockRef(n) {
				defID, _, _ := treenode.GetBlockRef(n)
				newDefID := blockIDs[defID]
				if "" != newDefID {
					n.TextMarkBlockRefID = newDefID
				}
			} else if ast.NodeTextMark == n.Type && n.IsTextMarkType("a") && strings.HasPrefix(n.TextMarkAHref, "siyuan://blocks/") {
				// Block hyperlinks do not point to regenerated block IDs when importing .sy.zip https://github.com/siyuan-note/siyuan/issues/9083
				defID := strings.TrimPrefix(n.TextMarkAHref, "siyuan://blocks/")
				newDefID := blockIDs[defID]
				if "" != newDefID {
					n.TextMarkAHref = "siyuan://blocks/" + newDefID
				}
			} else if ast.NodeBlockQueryEmbedScript == n.Type {
				for oldID, newID := range blockIDs {
					// 导入 `.sy.zip` 后查询嵌入块失效 https://github.com/siyuan-note/siyuan/issues/5316
					n.Tokens = bytes.ReplaceAll(n.Tokens, []byte(oldID), []byte(newID))
				}
			}
			return ast.WalkContinue
		})
	}

	var replacements []string
	for oldID, newID := range blockIDs {
		replacements = append(replacements, oldID, newID)
	}
	blockIDReplacer := strings.NewReplacer(replacements...)

	// 将关联的数据库文件移动到 data/storage/av/ 下
	storage := filepath.Join(unzipRootPath, "storage")
	storageAvDir := filepath.Join(storage, "av")
	avIDs := map[string]string{}
	renameAvPaths := map[string]string{}
	if gulu.File.IsExist(storageAvDir) {
		// 重新生成数据库数据
		filelock.Walk(storageAvDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d == nil {
				return nil
			}

			if ".json" == d.Name() { // https://github.com/siyuan-note/siyuan/issues/16637
				if removeErr := os.RemoveAll(path); nil != removeErr {
					logging.LogErrorf("remove empty av file [%s] failed: %s", path, removeErr)
				}
				return nil
			}

			if !strings.HasSuffix(path, ".json") || !ast.IsNodeIDPattern(strings.TrimSuffix(d.Name(), ".json")) {
				return nil
			}

			// 重命名数据库
			newAvID := ast.NewNodeID()
			oldAvID := strings.TrimSuffix(d.Name(), ".json")
			newPath := filepath.Join(filepath.Dir(path), newAvID+".json")
			renameAvPaths[path] = newPath
			avIDs[oldAvID] = newAvID
			return nil
		})

		// 重命名数据库文件
		for oldPath, newPath := range renameAvPaths {
			data, readErr := os.ReadFile(oldPath)
			if nil != readErr {
				logging.LogErrorf("read av file [%s] failed: %s", oldPath, readErr)
				return nil
			}

			// 将数据库文件中的 ID 替换为新的 ID
			newData := data
			for oldAvID, newAvID := range avIDs {
				newData = bytes.ReplaceAll(newData, []byte(oldAvID), []byte(newAvID))
			}
			newData = []byte(blockIDReplacer.Replace(string(newData)))
			if !bytes.Equal(data, newData) {
				if writeErr := os.WriteFile(oldPath, newData, 0644); nil != writeErr {
					logging.LogErrorf("write av file [%s] failed: %s", oldPath, writeErr)
					return nil
				}
			}

			if err = os.Rename(oldPath, newPath); err != nil {
				logging.LogErrorf("rename av file from [%s] to [%s] failed: %s", oldPath, newPath, err)
				return
			}
		}

		targetStorageAvDir := filepath.Join(util.DataDir, "storage", "av")
		if copyErr := filelock.Copy(storageAvDir, targetStorageAvDir); nil != copyErr {
			logging.LogErrorf("copy storage av dir from [%s] to [%s] failed: %s", storageAvDir, targetStorageAvDir, copyErr)
		}

		// 重新指向数据库属性值
		for _, tree := range trees {
			util.PushEndlessProgress(Conf.language(73) + " " + fmt.Sprintf(Conf.language(70), tree.Root.IALAttr("title")))
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering || "" == n.ID {
					return ast.WalkContinue
				}

				ial := parse.IAL2Map(n.KramdownIAL)
				for k, v := range ial {
					if strings.HasPrefix(k, av.NodeAttrNameAvs) {
						newKey, newVal := k, v
						for oldAvID, newAvID := range avIDs {
							newKey = strings.ReplaceAll(newKey, oldAvID, newAvID)
							newVal = strings.ReplaceAll(newVal, oldAvID, newAvID)
						}
						n.RemoveIALAttr(k)
						n.SetIALAttr(newKey, newVal)
					}
				}

				if ast.NodeAttributeView == n.Type {
					n.AttributeViewID = avIDs[n.AttributeViewID]
				}
				return ast.WalkContinue
			})

			// 关联数据库和块
			avNodes := tree.Root.ChildrenByType(ast.NodeAttributeView)
			av.BatchUpsertBlockRel(avNodes)
		}

		// 如果数据库中绑定的块不在导入的文档中，则需要单独更新这些绑定块的属性
		var attrViewIDs []string
		for _, avID := range avIDs {
			attrViewIDs = append(attrViewIDs, avID)
		}
		updateBoundBlockAvsAttribute(attrViewIDs)

		// 插入关联关系 https://github.com/siyuan-note/siyuan/issues/11628
		relationAvs := map[string]string{}
		for _, avID := range avIDs {
			attrView, _ := av.ParseAttributeView(avID)
			if nil == attrView {
				continue
			}

			for _, keyValues := range attrView.KeyValues {
				if nil != keyValues.Key && av.KeyTypeRelation == keyValues.Key.Type && nil != keyValues.Key.Relation {
					relationAvs[avID] = keyValues.Key.Relation.AvID
				}
			}
		}

		for srcAvID, destAvID := range relationAvs {
			av.UpsertAvBackRel(srcAvID, destAvID)
		}
	}

	// 将关联的闪卡数据合并到默认卡包 data/storage/riff/20230218211946-2kw8jgx 中
	storageRiffDir := filepath.Join(storage, "riff")
	if gulu.File.IsExist(storageRiffDir) {
		deckToImport, loadErr := riff.LoadDeck(storageRiffDir, builtinDeckID, Conf.Flashcard.RequestRetention, Conf.Flashcard.MaximumInterval, Conf.Flashcard.Weights)
		if nil != loadErr {
			logging.LogErrorf("load deck [%s] failed: %s", name, loadErr)
		} else {
			deck := Decks[builtinDeckID]
			if nil == deck {
				var createErr error
				deck, createErr = createDeck0("Built-in Deck", builtinDeckID)
				if nil == createErr {
					Decks[deck.ID] = deck
				}
			}

			bIDs := deckToImport.GetBlockIDs()
			cards := deckToImport.GetCardsByBlockIDs(bIDs)
			for _, card := range cards {
				deck.AddCard(ast.NewNodeID(), blockIDs[card.BlockID()])
			}

			if 0 < len(cards) {
				if saveErr := deck.Save(); nil != saveErr {
					logging.LogErrorf("save deck [%s] failed: %s", name, saveErr)
				}
			}
		}
	}

	// storage 文件夹已在上方处理，所以这里删除源 storage 文件夹，避免后面被拷贝到导入目录下 targetDir
	if removeErr := os.RemoveAll(storage); nil != removeErr {
		logging.LogErrorf("remove temp storage av dir failed: %s", removeErr)
	}

	if 1 > len(avIDs) { // 如果本次没有导入数据库，则清理掉文档中的数据库属性 https://github.com/siyuan-note/siyuan/issues/13011
		for _, tree := range trees {
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering || !n.IsBlock() {
					return ast.WalkContinue
				}

				n.RemoveIALAttr(av.NodeAttrNameAvs)
				return ast.WalkContinue
			})
		}
	}

	// 写回 .sy
	for _, tree := range trees {
		util.PushEndlessProgress(Conf.language(73) + " " + fmt.Sprintf(Conf.language(70), tree.Root.IALAttr("title")))
		syPath := filepath.Join(unzipRootPath, tree.Path)
		treenode.UpgradeSpec(tree)
		renderer := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
		data := renderer.Render()

		if !util.UseSingleLineSave {
			buf := bytes.Buffer{}
			buf.Grow(1024 * 1024 * 2)
			if err = json.Indent(&buf, data, "", "\t"); err != nil {
				return
			}
			data = buf.Bytes()
		}

		if err = os.WriteFile(syPath, data, 0644); err != nil {
			logging.LogErrorf("write .sy [%s] failed: %s", syPath, err)
			return
		}
		newSyPath := filepath.Join(filepath.Dir(syPath), tree.ID+".sy")
		if err = filelock.Rename(syPath, newSyPath); err != nil {
			logging.LogErrorf("rename .sy from [%s] to [%s] failed: %s", syPath, newSyPath, err)
			return
		}
	}

	// 合并 sort.json
	fullSortIDs := map[string]int{}
	sortIDs := map[string]int{}
	var sortData []byte
	var sortErr error
	sortPath := filepath.Join(unzipRootPath, ".siyuan", "sort.json")
	if filelock.IsExist(sortPath) {
		sortData, sortErr = filelock.ReadFile(sortPath)
		if nil != sortErr {
			logging.LogErrorf("read import sort conf failed: %s", sortErr)
		}

		if sortErr = gulu.JSON.UnmarshalJSON(sortData, &sortIDs); nil != sortErr {
			logging.LogErrorf("unmarshal sort conf failed: %s", sortErr)
		}

		boxSortPath := filepath.Join(util.DataDir, boxID, ".siyuan", "sort.json")
		if filelock.IsExist(boxSortPath) {
			sortData, sortErr = filelock.ReadFile(boxSortPath)
			if nil != sortErr {
				logging.LogErrorf("read box sort conf failed: %s", sortErr)
			}

			if sortErr = gulu.JSON.UnmarshalJSON(sortData, &fullSortIDs); nil != sortErr {
				logging.LogErrorf("unmarshal box sort conf failed: %s", sortErr)
			}
		}

		for oldID, sort := range sortIDs {
			if newID := blockIDs[oldID]; "" != newID {
				fullSortIDs[newID] = sort
			}
		}

		sortData, sortErr = gulu.JSON.MarshalJSON(fullSortIDs)
		if nil != sortErr {
			logging.LogErrorf("marshal box full sort conf failed: %s", sortErr)
		} else {
			sortErr = filelock.WriteFile(boxSortPath, sortData)
			if nil != sortErr {
				logging.LogErrorf("write box full sort conf failed: %s", sortErr)
			}
		}
		if removeErr := os.RemoveAll(sortPath); nil != removeErr {
			logging.LogErrorf("remove temp sort conf failed: %s", removeErr)
		}
	}

	// 重命名文件路径
	renamePaths := map[string]string{}
	filelock.Walk(unzipRootPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d == nil {
			return nil
		}
		if d.IsDir() && ast.IsNodeIDPattern(d.Name()) {
			renamePaths[path] = path
		}
		return nil
	})
	for p, _ := range renamePaths {
		originalPath := p
		p = strings.TrimPrefix(p, unzipRootPath)
		p = filepath.ToSlash(p)
		parts := strings.Split(p, "/")
		buf := bytes.Buffer{}
		buf.WriteString("/")
		for i, part := range parts {
			if "" == part {
				continue
			}
			newNodeID := blockIDs[part]
			if "" != newNodeID {
				buf.WriteString(newNodeID)
			} else {
				buf.WriteString(part)
			}
			if i < len(parts)-1 {
				buf.WriteString("/")
			}
		}
		newPath := buf.String()
		renamePaths[originalPath] = filepath.Join(unzipRootPath, newPath)
	}

	var oldPaths []string
	for oldPath, _ := range renamePaths {
		oldPaths = append(oldPaths, oldPath)
	}
	sort.Slice(oldPaths, func(i, j int) bool {
		return strings.Count(oldPaths[i], string(os.PathSeparator)) < strings.Count(oldPaths[j], string(os.PathSeparator))
	})
	for i, oldPath := range oldPaths {
		newPath := renamePaths[oldPath]
		if err = filelock.Rename(oldPath, newPath); err != nil {
			logging.LogErrorf("rename path from [%s] to [%s] failed: %s", oldPath, renamePaths[oldPath], err)
			return errors.New("rename path failed")
		}

		delete(renamePaths, oldPath)
		var toRemoves []string
		newRenamedPaths := map[string]string{}
		for oldP, newP := range renamePaths {
			if strings.HasPrefix(oldP, oldPath) {
				renamedOldP := strings.Replace(oldP, oldPath, newPath, 1)
				newRenamedPaths[renamedOldP] = newP
				toRemoves = append(toRemoves, oldPath)
			}
		}
		for _, toRemove := range toRemoves {
			delete(renamePaths, toRemove)
		}
		for oldP, newP := range newRenamedPaths {
			renamePaths[oldP] = newP
		}
		for j := i + 1; j < len(oldPaths); j++ {
			if strings.HasPrefix(oldPaths[j], oldPath) {
				renamedOldP := strings.Replace(oldPaths[j], oldPath, newPath, 1)
				oldPaths[j] = renamedOldP
			}
		}
	}

	// 将包含的资源文件统一移动到 data/assets/ 下
	var assetsDirs []string
	filelock.Walk(unzipRootPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d == nil {
			return nil
		}
		if strings.Contains(path, "assets") && d.IsDir() {
			assetsDirs = append(assetsDirs, path)
		}
		return nil
	})
	dataAssets := filepath.Join(util.DataDir, "assets")
	for _, assets := range assetsDirs {
		if gulu.File.IsDir(assets) {
			if err = filelock.Copy(assets, dataAssets); err != nil {
				logging.LogErrorf("copy assets from [%s] to [%s] failed: %s", assets, dataAssets, err)
				return
			}
		}
		os.RemoveAll(assets)
	}

	// 将包含的自定义表情统一移动到 data/emojis/ 下
	unzipRootEmojisPath := filepath.Join(unzipRootPath, "emojis")
	filelock.Walk(unzipRootEmojisPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d == nil {
			return nil
		}
		if !util.IsValidUploadFileName(d.Name()) {
			emojiFullName := path
			fullPathFilteredName := filepath.Join(filepath.Dir(path), util.FilterUploadEmojiFileName(d.Name()))
			// XSS through emoji name https://github.com/siyuan-note/siyuan/issues/15034
			logging.LogWarnf("renaming invalid custom emoji file [%s] to [%s]", d.Name(), fullPathFilteredName)
			if removeErr := filelock.Rename(emojiFullName, fullPathFilteredName); nil != removeErr {
				logging.LogErrorf("renaming invalid custom emoji file to [%s] failed: %s", fullPathFilteredName, removeErr)
			}
		}
		return nil
	})
	var emojiDirs []string
	filelock.Walk(unzipRootPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d == nil {
			return nil
		}
		if strings.Contains(path, "emojis") && d.IsDir() {
			emojiDirs = append(emojiDirs, path)
		}
		return nil
	})
	dataEmojis := filepath.Join(util.DataDir, "emojis")
	for _, emojis := range emojiDirs {
		if gulu.File.IsDir(emojis) {
			if err = filelock.Copy(emojis, dataEmojis); err != nil {
				logging.LogErrorf("copy emojis from [%s] to [%s] failed: %s", emojis, dataEmojis, err)
				return
			}
		}
		os.RemoveAll(emojis)
	}

	var baseTargetPath string
	if "/" == toPath {
		baseTargetPath = "/"
	} else {
		block := treenode.GetBlockTreeRootByPath(boxID, toPath)
		if nil == block {
			logging.LogErrorf("not found block by path [%s]", toPath)
			return nil
		}
		baseTargetPath = strings.TrimSuffix(block.Path, ".sy")
	}

	targetDir := filepath.Join(util.DataDir, boxID, baseTargetPath)
	if err = os.MkdirAll(targetDir, 0755); err != nil {
		return
	}

	var treePaths []string
	filelock.Walk(unzipRootPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d == nil {
			return nil
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}

		if !strings.HasSuffix(d.Name(), ".sy") {
			return nil
		}

		p := strings.TrimPrefix(path, unzipRootPath)
		p = filepath.ToSlash(p)
		treePaths = append(treePaths, p)
		return nil
	})

	if err = filelock.Copy(unzipRootPath, targetDir); err != nil {
		logging.LogErrorf("copy data dir from [%s] to [%s] failed: %s", unzipRootPath, util.DataDir, err)
		err = errors.New("copy data failed")
		return
	}

	boxAbsPath := filepath.Join(util.DataDir, boxID)
	for _, treePath := range treePaths {
		absPath := filepath.Join(targetDir, treePath)
		p := strings.TrimPrefix(absPath, boxAbsPath)
		p = filepath.ToSlash(p)
		tree, err := filesys.LoadTree(boxID, p, luteEngine)
		if err != nil {
			logging.LogErrorf("load tree [%s] failed: %s", treePath, err)
			continue
		}

		treenode.IndexBlockTree(tree)
		sql.IndexTreeQueue(tree)
		util.PushEndlessProgress(Conf.language(73) + " " + fmt.Sprintf(Conf.language(70), tree.Root.IALAttr("title")))
	}

	IncSync()

	task.AppendTask(task.UpdateIDs, util.PushUpdateIDs, blockIDs)
	return
}

func ImportData(zipPath string) (err error) {
	util.PushEndlessProgress(Conf.Language(73))
	defer util.ClearPushProgress(100)

	lockSync()
	defer unlockSync()

	logging.LogInfof("import data from [%s]", zipPath)
	baseName := filepath.Base(zipPath)
	ext := filepath.Ext(baseName)
	baseName = strings.TrimSuffix(baseName, ext)
	unzipPath := filepath.Join(filepath.Dir(zipPath), baseName)
	err = gulu.Zip.Unzip(zipPath, unzipPath)
	if err != nil {
		return
	}
	defer os.RemoveAll(unzipPath)

	files, err := filepath.Glob(filepath.Join(unzipPath, "*/*.sy"))
	if err != nil {
		logging.LogErrorf("check data.zip failed: %s", err)
		return errors.New("check data.zip failed")
	}
	if 0 < len(files) {
		return errors.New(Conf.Language(198))
	}
	dirs, err := os.ReadDir(unzipPath)
	if err != nil {
		logging.LogErrorf("check data.zip failed: %s", err)
		return errors.New("check data.zip failed")
	}
	if 1 != len(dirs) {
		return errors.New(Conf.Language(198))
	}

	tmpDataPath := filepath.Join(unzipPath, dirs[0].Name())
	tmpDataEmojisPath := filepath.Join(tmpDataPath, "emojis")
	filelock.Walk(tmpDataEmojisPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d == nil {
			return nil
		}
		if !util.IsValidUploadFileName(d.Name()) {
			emojiFullName := path
			fullPathFilteredName := filepath.Join(filepath.Dir(path), util.FilterUploadEmojiFileName(d.Name()))
			// XSS through emoji name https://github.com/siyuan-note/siyuan/issues/15034
			logging.LogWarnf("renaming invalid custom emoji file [%s] to [%s]", d.Name(), fullPathFilteredName)
			if removeErr := filelock.Rename(emojiFullName, fullPathFilteredName); nil != removeErr {
				logging.LogErrorf("renaming invalid custom emoji file to [%s] failed: %s", fullPathFilteredName, removeErr)
			}
		}
		return nil
	})
	if err = filelock.Copy(tmpDataPath, util.DataDir); err != nil {
		logging.LogErrorf("copy data dir from [%s] to [%s] failed: %s", tmpDataPath, util.DataDir, err)
		err = errors.New("copy data failed")
		return
	}

	logging.LogInfof("import data from [%s] done", zipPath)
	IncSync()
	FullReindex()
	return
}

func ImportFromLocalPath(boxID, localPath string, toPath string) (err error) {
	util.PushEndlessProgress(Conf.Language(73))
	defer func() {
		util.PushClearProgress()

		if e := recover(); nil != e {
			stack := debug.Stack()
			msg := fmt.Sprintf("PANIC RECOVERED: %v\n\t%s\n", e, stack)
			logging.LogErrorf("import from local path failed: %s", msg)
			err = errors.New("import from local path failed, please check kernel log for details")
		}
	}()

	lockSync()
	defer unlockSync()

	FlushTxQueue()

	var baseHPath, baseTargetPath, boxLocalPath string
	if "/" == toPath {
		baseHPath = "/"
		baseTargetPath = "/"
	} else {
		block := treenode.GetBlockTreeRootByPath(boxID, toPath)
		if nil == block {
			logging.LogErrorf("not found block by path [%s]", toPath)
			return nil
		}
		baseHPath = block.HPath
		baseTargetPath = strings.TrimSuffix(block.Path, ".sy")
	}
	boxLocalPath = filepath.Join(util.DataDir, boxID)

	hPathsIDs := map[string]string{}
	idPaths := map[string]string{}
	moveIDs := map[string]string{}
	assetsDone := map[string]string{}
	if gulu.File.IsDir(localPath) { // 导入文件夹
		targetPaths := map[string]string{}
		count := 0
		// md 转换 sy
		filelock.Walk(localPath, func(currentPath string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d == nil {
				return nil
			}
			if strings.HasPrefix(d.Name(), ".") {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			if !d.IsDir() && (!strings.HasSuffix(currentPath, ".md") && !strings.HasSuffix(currentPath, ".markdown") ||
				strings.Contains(filepath.ToSlash(currentPath), "/assets/")) {
				// 非 Markdown 文件作为资源文件处理 https://github.com/siyuan-note/siyuan/issues/13817
				existName := assetsDone[currentPath]
				var name string
				if "" == existName {
					name = filepath.Base(currentPath)
					name = util.FilterUploadFileName(name)
					name = util.AssetName(name, ast.NewNodeID())
					assetTargetPath := filepath.Join(util.DataDir, "assets", name)
					if err = filelock.Copy(currentPath, assetTargetPath); err != nil {
						logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", currentPath, assetTargetPath, err)
						return nil
					}
					assetsDone[currentPath] = name
				}
				return nil
			}

			var tree *parse.Tree
			var ext string
			title := d.Name()
			if !d.IsDir() {
				ext = util.Ext(d.Name())
				title = strings.TrimSuffix(d.Name(), ext)
			}
			id := ast.NewNodeID()

			curRelPath := filepath.ToSlash(strings.TrimPrefix(currentPath, localPath))
			targetPath := path.Join(baseTargetPath, id)
			hPath := path.Join(baseHPath, filepath.Base(localPath), filepath.ToSlash(strings.TrimPrefix(currentPath, localPath)))
			hPath = strings.TrimSuffix(hPath, ext)
			if "" == curRelPath {
				curRelPath = "/"
				hPath = "/" + title
			} else {
				dirPath := targetPaths[path.Dir(curRelPath)]
				targetPath = path.Join(dirPath, id)
			}

			targetPath = strings.ReplaceAll(targetPath, ".sy/", "/")
			targetPath += ".sy"
			if _, ok := targetPaths[curRelPath]; !ok {
				targetPaths[curRelPath] = targetPath
			} else {
				targetPath = targetPaths[curRelPath]
				id = util.GetTreeID(targetPath)
			}

			if d.IsDir() {
				if "assets" == d.Name() {
					// 如果是 assets 文件夹则跳过，里面的 Markdown 文件算作资源文件 https://github.com/siyuan-note/siyuan/issues/13817
					return nil
				}

				if subMdFiles := util.GetFilePathsByExts(currentPath, []string{".md", ".markdown"}); 1 > len(subMdFiles) {
					// 如果该文件夹中不包含 Markdown 文件则不处理 https://github.com/siyuan-note/siyuan/issues/11567
					return nil
				}

				// 如果当前文件夹路径下包含同名的 Markdown 文件，则不创建空文档 https://github.com/siyuan-note/siyuan/issues/13149
				if gulu.File.IsExist(currentPath+".md") || gulu.File.IsExist(currentPath+".markdown") {
					targetPaths[curRelPath+".md"] = targetPath
					return nil
				}

				tree = treenode.NewTree(boxID, targetPath, hPath, title)
				importTrees = append(importTrees, tree)
				return nil
			}

			if !strings.HasSuffix(d.Name(), ".md") && !strings.HasSuffix(d.Name(), ".markdown") {
				return nil
			}

			data, readErr := os.ReadFile(currentPath)
			if nil != readErr {
				err = readErr
				return io.EOF
			}

			tree, yfmRootID, yfmTitle, yfmUpdated := parseStdMd(data)
			if nil == tree {
				logging.LogErrorf("parse tree [%s] failed", currentPath)
				return nil
			}

			if "" != yfmRootID {
				moveIDs[id] = yfmRootID
				id = yfmRootID
			}
			if "" != yfmTitle {
				title = yfmTitle
			}
			unescapedTitle, unescapeErr := url.PathUnescape(title)
			if nil == unescapeErr {
				title = unescapedTitle
			}
			hPath = path.Join(path.Dir(hPath), title)
			updated := yfmUpdated
			fname := path.Base(targetPath)
			targetPath = strings.ReplaceAll(targetPath, fname, id+".sy")
			targetPaths[curRelPath] = targetPath

			tree.ID = id
			tree.Root.ID = id
			tree.Root.SetIALAttr("id", tree.Root.ID)
			tree.Root.SetIALAttr("title", title)
			tree.Box = boxID
			targetPath = path.Join(path.Dir(targetPath), tree.Root.ID+".sy")
			tree.Path = targetPath
			targetPaths[curRelPath] = targetPath
			tree.HPath = hPath
			tree.Root.Spec = treenode.CurrentSpec

			docDirLocalPath := filepath.Dir(filepath.Join(boxLocalPath, targetPath))
			assetDirPath := getAssetsDir(boxLocalPath, docDirLocalPath)
			currentDir := filepath.Dir(currentPath)
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering || (ast.NodeLinkDest != n.Type && !n.IsTextMarkType("a")) {
					return ast.WalkContinue
				}

				var dest string
				if ast.NodeLinkDest == n.Type {
					dest = n.TokensStr()
				} else {
					dest = n.TextMarkAHref
				}

				if strings.HasPrefix(dest, "data:image") && strings.Contains(dest, ";base64,") {
					processBase64Img(n, dest, assetDirPath)
					return ast.WalkContinue
				}

				decodedDest := string(html.DecodeDestination([]byte(dest)))
				if decodedDest != dest {
					dest = decodedDest
				}
				absolutePath := filepath.Join(currentDir, dest)

				if ast.NodeLinkDest == n.Type {
					n.Tokens = []byte(dest)
				} else {
					n.TextMarkAHref = dest
				}
				if !util.IsRelativePath(dest) {
					return ast.WalkContinue
				}
				dest = filepath.ToSlash(dest)
				if "" == dest {
					return ast.WalkContinue
				}

				if !gulu.File.IsExist(absolutePath) {
					return ast.WalkContinue
				}

				if strings.HasSuffix(absolutePath, ".md") || strings.HasSuffix(absolutePath, ".markdown") {
					if !strings.Contains(absolutePath, "assets") {
						// 链接 .md 文件的情况下只有路径中包含 assets 才算作资源文件，其他情况算作文档链接，后续在 convertMdHyperlinks2WikiLinks 中处理
						// Supports converting relative path hyperlinks into document block references after importing Markdown https://github.com/siyuan-note/siyuan/issues/13817
						return ast.WalkContinue
					}
				}

				existName := assetsDone[absolutePath]
				var name string
				if "" == existName {
					name = filepath.Base(absolutePath)
					name = util.FilterUploadFileName(name)
					name = util.AssetName(name, ast.NewNodeID())
					assetTargetPath := filepath.Join(assetDirPath, name)
					if err = filelock.Copy(absolutePath, assetTargetPath); err != nil {
						logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", absolutePath, assetTargetPath, err)
						return ast.WalkContinue
					}
					assetsDone[absolutePath] = name
				} else {
					name = existName
				}
				if ast.NodeLinkDest == n.Type {
					n.Tokens = []byte("assets/" + name)
				} else {
					n.TextMarkAHref = "assets/" + name
				}
				return ast.WalkContinue
			})

			reassignIDUpdated(tree, id, updated)
			importTrees = append(importTrees, tree)

			hPathsIDs[tree.HPath] = tree.ID
			idPaths[tree.ID] = tree.Path

			count++
			if 0 == count%4 {
				util.PushEndlessProgress(fmt.Sprintf(Conf.language(70), fmt.Sprintf("%s", tree.HPath)))
			}
			return nil
		})
	} else { // 导入单个文件
		fileName := filepath.Base(localPath)
		if !strings.HasSuffix(fileName, ".md") && !strings.HasSuffix(fileName, ".markdown") {
			return errors.New(Conf.Language(79))
		}

		title := strings.TrimSuffix(fileName, ".markdown")
		title = strings.TrimSuffix(title, ".md")
		targetPath := strings.TrimSuffix(toPath, ".sy")
		id := ast.NewNodeID()
		targetPath = path.Join(targetPath, id+".sy")
		var data []byte
		data, err = os.ReadFile(localPath)
		if err != nil {
			return err
		}
		tree, yfmRootID, yfmTitle, yfmUpdated := parseStdMd(data)
		if nil == tree {
			msg := fmt.Sprintf("parse tree [%s] failed", localPath)
			logging.LogErrorf(msg)
			return errors.New(msg)
		}

		if "" != yfmRootID {
			id = yfmRootID
		}
		if "" != yfmTitle {
			title = yfmTitle
		}
		unescapedTitle, unescapeErr := url.PathUnescape(title)
		if nil == unescapeErr {
			title = unescapedTitle
		}
		updated := yfmUpdated
		fname := path.Base(targetPath)
		targetPath = strings.ReplaceAll(targetPath, fname, id+".sy")

		tree.ID = id
		tree.Root.ID = id
		tree.Root.SetIALAttr("id", tree.Root.ID)
		tree.Root.SetIALAttr("title", title)
		tree.Box = boxID
		tree.Path = targetPath
		tree.HPath = path.Join(baseHPath, title)
		tree.Root.Spec = treenode.CurrentSpec

		docDirLocalPath := filepath.Dir(filepath.Join(boxLocalPath, targetPath))
		assetDirPath := getAssetsDir(boxLocalPath, docDirLocalPath)
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || (ast.NodeLinkDest != n.Type && !n.IsTextMarkType("a")) {
				return ast.WalkContinue
			}

			var dest string
			if ast.NodeLinkDest == n.Type {
				dest = n.TokensStr()
			} else {
				dest = n.TextMarkAHref
			}

			if strings.HasPrefix(dest, "data:image") && strings.Contains(dest, ";base64,") {
				processBase64Img(n, dest, assetDirPath)
				return ast.WalkContinue
			}

			decodedDest := string(html.DecodeDestination([]byte(dest)))
			if decodedDest != dest {
				dest = decodedDest
			}
			absolutePath := filepath.Join(filepath.Dir(localPath), dest)

			if ast.NodeLinkDest == n.Type {
				n.Tokens = []byte(dest)
			} else {
				n.TextMarkAHref = dest
			}
			if !util.IsRelativePath(dest) {
				return ast.WalkContinue
			}
			dest = filepath.ToSlash(dest)
			if "" == dest {
				return ast.WalkContinue
			}

			if !gulu.File.IsExist(absolutePath) {
				return ast.WalkContinue
			}

			existName := assetsDone[absolutePath]
			var name string
			if "" == existName {
				name = filepath.Base(absolutePath)
				name = util.FilterUploadFileName(name)
				name = util.AssetName(name, ast.NewNodeID())
				assetTargetPath := filepath.Join(assetDirPath, name)
				if err = filelock.Copy(absolutePath, assetTargetPath); err != nil {
					logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", absolutePath, assetTargetPath, err)
					return ast.WalkContinue
				}
				assetsDone[absolutePath] = name
			} else {
				name = existName
			}
			if ast.NodeLinkDest == n.Type {
				n.Tokens = []byte("assets/" + name)
			} else {
				n.TextMarkAHref = "assets/" + name
			}
			return ast.WalkContinue
		})

		reassignIDUpdated(tree, id, updated)
		importTrees = append(importTrees, tree)
	}

	if 0 < len(importTrees) {
		for id, newID := range moveIDs {
			for _, importTree := range importTrees {
				importTree.ID = strings.ReplaceAll(importTree.ID, id, newID)
				importTree.Path = strings.ReplaceAll(importTree.Path, id, newID)
			}
		}

		initSearchLinks()
		convertMdHyperlinks2WikiLinks()
		convertWikiLinksAndTags()
		mergeTextAndHandlerNestedInlines()

		box := Conf.Box(boxID)
		for i, tree := range importTrees {
			indexWriteTreeIndexQueue(tree)
			if 0 == i%4 {
				util.PushEndlessProgress(fmt.Sprintf(Conf.Language(66), fmt.Sprintf("%d/%d ", i, len(importTrees))+tree.HPath))
			}
		}
		util.PushClearProgress()

		importTrees = []*parse.Tree{}
		searchLinks = map[string]string{}

		// 按照路径排序 Improve sort when importing markdown files https://github.com/siyuan-note/siyuan/issues/11390
		var hPaths []string
		for hPath := range hPathsIDs {
			hPaths = append(hPaths, hPath)
		}
		sort.Strings(hPaths)
		paths := map[string][]string{}
		for _, hPath := range hPaths {
			p := idPaths[hPathsIDs[hPath]]
			parent := path.Dir(p)
			for {
				if baseTargetPath == parent {
					break
				}

				if ps, ok := paths[parent]; !ok {
					paths[parent] = []string{p}
				} else {
					ps = append(ps, p)
					ps = gulu.Str.RemoveDuplicatedElem(ps)
					paths[parent] = ps
				}
				p = parent
				parent = path.Dir(parent)
			}
		}

		sortIDVals := map[string]int{}
		for _, ps := range paths {
			sortVal := 0
			for _, p := range ps {
				sortIDVals[util.GetTreeID(p)] = sortVal
				sortVal++
			}
		}
		box.setSort(sortIDVals)
	}

	IncSync()
	debug.FreeOSMemory()
	return
}

func parseStdMd(markdown []byte) (ret *parse.Tree, yfmRootID, yfmTitle, yfmUpdated string) {
	luteEngine := util.NewStdLute()
	luteEngine.SetYamlFrontMatter(true) // 解析 YAML Front Matter https://github.com/siyuan-note/siyuan/issues/10878
	ret = parse.Parse("", markdown, luteEngine.ParseOptions)
	if nil == ret {
		return
	}
	yfmRootID, yfmTitle, yfmUpdated = normalizeTree(ret)
	htmlBlock2Inline(ret)
	parse.TextMarks2Inlines(ret) // 先将 TextMark 转换为 Inlines https://github.com/siyuan-note/siyuan/issues/13056
	parse.NestedInlines2FlattedSpansHybrid(ret, false)
	return
}

func processHTMLBlockSvgImg(n *ast.Node, assetDirPath string) {
	re := regexp.MustCompile(`(?i)<svg[^>]*>(.*?)</svg>`)
	matches := re.FindStringSubmatch(string(n.Tokens))
	if 1 >= len(matches) {
		return
	}

	svgContent := matches[0]
	name := util.AssetName("image.svg", ast.NewNodeID())
	writePath := filepath.Join(assetDirPath, name)
	if err := filelock.WriteFile(writePath, []byte(svgContent)); err != nil {
		logging.LogErrorf("write svg asset file [%s] failed: %s", writePath, err)
		return
	}

	n.Type = ast.NodeParagraph
	img := &ast.Node{Type: ast.NodeImage}
	img.AppendChild(&ast.Node{Type: ast.NodeBang})
	img.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
	img.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte("image")})
	img.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
	img.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
	img.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/" + name)})
	img.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
	n.AppendChild(img)
}
func processBase64Img(n *ast.Node, dest string, assetDirPath string) {
	base64TmpDir := filepath.Join(util.TempDir, "base64")
	os.MkdirAll(base64TmpDir, 0755)

	sep := strings.Index(dest, ";base64,")
	str := strings.TrimSpace(dest[sep+8:])
	re := regexp.MustCompile(`(?i)%0A`)
	str = re.ReplaceAllString(str, "\n")
	var decodeErr error
	unbased, decodeErr := base64.StdEncoding.DecodeString(str)
	if nil != decodeErr {
		logging.LogErrorf("decode base64 image failed: %s", decodeErr)
		return
	}
	dataReader := bytes.NewReader(unbased)
	var img image.Image
	var ext string
	typ := dest[5:sep]
	switch typ {
	case "image/png":
		img, decodeErr = png.Decode(dataReader)
		ext = ".png"
		if nil != decodeErr {
			dataReader.Seek(0, 0)
			img, decodeErr = jpeg.Decode(dataReader)
			ext = ".jpg"
		}
	case "image/jpeg":
		img, decodeErr = jpeg.Decode(dataReader)
		ext = ".jpg"
	case "image/svg+xml":
		ext = ".svg"
	default:
		logging.LogWarnf("unsupported base64 image type [%s]", typ)
		return
	}
	if nil != decodeErr {
		logging.LogErrorf("decode base64 image failed: %s", decodeErr)
		return
	}

	name := "image" + ext
	alt := n.Parent.ChildByType(ast.NodeLinkText)
	if nil != alt {
		name = alt.TokensStr() + ext
	}
	name = util.FilterUploadFileName(name)
	name = util.AssetName(name, ast.NewNodeID())

	tmp := filepath.Join(base64TmpDir, name)
	tmpFile, openErr := os.OpenFile(tmp, os.O_RDWR|os.O_CREATE, 0644)
	if nil != openErr {
		logging.LogErrorf("open temp file [%s] failed: %s", tmp, openErr)
		return
	}

	var encodeErr error
	switch typ {
	case "image/png":
		encodeErr = png.Encode(tmpFile, img)
	case "image/jpeg":
		encodeErr = jpeg.Encode(tmpFile, img, &jpeg.Options{Quality: 100})
	case "image/svg+xml":
		_, encodeErr = tmpFile.Write(unbased)
	}
	if nil != encodeErr {
		logging.LogErrorf("encode base64 image failed: %s", encodeErr)
		tmpFile.Close()
		return
	}
	tmpFile.Close()

	assetTargetPath := filepath.Join(assetDirPath, name)
	if err := filelock.Copy(tmp, assetTargetPath); err != nil {
		logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", tmp, assetTargetPath, err)
		return
	}
	n.Tokens = []byte("assets/" + name)
}

func htmlBlock2Inline(tree *parse.Tree) {
	imgHtmlBlocks := map[*ast.Node]*html.Node{}
	aHtmlBlocks := map[*ast.Node]*html.Node{}
	var unlinks []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeHTMLBlock == n.Type || (ast.NodeText == n.Type && bytes.HasPrefix(bytes.ToLower(n.Tokens), []byte("<img "))) {
			tokens := bytes.TrimSpace(n.Tokens)
			if bytes.HasPrefix(tokens, []byte("<div>")) {
				tokens = bytes.TrimPrefix(tokens, []byte("<div>"))
			}
			if bytes.HasSuffix(tokens, []byte("</div>")) {
				tokens = bytes.TrimSuffix(tokens, []byte("</div>"))
			}
			tokens = bytes.TrimSpace(tokens)

			htmlNodes, pErr := html.ParseFragment(bytes.NewReader(tokens), &html.Node{Type: html.ElementNode})
			if nil != pErr {
				logging.LogErrorf("parse html block [%s] failed: %s", n.Tokens, pErr)
				return ast.WalkContinue
			}
			if 1 > len(htmlNodes) {
				return ast.WalkContinue
			}

			for _, htmlNode := range htmlNodes {
				if atom.Img == htmlNode.DataAtom {
					imgHtmlBlocks[n] = htmlNode
					break
				}
			}
		}
		if ast.NodeHTMLBlock == n.Type || (ast.NodeText == n.Type && bytes.HasPrefix(bytes.ToLower(n.Tokens), []byte("<a "))) {
			tokens := bytes.TrimSpace(n.Tokens)
			if bytes.HasPrefix(tokens, []byte("<div>")) {
				tokens = bytes.TrimPrefix(tokens, []byte("<div>"))
			}
			if bytes.HasSuffix(tokens, []byte("</div>")) {
				tokens = bytes.TrimSuffix(tokens, []byte("</div>"))
			}
			tokens = bytes.TrimSpace(tokens)

			if ast.NodeHTMLBlock != n.Type && nil != n.Next && nil != n.Next.Next {
				if ast.NodeText == n.Next.Next.Type && bytes.Equal(n.Next.Next.Tokens, []byte("</a>")) {
					tokens = append(tokens, n.Next.Tokens...)
					tokens = append(tokens, []byte("</a>")...)
					unlinks = append(unlinks, n.Next)
					unlinks = append(unlinks, n.Next.Next)
				}
			}

			htmlNodes, pErr := html.ParseFragment(bytes.NewReader(tokens), &html.Node{Type: html.ElementNode})
			if nil != pErr {
				logging.LogErrorf("parse html block [%s] failed: %s", n.Tokens, pErr)
				return ast.WalkContinue
			}
			if 1 > len(htmlNodes) {
				return ast.WalkContinue
			}

			for _, htmlNode := range htmlNodes {
				if atom.A == htmlNode.DataAtom {
					aHtmlBlocks[n] = htmlNode
					break
				}
			}
		}
		return ast.WalkContinue
	})

	for n, htmlImg := range imgHtmlBlocks {
		src := domAttrValue(htmlImg, "src")
		alt := domAttrValue(htmlImg, "alt")
		title := domAttrValue(htmlImg, "title")

		p := treenode.NewParagraph(n.ID)
		img := &ast.Node{Type: ast.NodeImage}
		p.AppendChild(img)
		img.AppendChild(&ast.Node{Type: ast.NodeBang})
		img.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
		img.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(alt)})
		img.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
		img.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
		img.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(src)})
		if "" != title {
			img.AppendChild(&ast.Node{Type: ast.NodeLinkSpace})
			img.AppendChild(&ast.Node{Type: ast.NodeLinkTitle})
		}
		img.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
		if width := domAttrValue(htmlImg, "width"); "" != width {
			if util2.IsDigit(width) {
				width += "px"
			}
			style := "width: " + width + ";"
			ial := &ast.Node{Type: ast.NodeKramdownSpanIAL, Tokens: parse.IAL2Tokens([][]string{{"style", style}})}
			img.SetIALAttr("style", style)
			img.InsertAfter(ial)
		} else if height := domAttrValue(htmlImg, "height"); "" != height {
			if util2.IsDigit(height) {
				height += "px"
			}
			style := "height: " + height + ";"
			ial := &ast.Node{Type: ast.NodeKramdownSpanIAL, Tokens: parse.IAL2Tokens([][]string{{"style", style}})}
			img.SetIALAttr("style", style)
			img.InsertAfter(ial)
		}

		if ast.NodeHTMLBlock == n.Type {
			n.InsertBefore(p)
		} else if ast.NodeText == n.Type {
			if nil != n.Parent {
				if n.Parent.IsContainerBlock() {
					n.InsertBefore(p)
				} else {
					n.InsertBefore(img)
				}
			} else {
				n.InsertBefore(p)
			}
		}
		unlinks = append(unlinks, n)
	}

	for n, htmlA := range aHtmlBlocks {
		href := domAttrValue(htmlA, "href")
		title := domAttrValue(htmlA, "title")
		anchor := util2.DomText(htmlA)

		p := treenode.NewParagraph(n.ID)
		a := &ast.Node{Type: ast.NodeLink}
		p.AppendChild(a)
		a.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
		a.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(anchor)})
		a.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
		a.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
		a.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(href)})
		if "" != title {
			a.AppendChild(&ast.Node{Type: ast.NodeLinkSpace})
			a.AppendChild(&ast.Node{Type: ast.NodeLinkTitle, Tokens: []byte(title)})
		}
		a.AppendChild(&ast.Node{Type: ast.NodeCloseParen})

		if ast.NodeHTMLBlock == n.Type || (nil == n.Previous && (nil != n.Next && nil != n.Next.Next && nil == n.Next.Next.Next)) {
			n.InsertBefore(p)
		} else {
			n.InsertBefore(a)
		}
		unlinks = append(unlinks, n)
	}

	for _, n := range unlinks {
		n.Unlink()
	}
	return
}

func reassignIDUpdated(tree *parse.Tree, rootID, updated string) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || "" == n.ID {
			return ast.WalkContinue
		}

		n.ID = ast.NewNodeID()
		if ast.NodeDocument == n.Type && "" != rootID {
			n.ID = rootID
		}

		n.SetIALAttr("id", n.ID)
		if "" != updated {
			n.SetIALAttr("updated", updated)
			if "" == rootID {
				n.ID = updated + "-" + gulu.Rand.String(7)
				n.SetIALAttr("id", n.ID)
			}
		} else {
			n.SetIALAttr("updated", util.TimeFromID(n.ID))
		}
		return ast.WalkContinue
	})
	tree.ID = tree.Root.ID
	tree.Path = path.Join(path.Dir(tree.Path), tree.ID+".sy")
	tree.Root.SetIALAttr("id", tree.Root.ID)
}

func domAttrValue(n *html.Node, attrName string) string {
	if nil == n {
		return ""
	}

	for _, attr := range n.Attr {
		if attr.Key == attrName {
			return attr.Val
		}
	}
	return ""
}

var importTrees []*parse.Tree
var searchLinks = map[string]string{}

func initSearchLinks() {
	for _, tree := range importTrees {
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || (ast.NodeDocument != n.Type && ast.NodeHeading != n.Type) {
				return ast.WalkContinue
			}

			nodePath := tree.HPath + "#"
			if ast.NodeHeading == n.Type {
				nodePath += n.Text()
			}

			searchLinks[nodePath] = n.ID
			return ast.WalkContinue
		})
	}
}

func convertMdHyperlinks2WikiLinks() {
	// Supports converting relative path hyperlinks into document block references after importing Markdown https://github.com/siyuan-note/siyuan/issues/13817

	var unlinks []*ast.Node
	for _, tree := range importTrees {
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || ast.NodeTextMark != n.Type {
				return ast.WalkContinue
			}

			if "a" != n.TextMarkType {
				return ast.WalkContinue
			}

			linkText := n.TextMarkTextContent
			if "" == linkText {
				return ast.WalkContinue
			}
			linkDest := n.TextMarkAHref
			if "" == linkDest {
				return ast.WalkContinue
			}
			if strings.HasPrefix(linkDest, "assets/") {
				return ast.WalkContinue
			}
			if !strings.HasSuffix(linkDest, ".md") && !strings.HasSuffix(linkDest, ".markdown") {
				return ast.WalkContinue
			}
			linkDest = strings.TrimSuffix(linkDest, ".md")
			linkDest = strings.TrimSuffix(linkDest, ".markdown")

			buf := bytes.Buffer{}
			buf.WriteString("[[")
			buf.WriteString(linkDest)
			buf.WriteString("|")
			buf.WriteString(linkText)
			buf.WriteString("]]")

			wikilinkNode := &ast.Node{Type: ast.NodeText, Tokens: buf.Bytes()}
			n.InsertBefore(wikilinkNode)
			unlinks = append(unlinks, n)
			return ast.WalkContinue
		})
	}

	for _, n := range unlinks {
		n.Unlink()
	}
}

func convertWikiLinksAndTags() {
	for _, tree := range importTrees {
		convertWikiLinksAndTags0(tree)
	}
}

func convertWikiLinksAndTags0(tree *parse.Tree) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeText != n.Type {
			return ast.WalkContinue
		}

		text := n.TokensStr()
		length := len(text)
		start, end := 0, length
		for {
			part := text[start:end]
			if idx := strings.Index(part, "]]"); 0 > idx {
				break
			} else {
				end = start + idx
			}
			if idx := strings.Index(part, "[["); 0 > idx {
				break
			} else {
				start += idx
			}
			if end <= start {
				break
			}

			link := path.Join(path.Dir(tree.HPath), text[start+2:end]) // 统一转为绝对路径方便后续查找
			linkText := path.Base(link)
			dynamicAnchorText := true
			if linkParts := strings.Split(link, "|"); 1 < len(linkParts) {
				link = linkParts[0]
				linkText = linkParts[1]
				dynamicAnchorText = false
			}
			link, linkText = strings.TrimSpace(link), strings.TrimSpace(linkText)
			if !strings.Contains(link, "#") {
				link += "#" // 在结尾统一带上锚点方便后续查找
			}

			id := searchLinkID(link)
			if "" == id {
				start, end = end, length
				continue
			}

			linkText = strings.TrimPrefix(linkText, "/")
			repl := "((" + id + " '" + linkText + "'))"
			if !dynamicAnchorText {
				repl = "((" + id + " \"" + linkText + "\"))"
			}
			end += 2
			text = text[:start] + repl + text[end:]
			start, end = start+len(repl), len(text)
			length = end
		}

		text = convertTags(text) // 导入标签语法
		n.Tokens = gulu.Str.ToBytes(text)
		return ast.WalkContinue
	})
}

func convertTags(text string) (ret string) {
	if !util.MarkdownSettings.InlineTag {
		return text
	}

	pos, i := -1, 0
	tokens := []byte(text)
	for ; i < len(tokens); i++ {
		if '#' == tokens[i] && (0 == i || ' ' == tokens[i-1] || (-1 < pos && '#' == tokens[pos])) {
			if i < len(tokens)-1 && '#' == tokens[i+1] {
				pos = -1
				continue
			}
			pos = i
			continue
		}

		if -1 < pos && ' ' == tokens[i] {
			tokens = append(tokens, 0)
			copy(tokens[i+1:], tokens[i:])
			tokens[i] = '#'
			pos = -1
			i++
		}
	}
	if -1 < pos && pos < i {
		tokens = append(tokens, '#')
	}
	return string(tokens)
}

func searchLinkID(link string) (id string) {
	id = searchLinks[link]
	if "" != id {
		return
	}

	baseName := path.Base(link)
	for searchLink, searchID := range searchLinks {
		if path.Base(searchLink) == baseName {
			return searchID
		}
	}
	return
}

func mergeTextAndHandlerNestedInlines() {
	luteEngine := NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	for _, tree := range importTrees {
		tree.MergeText()

		var unlinkTextNodes []*ast.Node
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || ast.NodeText != n.Type {
				return ast.WalkContinue
			}

			if nil == n.Tokens {
				return ast.WalkContinue
			}

			t := parse.Inline("", n.Tokens, luteEngine.ParseOptions) // 使用行级解析
			parse.NestedInlines2FlattedSpans(t, false)
			var children []*ast.Node
			for c := t.Root.FirstChild.FirstChild; nil != c; c = c.Next {
				children = append(children, c)
			}
			for _, c := range children {
				n.InsertBefore(c)
			}
			unlinkTextNodes = append(unlinkTextNodes, n)
			return ast.WalkContinue
		})

		for _, node := range unlinkTextNodes {
			node.Unlink()
		}
	}
}
