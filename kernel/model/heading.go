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
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func (tx *Transaction) doFoldHeading(operation *Operation) (ret *TxErr) {
	headingID := operation.ID
	tree, err := tx.loadTree(headingID)
	if nil != err {
		return &TxErr{code: TxErrCodeBlockNotFound, id: headingID}
	}

	childrenIDs := []string{} // 这里不能用 nil，否则折叠下方没内容的标题时会内核中断 https://github.com/siyuan-note/siyuan/issues/3643
	heading := treenode.GetNodeInTree(tree, headingID)
	if nil == heading {
		return &TxErr{code: TxErrCodeBlockNotFound, id: headingID}
	}

	children := treenode.HeadingChildren(heading)
	for _, child := range children {
		childrenIDs = append(childrenIDs, child.ID)
		child.SetIALAttr("fold", "1")
		child.SetIALAttr("heading-fold", "1")
	}
	heading.SetIALAttr("fold", "1")
	if err = tx.writeTree(tree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: headingID}
	}
	IncSync()

	cache.PutBlockIAL(headingID, parse.IAL2Map(heading.KramdownIAL))
	for _, child := range children {
		cache.PutBlockIAL(child.ID, parse.IAL2Map(child.KramdownIAL))
	}
	sql.UpsertTreeQueue(tree)
	operation.RetData = childrenIDs
	return
}

func (tx *Transaction) doUnfoldHeading(operation *Operation) (ret *TxErr) {
	headingID := operation.ID

	tree, err := tx.loadTree(headingID)
	if nil != err {
		return &TxErr{code: TxErrCodeBlockNotFound, id: headingID}
	}

	heading := treenode.GetNodeInTree(tree, headingID)
	if nil == heading {
		return &TxErr{code: TxErrCodeBlockNotFound, id: headingID}
	}

	children := treenode.HeadingChildren(heading)
	for _, child := range children {
		child.RemoveIALAttr("heading-fold")
		child.RemoveIALAttr("fold")
	}
	heading.RemoveIALAttr("fold")
	heading.RemoveIALAttr("heading-fold")
	if err = tx.writeTree(tree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: headingID}
	}
	IncSync()

	cache.PutBlockIAL(headingID, parse.IAL2Map(heading.KramdownIAL))
	for _, child := range children {
		cache.PutBlockIAL(child.ID, parse.IAL2Map(child.KramdownIAL))
	}
	sql.UpsertTreeQueue(tree)

	luteEngine := NewLute()
	operation.RetData = renderBlockDOMByNodes(children, luteEngine)
	return
}

func Doc2Heading(srcID, targetID string, after bool) (srcTreeBox, srcTreePath string, err error) {
	srcTree, _ := loadTreeByBlockID(srcID)
	if nil == srcTree {
		err = ErrBlockNotFound
		return
	}

	subDir := filepath.Join(util.DataDir, srcTree.Box, strings.TrimSuffix(srcTree.Path, ".sy"))
	if gulu.File.IsDir(subDir) {
		if !util.IsEmptyDir(subDir) {
			err = errors.New(Conf.Language(20))
			return
		}

		if removeErr := os.Remove(subDir); nil != removeErr { // 移除空文件夹不会有副作用
			logging.LogWarnf("remove empty dir [%s] failed: %s", subDir, removeErr)
		}
	}

	targetTree, _ := loadTreeByBlockID(targetID)
	if nil == targetTree {
		err = ErrBlockNotFound
		return
	}

	pivot := treenode.GetNodeInTree(targetTree, targetID)
	if nil == pivot {
		err = ErrBlockNotFound
		return
	}

	// 移动前先删除引用 https://github.com/siyuan-note/siyuan/issues/7819
	sql.DeleteRefsTreeQueue(srcTree)
	sql.DeleteRefsTreeQueue(targetTree)

	if ast.NodeListItem == pivot.Type {
		pivot = pivot.LastChild
	}

	pivotLevel := treenode.HeadingLevel(pivot)
	deltaLevel := pivotLevel - treenode.TopHeadingLevel(srcTree) + 1
	headingLevel := pivotLevel
	if ast.NodeHeading == pivot.Type { // 平级插入
		children := treenode.HeadingChildren(pivot)
		if after {
			if length := len(children); 0 < length {
				pivot = children[length-1]
			}
		}
	} else { // 子节点插入
		headingLevel++
		deltaLevel++
	}
	if 6 < headingLevel {
		headingLevel = 6
	}

	srcTree.Root.RemoveIALAttr("type")
	tagIAL := srcTree.Root.IALAttr("tags")
	tags := strings.Split(tagIAL, ",")
	srcTree.Root.RemoveIALAttr("tags")
	heading := &ast.Node{ID: srcTree.Root.ID, Type: ast.NodeHeading, HeadingLevel: headingLevel, KramdownIAL: srcTree.Root.KramdownIAL}
	heading.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(srcTree.Root.IALAttr("title"))})
	heading.Box, heading.Path = targetTree.Box, targetTree.Path
	if "" != tagIAL && 0 < len(tags) {
		// 带标签的文档块转换为标题块时将标签移动到标题块下方 https://github.com/siyuan-note/siyuan/issues/6550

		tagPara := treenode.NewParagraph()
		for i, tag := range tags {
			if "" == tag {
				continue
			}

			tagPara.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: tag})
			if i < len(tags)-1 {
				tagPara.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(" ")})
			}
		}
		if nil != tagPara.FirstChild {
			srcTree.Root.PrependChild(tagPara)
		}
	}

	var nodes []*ast.Node
	if after {
		for c := srcTree.Root.LastChild; nil != c; c = c.Previous {
			nodes = append(nodes, c)
		}
	} else {
		for c := srcTree.Root.FirstChild; nil != c; c = c.Next {
			nodes = append(nodes, c)
		}
	}

	if !after {
		pivot.InsertBefore(heading)
	}

	for _, n := range nodes {
		if ast.NodeHeading == n.Type {
			n.HeadingLevel = n.HeadingLevel + deltaLevel
			if 6 < n.HeadingLevel {
				n.HeadingLevel = 6
			}
		}
		n.Box = targetTree.Box
		n.Path = targetTree.Path
		if after {
			pivot.InsertAfter(n)
		} else {
			pivot.InsertBefore(n)
		}
	}

	if after {
		pivot.InsertAfter(heading)
	}

	if contentPivot := treenode.GetNodeInTree(targetTree, targetID); nil != contentPivot && ast.NodeParagraph == contentPivot.Type && nil == contentPivot.FirstChild { // 插入到空的段落块下
		contentPivot.Unlink()
	}

	box := Conf.Box(srcTree.Box)
	if removeErr := box.Remove(srcTree.Path); nil != removeErr {
		logging.LogWarnf("remove tree [%s] failed: %s", srcTree.Path, removeErr)
	}
	box.removeSort([]string{srcTree.ID})
	RemoveRecentDoc([]string{srcTree.ID})
	evt := util.NewCmdResult("removeDoc", 0, util.PushModeBroadcast)
	evt.Data = map[string]interface{}{
		"ids": []string{srcTree.ID},
	}
	util.PushEvent(evt)

	srcTreeBox, srcTreePath = srcTree.Box, srcTree.Path // 返回旧的文档块位置，前端后续会删除旧的文档块
	targetTree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	treenode.RemoveBlockTreesByRootID(srcTree.ID)
	treenode.RemoveBlockTreesByRootID(targetTree.ID)
	err = indexWriteJSONQueue(targetTree)
	IncSync()
	RefreshBacklink(srcTree.ID)
	RefreshBacklink(targetTree.ID)
	return
}

