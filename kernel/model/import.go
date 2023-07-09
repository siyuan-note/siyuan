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
	"math/rand"
	"os"
	"path"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/html/atom"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func HTML2Markdown(htmlStr string) (markdown string, err error) {
	assetDirPath := filepath.Join(util.DataDir, "assets")
	luteEngine := util.NewLute()
	tree := luteEngine.HTML2Tree(htmlStr)
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeLinkDest != n.Type {
			return ast.WalkContinue
		}

		dest := n.TokensStr()
		if strings.HasPrefix(dest, "data:image") && strings.Contains(dest, ";base64,") {
			processBase64Img(n, dest, assetDirPath, err)
			return ast.WalkContinue
		}
		return ast.WalkContinue
	})

	var formatted []byte
	renderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions)
	for nodeType, rendererFunc := range luteEngine.HTML2MdRendererFuncs {
		renderer.ExtRendererFuncs[nodeType] = rendererFunc
	}
	formatted = renderer.Render()
	markdown = gulu.Str.FromBytes(formatted)
	return
}

func ImportSY(zipPath, boxID, toPath string) (err error) {
	util.PushEndlessProgress(Conf.Language(73))
	defer util.ClearPushProgress(100)

	syncLock.Lock()
	defer syncLock.Unlock()

	baseName := filepath.Base(zipPath)
	ext := filepath.Ext(baseName)
	baseName = strings.TrimSuffix(baseName, ext)
	unzipPath := filepath.Join(filepath.Dir(zipPath), baseName+"-"+gulu.Rand.String(7))
	err = gulu.Zip.Unzip(zipPath, unzipPath)
	if nil != err {
		return
	}
	defer os.RemoveAll(unzipPath)

	var syPaths []string
	filepath.Walk(unzipPath, func(path string, info fs.FileInfo, err error) error {
		if nil != err {
			return err
		}

		if !info.IsDir() && strings.HasSuffix(info.Name(), ".sy") {
			syPaths = append(syPaths, path)
		}
		return nil
	})

	unzipRootPaths, err := filepath.Glob(unzipPath + "/*")
	if nil != err {
		return
	}
	if 1 != len(unzipRootPaths) {
		logging.LogErrorf("invalid .sy.zip")
		return errors.New(Conf.Language(199))
	}
	unzipRootPath := unzipRootPaths[0]
	name := filepath.Base(unzipRootPath)
	if strings.HasPrefix(name, "data-20") && len("data-20230321175442") == len(name) {
		return errors.New(Conf.Language(199))
	}

	luteEngine := util.NewLute()
	blockIDs := map[string]string{}
	trees := map[string]*parse.Tree{}

	// 重新生成块 ID
	for _, syPath := range syPaths {
		data, readErr := os.ReadFile(syPath)
		if nil != readErr {
			logging.LogErrorf("read .sy [%s] failed: %s", syPath, readErr)
			err = readErr
			return
		}
		tree, _, parseErr := filesys.ParseJSON(data, luteEngine.ParseOptions)
		if nil != parseErr {
			logging.LogErrorf("parse .sy [%s] failed: %s", syPath, parseErr)
			err = parseErr
			return
		}
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			if "" != n.ID {
				newNodeID := ast.NewNodeID()
				blockIDs[n.ID] = newNodeID
				n.ID = newNodeID
				n.SetIALAttr("id", newNodeID)

			}
			return ast.WalkContinue
		})
		tree.ID = tree.Root.ID
		tree.Path = filepath.ToSlash(strings.TrimPrefix(syPath, unzipRootPath))
		trees[tree.ID] = tree
	}

	// 引用和嵌入指向重新生成的块 ID
	for _, tree := range trees {
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
			} else if ast.NodeBlockQueryEmbedScript == n.Type {
				for oldID, newID := range blockIDs {
					// 导入 `.sy.zip` 后查询嵌入块失效 https://github.com/siyuan-note/siyuan/issues/5316
					n.Tokens = bytes.ReplaceAll(n.Tokens, []byte(oldID), []byte(newID))
				}
			}
			return ast.WalkContinue
		})
	}

	// 写回 .sy
	for _, tree := range trees {
		syPath := filepath.Join(unzipRootPath, tree.Path)
		if "" == tree.Root.Spec {
			parse.NestedInlines2FlattedSpans(tree)
			tree.Root.Spec = "1"
		}
		renderer := render.NewJSONRenderer(tree, luteEngine.RenderOptions)
		data := renderer.Render()

		if !util.UseSingleLineSave {
			buf := bytes.Buffer{}
			buf.Grow(1024 * 1024 * 2)
			if err = json.Indent(&buf, data, "", "\t"); nil != err {
				return
			}
			data = buf.Bytes()
		}

		if err = os.WriteFile(syPath, data, 0644); nil != err {
			logging.LogErrorf("write .sy [%s] failed: %s", syPath, err)
			return
		}
		newSyPath := filepath.Join(filepath.Dir(syPath), tree.ID+".sy")
		if err = filelock.Move(syPath, newSyPath); nil != err {
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
	if gulu.File.IsExist(sortPath) {
		sortData, sortErr = filelock.ReadFile(sortPath)
		if nil != sortErr {
			logging.LogErrorf("read import sort conf failed: %s", sortErr)
		}

		if sortErr = gulu.JSON.UnmarshalJSON(sortData, &sortIDs); nil != sortErr {
			logging.LogErrorf("unmarshal sort conf failed: %s", sortErr)
		}

		boxSortPath := filepath.Join(util.DataDir, boxID, ".siyuan", "sort.json")
		if gulu.File.IsExist(boxSortPath) {
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
	filepath.Walk(unzipRootPath, func(path string, info fs.FileInfo, err error) error {
		if nil != err {
			return err
		}

		if info.IsDir() && ast.IsNodeIDPattern(info.Name()) {
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
		if err = filelock.Move(oldPath, newPath); nil != err {
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
	filepath.Walk(unzipRootPath, func(path string, info fs.FileInfo, err error) error {
		if strings.Contains(path, "assets") && info.IsDir() {
			assetsDirs = append(assetsDirs, path)
		}
		return nil
	})
	dataAssets := filepath.Join(util.DataDir, "assets")
	for _, assets := range assetsDirs {
		if gulu.File.IsDir(assets) {
			if err = filelock.Copy(assets, dataAssets); nil != err {
				logging.LogErrorf("copy assets from [%s] to [%s] failed: %s", assets, dataAssets, err)
				return
			}
		}
		os.RemoveAll(assets)
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
	if err = os.MkdirAll(targetDir, 0755); nil != err {
		return
	}

	var treePaths []string
	filepath.Walk(unzipRootPath, func(path string, info fs.FileInfo, err error) error {
		if info.IsDir() {
			if strings.HasPrefix(info.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}

		if !strings.HasSuffix(info.Name(), ".sy") {
			return nil
		}

		p := strings.TrimPrefix(path, unzipRootPath)
		p = filepath.ToSlash(p)
		treePaths = append(treePaths, p)
		return nil
	})

	if err = filelock.Copy(unzipRootPath, targetDir); nil != err {
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
		if nil != err {
			logging.LogErrorf("load tree [%s] failed: %s", treePath, err)
			continue
		}

		treenode.IndexBlockTree(tree)
		sql.UpsertTreeQueue(tree)
	}

	IncSync()
	return
}

func ImportData(zipPath string) (err error) {
	util.PushEndlessProgress(Conf.Language(73))
	defer util.ClearPushProgress(100)

	syncLock.Lock()
	defer syncLock.Unlock()

	baseName := filepath.Base(zipPath)
	ext := filepath.Ext(baseName)
	baseName = strings.TrimSuffix(baseName, ext)
	unzipPath := filepath.Join(filepath.Dir(zipPath), baseName)
	err = gulu.Zip.Unzip(zipPath, unzipPath)
	if nil != err {
		return
	}
	defer os.RemoveAll(unzipPath)

	files, err := filepath.Glob(filepath.Join(unzipPath, "*/*.sy"))
	if nil != err {
		logging.LogErrorf("check data.zip failed: %s", err)
		return errors.New("check data.zip failed")
	}
	if 0 < len(files) {
		return errors.New(Conf.Language(198))
	}
	dirs, err := os.ReadDir(unzipPath)
	if nil != err {
		logging.LogErrorf("check data.zip failed: %s", err)
		return errors.New("check data.zip failed")
	}
	if 1 != len(dirs) {
		return errors.New(Conf.Language(198))
	}

	tmpDataPath := filepath.Join(unzipPath, dirs[0].Name())
	if err = filelock.Copy(tmpDataPath, util.DataDir); nil != err {
		logging.LogErrorf("copy data dir from [%s] to [%s] failed: %s", tmpDataPath, util.DataDir, err)
		err = errors.New("copy data failed")
		return
	}

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

	WaitForWritingFiles()

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

	if gulu.File.IsDir(localPath) {
		// 收集所有资源文件
		assets := map[string]string{}
		filepath.Walk(localPath, func(currentPath string, info os.FileInfo, walkErr error) error {
			if localPath == currentPath {
				return nil
			}
			if strings.HasPrefix(info.Name(), ".") {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			if !strings.HasSuffix(info.Name(), ".md") && !strings.HasSuffix(info.Name(), ".markdown") {
				assets[currentPath] = currentPath
				return nil
			}
			return nil
		})

		targetPaths := map[string]string{}
		assetsDone := map[string]string{}

		// md 转换 sy
		filepath.Walk(localPath, func(currentPath string, info os.FileInfo, walkErr error) error {
			if strings.HasPrefix(info.Name(), ".") {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			var tree *parse.Tree
			var ext string
			title := info.Name()
			if !info.IsDir() {
				ext = path.Ext(info.Name())
				title = strings.TrimSuffix(info.Name(), ext)
			}
			id := ast.NewNodeID()

			curRelPath := filepath.ToSlash(strings.TrimPrefix(currentPath, localPath))
			targetPath := path.Join(baseTargetPath, id)
			hPath := path.Join(baseHPath, filepath.ToSlash(strings.TrimPrefix(currentPath, localPath)))
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
			targetPaths[curRelPath] = targetPath

			if info.IsDir() {
				tree = treenode.NewTree(boxID, targetPath, hPath, title)
				importTrees = append(importTrees, tree)
				return nil
			}

			if !strings.HasSuffix(info.Name(), ".md") && !strings.HasSuffix(info.Name(), ".markdown") {
				return nil
			}

			data, readErr := os.ReadFile(currentPath)
			if nil != readErr {
				err = readErr
				return io.EOF
			}

			tree = parseStdMd(data)
			if nil == tree {
				logging.LogErrorf("parse tree [%s] failed", currentPath)
				return nil
			}

			tree.ID = id
			tree.Root.ID = id
			tree.Root.SetIALAttr("id", tree.Root.ID)
			tree.Root.SetIALAttr("title", title)
			tree.Box = boxID
			targetPath = path.Join(path.Dir(targetPath), tree.Root.ID+".sy")
			tree.Path = targetPath
			targetPaths[curRelPath] = targetPath
			tree.HPath = hPath
			tree.Root.Spec = "1"

			docDirLocalPath := filepath.Dir(filepath.Join(boxLocalPath, targetPath))
			assetDirPath := getAssetsDir(boxLocalPath, docDirLocalPath)
			currentDir := filepath.Dir(currentPath)
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering || ast.NodeLinkDest != n.Type {
					return ast.WalkContinue
				}

				dest := n.TokensStr()
				if strings.HasPrefix(dest, "data:image") && strings.Contains(dest, ";base64,") {
					processBase64Img(n, dest, assetDirPath, err)
					return ast.WalkContinue
				}

				dest = strings.ReplaceAll(dest, "%20", " ")
				dest = strings.ReplaceAll(dest, "%5C", "/")
				n.Tokens = []byte(dest)
				if !util.IsRelativePath(dest) {
					return ast.WalkContinue
				}
				dest = filepath.ToSlash(dest)
				if "" == dest {
					return ast.WalkContinue
				}

				absDest := filepath.Join(currentDir, dest)
				fullPath, exist := assets[absDest]
				if !exist {
					absDest = filepath.Join(currentDir, string(html.DecodeDestination([]byte(dest))))
				}
				fullPath, exist = assets[absDest]
				if exist {
					existName := assetsDone[absDest]
					var name string
					if "" == existName {
						name = filepath.Base(fullPath)
						name = util.AssetName(name)
						assetTargetPath := filepath.Join(assetDirPath, name)
						if err = filelock.Copy(fullPath, assetTargetPath); nil != err {
							logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", fullPath, assetTargetPath, err)
							return ast.WalkContinue
						}
						assetsDone[absDest] = name
					} else {
						name = existName
					}
					n.Tokens = []byte("assets/" + name)
				}
				return ast.WalkContinue
			})

			reassignIDUpdated(tree)
			importTrees = append(importTrees, tree)
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
		if nil != err {
			return err
		}
		tree := parseStdMd(data)
		if nil == tree {
			msg := fmt.Sprintf("parse tree [%s] failed", localPath)
			logging.LogErrorf(msg)
			return errors.New(msg)
		}

		tree.ID = id
		tree.Root.ID = id
		tree.Root.SetIALAttr("id", tree.Root.ID)
		tree.Root.SetIALAttr("title", title)
		tree.Box = boxID
		tree.Path = targetPath
		tree.HPath = path.Join(baseHPath, title)
		tree.Root.Spec = "1"

		docDirLocalPath := filepath.Dir(filepath.Join(boxLocalPath, targetPath))
		assetDirPath := getAssetsDir(boxLocalPath, docDirLocalPath)
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || ast.NodeLinkDest != n.Type {
				return ast.WalkContinue
			}

			dest := n.TokensStr()
			if strings.HasPrefix(dest, "data:image") && strings.Contains(dest, ";base64,") {
				processBase64Img(n, dest, assetDirPath, err)
				return ast.WalkContinue
			}

			dest = strings.ReplaceAll(dest, "%20", " ")
			dest = strings.ReplaceAll(dest, "%5C", "/")
			n.Tokens = []byte(dest)
			if !util.IsRelativePath(dest) {
				return ast.WalkContinue
			}
			dest = filepath.ToSlash(dest)
			if "" == dest {
				return ast.WalkContinue
			}

			absolutePath := filepath.Join(filepath.Dir(localPath), dest)
			exist := gulu.File.IsExist(absolutePath)
			if !exist {
				absolutePath = filepath.Join(filepath.Dir(localPath), string(html.DecodeDestination([]byte(dest))))
				exist = gulu.File.IsExist(absolutePath)
			}
			if exist {
				name := filepath.Base(absolutePath)
				name = util.AssetName(name)
				assetTargetPath := filepath.Join(assetDirPath, name)
				if err = filelock.Copy(absolutePath, assetTargetPath); nil != err {
					logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", absolutePath, assetTargetPath, err)
					return ast.WalkContinue
				}
				n.Tokens = []byte("assets/" + name)
			}
			return ast.WalkContinue
		})

		reassignIDUpdated(tree)
		importTrees = append(importTrees, tree)
	}

	if 0 < len(importTrees) {
		initSearchLinks()
		convertWikiLinksAndTags()
		buildBlockRefInText()

		for i, tree := range importTrees {
			indexWriteJSONQueue(tree)
			if 0 == i%4 {
				util.PushEndlessProgress(fmt.Sprintf(Conf.Language(66), fmt.Sprintf("%d/%d ", i, len(importTrees))+tree.HPath))
			}
		}

		importTrees = []*parse.Tree{}
		searchLinks = map[string]string{}
	}

	IncSync()
	util.ReloadUI()
	debug.FreeOSMemory()
	return
}

func parseStdMd(markdown []byte) (ret *parse.Tree) {
	luteEngine := util.NewStdLute()
	ret = parse.Parse("", markdown, luteEngine.ParseOptions)
	if nil == ret {
		return
	}
	genTreeID(ret)
	imgHtmlBlock2InlineImg(ret)
	parse.NestedInlines2FlattedSpansHybrid(ret)
	return
}

func processBase64Img(n *ast.Node, dest string, assetDirPath string, err error) {
	base64TmpDir := filepath.Join(util.TempDir, "base64")
	os.MkdirAll(base64TmpDir, 0755)

	sep := strings.Index(dest, ";base64,")
	var decodeErr error
	unbased, decodeErr := base64.StdEncoding.DecodeString(dest[sep+8:])
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
	case "image/jpeg":
		img, decodeErr = jpeg.Decode(dataReader)
		ext = ".jpg"
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
	name = util.FilterFileName(name)
	name = util.AssetName(name)

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
	}
	if nil != encodeErr {
		logging.LogErrorf("encode base64 image failed: %s", encodeErr)
		tmpFile.Close()
		return
	}
	tmpFile.Close()

	assetTargetPath := filepath.Join(assetDirPath, name)
	if err = filelock.Copy(tmp, assetTargetPath); nil != err {
		logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", tmp, assetTargetPath, err)
		return
	}
	n.Tokens = []byte("assets/" + name)
}

func imgHtmlBlock2InlineImg(tree *parse.Tree) {
	imgHtmlBlocks := map[*ast.Node]*html.Node{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeHTMLBlock == n.Type {
			htmlNodes, pErr := html.ParseFragment(bytes.NewReader(n.Tokens), &html.Node{Type: html.ElementNode})
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
		return ast.WalkContinue
	})

	for n, htmlImg := range imgHtmlBlocks {
		src := domAttrValue(htmlImg, "src")
		alt := domAttrValue(htmlImg, "alt")
		title := domAttrValue(htmlImg, "title")

		p := &ast.Node{Type: ast.NodeParagraph, ID: n.ID}
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

		n.InsertBefore(p)
		n.Unlink()
	}
	return
}

func reassignIDUpdated(tree *parse.Tree) {
	var blockCount int
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || "" == n.ID {
			return ast.WalkContinue
		}

		blockCount++
		return ast.WalkContinue
	})

	ids := make([]string, blockCount)
	min, _ := strconv.ParseInt(time.Now().Add(-1*time.Duration(blockCount)*time.Second).Format("20060102150405"), 10, 64)
	for i := 0; i < blockCount; i++ {
		ids[i] = newID(fmt.Sprintf("%d", min))
		min++
	}

	var i int
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || "" == n.ID {
			return ast.WalkContinue
		}

		n.ID = ids[i]
		n.SetIALAttr("id", n.ID)
		n.SetIALAttr("updated", util.TimeFromID(n.ID))
		i++
		return ast.WalkContinue
	})
	tree.ID = tree.Root.ID
	tree.Path = path.Join(path.Dir(tree.Path), tree.ID+".sy")
	tree.Root.SetIALAttr("id", tree.Root.ID)
}

func newID(t string) string {
	return t + "-" + randStr(7)
}

func randStr(length int) string {
	letter := []rune("abcdefghijklmnopqrstuvwxyz0123456789")
	b := make([]rune, length)
	for i := range b {
		b[i] = letter[rand.Intn(len(letter))]
	}
	return string(b)
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

// buildBlockRefInText 将文本节点进行结构化处理。
func buildBlockRefInText() {
	lute := NewLute()
	lute.SetHTMLTag2TextMark(true)
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

			t := parse.Inline("", n.Tokens, lute.ParseOptions) // 使用行级解析
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
