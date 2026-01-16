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

package filesys

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	jsoniter "github.com/json-iterator/go"
	"github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func LoadTrees(ids []string) (ret map[string]*parse.Tree) {
	ret = map[string]*parse.Tree{}
	if 1 > len(ids) {
		return ret
	}

	bts := treenode.GetBlockTrees(ids)
	luteEngine := util.NewLute()
	var boxIDs []string
	var paths []string
	blockIDs := map[string][]string{}
	for _, bt := range bts {
		boxIDs = append(boxIDs, bt.BoxID)
		paths = append(paths, bt.Path)
		if _, ok := blockIDs[bt.RootID]; !ok {
			blockIDs[bt.RootID] = []string{}
		}
		blockIDs[bt.RootID] = append(blockIDs[bt.RootID], bt.ID)
	}

	trees, errs := batchLoadTrees(boxIDs, paths, luteEngine)
	for i := range trees {
		tree := trees[i]
		err := errs[i]
		if err != nil || tree == nil {
			logging.LogErrorf("load tree failed: %s", err)
			continue
		}

		bIDs := blockIDs[tree.Root.ID]
		for _, bID := range bIDs {
			ret[bID] = tree
		}
	}
	return
}

func batchLoadTrees(boxIDs, paths []string, luteEngine *lute.Lute) (ret []*parse.Tree, errs []error) {
	waitGroup := sync.WaitGroup{}
	lock := sync.Mutex{}
	poolSize := runtime.NumCPU()
	if 8 < poolSize {
		poolSize = 8
	}
	p, _ := ants.NewPoolWithFunc(poolSize, func(arg interface{}) {
		defer waitGroup.Done()

		i := arg.(int)
		boxID := boxIDs[i]
		path := paths[i]
		tree, err := LoadTree(boxID, path, luteEngine)
		lock.Lock()
		ret = append(ret, tree)
		errs = append(errs, err)
		lock.Unlock()
	})
	loaded := map[string]bool{}
	for i := range paths {
		if loaded[boxIDs[i]+paths[i]] {
			continue
		}

		loaded[boxIDs[i]+paths[i]] = true

		waitGroup.Add(1)
		p.Invoke(i)
	}
	waitGroup.Wait()
	p.Release()
	return
}

func LoadTree(boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	filePath := filepath.Join(util.DataDir, boxID, p)
	data, err := filelock.ReadFile(filePath)
	if err != nil {
		logging.LogErrorf("load tree [%s] failed: %s", p, err)
		return
	}

	ret, err = LoadTreeByData(data, boxID, p, luteEngine)
	return
}

func LoadTreeByData(data []byte, boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	ret, err = parseJSON2Tree(boxID, p, data, luteEngine)
	if nil != err {
		logging.LogErrorf("parse tree [%s] failed: %s", p, err)
		return
	}
	ret.Path = p
	ret.Root.Path = p

	parts := strings.Split(p, "/")
	parts = parts[1 : len(parts)-1] // 去掉开头的斜杆和结尾的自己
	if 1 > len(parts) {
		ret.HPath = "/" + ret.Root.IALAttr("title")
		ret.Hash = treenode.NodeHash(ret.Root, ret, luteEngine)
		return
	}

	// 构造 HPath
	hPathBuilder := bytes.Buffer{}
	hPathBuilder.WriteString("/")
	for i, _ := range parts {
		var parentAbsPath string
		if 0 < i {
			parentAbsPath = strings.Join(parts[:i+1], "/")
		} else {
			parentAbsPath = parts[0]
		}
		parentAbsPath += ".sy"
		parentPath := parentAbsPath
		parentAbsPath = filepath.Join(util.DataDir, boxID, parentAbsPath)

		parentDocIAL := DocIAL(parentAbsPath)
		if 1 > len(parentDocIAL) {
			// 子文档缺失父文档时自动补全 https://github.com/siyuan-note/siyuan/issues/7376
			parentTree := treenode.NewTree(boxID, parentPath, hPathBuilder.String()+"Untitled", "Untitled")
			if _, writeErr := WriteTree(parentTree); nil != writeErr {
				logging.LogErrorf("rebuild parent tree [%s] failed: %s", parentAbsPath, writeErr)
			} else {
				logging.LogInfof("rebuilt parent tree [%s]", parentAbsPath)
				treenode.UpsertBlockTree(parentTree)
			}
			hPathBuilder.WriteString("Untitled/")
			continue
		}

		title := parentDocIAL["title"]
		if "" == title {
			title = "Untitled"
		}
		hPathBuilder.WriteString(util.UnescapeHTML(title))
		hPathBuilder.WriteString("/")
	}
	hPathBuilder.WriteString(ret.Root.IALAttr("title"))
	ret.HPath = hPathBuilder.String()
	ret.Hash = treenode.NodeHash(ret.Root, ret, luteEngine)
	return
}

func DocIAL(absPath string) (ret map[string]string) {
	filelock.Lock(absPath)
	file, err := os.Open(absPath)
	if err != nil {
		logging.LogErrorf("open file [%s] failed: %s", absPath, err)
		filelock.Unlock(absPath)
		return nil
	}

	iter := jsoniter.Parse(jsoniter.ConfigCompatibleWithStandardLibrary, file, 512)
	for field := iter.ReadObject(); field != ""; field = iter.ReadObject() {
		if field == "Properties" {
			iter.ReadVal(&ret)
			break
		} else {
			iter.Skip()
		}
	}
	file.Close()
	filelock.Unlock(absPath)
	return
}

func TreeSize(tree *parse.Tree) (size uint64) {
	luteEngine := util.NewLute() // 不关注用户的自定义解析渲染选项
	renderer := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	return uint64(len(renderer.Render()))
}