func Heading2Doc(srcHeadingID, targetBoxID, targetPath string) (srcRootBlockID, newTargetPath string, err error) {
	srcTree, _ := loadTreeByBlockID(srcHeadingID)
	if nil == srcTree {
		err = ErrBlockNotFound
		return
	}
	srcRootBlockID = srcTree.Root.ID

	headingBlock, err := getBlock(srcHeadingID, srcTree)
	if nil != err {
		return
	}
	if nil == headingBlock {
		err = ErrBlockNotFound
		return
	}
	headingNode := treenode.GetNodeInTree(srcTree, srcHeadingID)
	if nil == headingNode {
		err = ErrBlockNotFound
		return
	}

	box := Conf.Box(targetBoxID)
	headingText := getNodeRefText0(headingNode)
	headingText = util.FilterFileName(headingText)

	moveToRoot := "/" == targetPath
	toHP := path.Join("/", headingText)
	toFolder := "/"

	if !moveToRoot {
		toBlock := treenode.GetBlockTreeRootByPath(targetBoxID, targetPath)
		if nil == toBlock {
			err = ErrBlockNotFound
			return
		}
		toHP = path.Join(toBlock.HPath, headingText)
		toFolder = path.Join(path.Dir(targetPath), toBlock.ID)
	}

	newTargetPath = path.Join(toFolder, srcHeadingID+".sy")
	if !box.Exist(toFolder) {
		if err = box.MkdirAll(toFolder); nil != err {
			return
		}
	}

	// 折叠标题转换为文档时需要自动展开下方块 https://github.com/siyuan-note/siyuan/issues/2947
	children := treenode.HeadingChildren(headingNode)
	for _, child := range children {
		child.RemoveIALAttr("heading-fold")
		child.RemoveIALAttr("fold")
	}
	headingNode.RemoveIALAttr("fold")

	luteEngine := util.NewLute()
	newTree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument, ID: srcHeadingID}, Context: &parse.Context{ParseOption: luteEngine.ParseOptions}}
	children = treenode.HeadingChildren(headingNode)
	for _, c := range children {
		newTree.Root.AppendChild(c)
	}
	newTree.ID = srcHeadingID
	newTree.Path = newTargetPath
	newTree.HPath = toHP
	headingNode.SetIALAttr("type", "doc")
	headingNode.SetIALAttr("id", srcHeadingID)
	headingNode.SetIALAttr("title", headingText)
	newTree.Root.KramdownIAL = headingNode.KramdownIAL

	topLevel := treenode.TopHeadingLevel(newTree)
	for c := newTree.Root.FirstChild; nil != c; c = c.Next {
		if ast.NodeHeading == c.Type {
			c.HeadingLevel = c.HeadingLevel - topLevel + 1
			if 6 < c.HeadingLevel {
				c.HeadingLevel = 6
			}
		}
	}

	headingNode.Unlink()
	srcTree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	if nil == srcTree.Root.FirstChild {
		srcTree.Root.AppendChild(treenode.NewParagraph())
	}
	treenode.RemoveBlockTreesByRootID(srcTree.ID)
	if err = indexWriteJSONQueue(srcTree); nil != err {
		return "", "", err
	}

	newTree.Box, newTree.Path = targetBoxID, newTargetPath
	newTree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	newTree.Root.Spec = "1"
	if err = indexWriteJSONQueue(newTree); nil != err {
		return "", "", err
	}
	IncSync()
	RefreshBacklink(srcTree.ID)
	RefreshBacklink(newTree.ID)
	return
}