func WriteTree(tree *parse.Tree) (size uint64, err error) {
	data, filePath, err := prepareWriteTree(tree)
	if err != nil {
		return
	}

	size = uint64(len(data))
	if err = filelock.WriteFile(filePath, data); err != nil {
		msg := fmt.Sprintf("write data [%s] failed: %s", filePath, err)
		logging.LogErrorf(msg)
		err = errors.New(msg)
		return
	}

	if util.ExceedLargeFileWarningSize(len(data)) {
		msg := fmt.Sprintf(util.Langs[util.Lang][268], tree.Root.IALAttr("title")+" "+filepath.Base(filePath), util.LargeFileWarningSize)
		util.PushErrMsg(msg, 7000)
	}

	afterWriteTree(tree)
	return
}

func prepareWriteTree(tree *parse.Tree) (data []byte, filePath string, err error) {
	luteEngine := util.NewLute() // 不关注用户的自定义解析渲染选项

	if nil == tree.Root.FirstChild {
		newP := treenode.NewParagraph("")
		tree.Root.AppendChild(newP)
		tree.Root.SetIALAttr("updated", util.TimeFromID(newP.ID))
		treenode.UpsertBlockTree(tree)
	}

	treenode.UpgradeSpec(tree)

	filePath = filepath.Join(util.DataDir, tree.Box, tree.Path)
	tree.Root.SetIALAttr("type", "doc")
	renderer := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	data = renderer.Render()
	data = bytes.ReplaceAll(data, []byte(`\u0000`), []byte(""))
	if !util.UseSingleLineSave {
		buf := bytes.Buffer{}
		buf.Grow(1024 * 1024 * 2)
		if err = json.Indent(&buf, data, "", "\t"); err != nil {
			logging.LogErrorf("json indent failed: %s", err)
			return
		}
		data = buf.Bytes()
	}

	if err = os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return
	}
	return
}

func afterWriteTree(tree *parse.Tree) {
	docIAL := parse.IAL2MapUnEsc(tree.Root.KramdownIAL)
	cache.PutDocIAL(tree.Path, docIAL)
}

func parseJSON2Tree(boxID, p string, jsonData []byte, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	var needFix bool
	ret, needFix, err = dataparser.ParseJSON(jsonData, luteEngine.ParseOptions)
	if err != nil {
		logging.LogErrorf("parse json [%s] to tree failed: %s", boxID+p, err)
		return
	}

	ret.Box = boxID
	ret.Path = p

	if err = treenode.CheckSpec(ret); errors.Is(err, treenode.ErrSpecTooNew) {
		return
	}

	if treenode.UpgradeSpec(ret) {
		needFix = true
	}

	if escapeAttributeValues(ret) { // TODO 计划于 2026 年 6 月 30 日后删除
		// v3.5.1 https://github.com/siyuan-note/siyuan/pull/16657 引入的问题，属性值未转义
		// v3.5.2 https://github.com/siyuan-note/siyuan/issues/16686 进行了修复，并加了订正逻辑 https://github.com/siyuan-note/siyuan/pull/16712
		needFix = true
	}

	if pathID := util.GetTreeID(p); pathID != ret.Root.ID {
		needFix = true
		logging.LogInfof("reset tree id from [%s] to [%s]", ret.Root.ID, pathID)
		ret.Root.ID = pathID
		ret.ID = pathID
		ret.Root.SetIALAttr("id", ret.ID)
	}

	if needFix {
		renderer := render.NewJSONRenderer(ret, luteEngine.RenderOptions, luteEngine.ParseOptions)
		data := renderer.Render()

		if !util.UseSingleLineSave {
			buf := bytes.Buffer{}
			buf.Grow(1024 * 1024 * 2)
			if err = json.Indent(&buf, data, "", "\t"); err != nil {
				return
			}
			data = buf.Bytes()
		}

		filePath := filepath.Join(util.DataDir, ret.Box, ret.Path)
		if err = os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			return
		}
		if err = filelock.WriteFile(filePath, data); err != nil {
			msg := fmt.Sprintf("write data [%s] failed: %s", filePath, err)
			logging.LogErrorf(msg)
		}
	}
	return
}

// escapeAttributeValues 转义属性值
func escapeAttributeValues(tree *parse.Tree) (hasEscaped bool) {
	if util.ReadOnly || nil == tree || nil == tree.Root {
		return false
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() || "" == n.ID || 0 == len(n.KramdownIAL) {
			return ast.WalkContinue
		}

		if escaped := escapeNodeAttributeValues(n); escaped {
			hasEscaped = true
		}
		return ast.WalkContinue
	})
	return hasEscaped
}

// escapeNodeAttributeValues 转义节点的属性值
func escapeNodeAttributeValues(node *ast.Node) (escaped bool) {
	if nil == node || 0 == len(node.KramdownIAL) {
		return false
	}

	for _, kv := range node.KramdownIAL {
		if value := kv[1]; needsEscapeForValue(value) {
			kv[1] = html.EscapeAttrVal(value)
			escaped = true
		}
	}
	return
}

// needsEscapeForValue 检查值是否需要转义（包含需要转义的特殊字符但尚未被转义）
func needsEscapeForValue(value string) bool {
	hasSpecialChars := false
	for _, char := range value {
		switch char {
		case '<', '>', '&', '"', '{', '}':
			hasSpecialChars = true
		}
		if hasSpecialChars {
			break
		}
	}
	if !hasSpecialChars {
		return false
	}

	entities := []string{"&quot;", "&#123;", "&#125;", "&amp;", "&lt;", "&gt;"}
	for _, entity := range entities {
		if strings.Contains(value, entity) {
			return false
		}
	}
	return true
}
