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
	"time"

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
	if err != nil {
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
		ast.Walk(child, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			n.SetIALAttr("fold", "1")
			n.SetIALAttr("heading-fold", "1")
			return ast.WalkContinue
		})
	}
	heading.SetIALAttr("fold", "1")

	tx.writeTree(tree)
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
	if err != nil {
		return &TxErr{code: TxErrCodeBlockNotFound, id: headingID}
	}

	heading := treenode.GetNodeInTree(tree, headingID)
	if nil == heading {
		return &TxErr{code: TxErrCodeBlockNotFound, id: headingID}
	}

	luteEngine := NewLute()
	parentFoldedHeading := treenode.GetParentFoldedHeading(heading)
	if nil != parentFoldedHeading {
		// 如果当前标题在上方某个折叠的标题下方，则展开上方那个折叠标题以保持一致性
		children := treenode.HeadingChildren(parentFoldedHeading)
		for _, child := range children {
			ast.Walk(child, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering || !n.IsBlock() {
					return ast.WalkContinue
				}

				n.RemoveIALAttr("heading-fold")
				n.RemoveIALAttr("fold")
				return ast.WalkContinue
			})
		}
		parentFoldedHeading.RemoveIALAttr("fold")
		parentFoldedHeading.RemoveIALAttr("heading-fold")
		go func() {
			tx.WaitForCommit()
			ReloadProtyle(tree.ID)
		}()
	}

	children := treenode.HeadingChildren(heading)
	for _, child := range children {
		ast.Walk(child, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			n.RemoveIALAttr("heading-fold")
			n.RemoveIALAttr("fold")
			return ast.WalkContinue
		})
	}
	heading.RemoveIALAttr("fold")
	heading.RemoveIALAttr("heading-fold")

	tx.writeTree(tree)
	IncSync()

	cache.PutBlockIAL(headingID, parse.IAL2Map(heading.KramdownIAL))
	for _, child := range children {
		cache.PutBlockIAL(child.ID, parse.IAL2Map(child.KramdownIAL))
	}
	sql.UpsertTreeQueue(tree)

	// 展开折叠的标题后显示块引用计数 Display reference counts after unfolding headings https://github.com/siyuan-note/siyuan/issues/13618
	fillBlockRefCount(children)

	operation.RetData = renderBlockDOMByNodes(children, luteEngine)
	return
}

func Doc2Heading(srcID, targetID string, after bool) (srcTreeBox, srcTreePath string, err error) {
	if !ast.IsNodeIDPattern(srcID) || !ast.IsNodeIDPattern(targetID) {
		return
	}

	FlushTxQueue()

	srcTree, _ := LoadTreeByBlockID(srcID)
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

	if nil == treenode.GetBlockTree(targetID) {
		// 目标块不存在时忽略处理
		return
	}

	targetTree, _ := LoadTreeByBlockID(targetID)
	if nil == targetTree {
		// 目标块不存在时忽略处理
		return
	}

	pivot := treenode.GetNodeInTree(targetTree, targetID)
	if nil == pivot {
		err = ErrBlockNotFound
		return
	}

	// 生成文档历史 https://github.com/siyuan-note/siyuan/issues/14359
	generateOpTypeHistory(srcTree, HistoryOpUpdate)

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

	srcTree.Root.RemoveIALAttr("scroll") // Remove `scroll` attribute when converting the document to a heading https://github.com/siyuan-note/siyuan/issues/9297
	srcTree.Root.RemoveIALAttr("type")
	tagIAL := srcTree.Root.IALAttr("tags")
	tags := strings.Split(tagIAL, ",")
	srcTree.Root.RemoveIALAttr("tags")
	heading := &ast.Node{ID: srcTree.Root.ID, Type: ast.NodeHeading, HeadingLevel: headingLevel, KramdownIAL: srcTree.Root.KramdownIAL}
	heading.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(srcTree.Root.IALAttr("title"))})
	heading.RemoveIALAttr("title")
	heading.Box, heading.Path = targetTree.Box, targetTree.Path
	if "" != tagIAL && 0 < len(tags) {
		// 带标签的文档块转换为标题块时将标签移动到标题块下方 https://github.com/siyuan-note/siyuan/issues/6550

		tagPara := treenode.NewParagraph("")
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

	box := Conf.Box(srcTree.Box)
	if removeErr := box.Remove(srcTree.Path); nil != removeErr {
		logging.LogWarnf("remove tree [%s] failed: %s", srcTree.Path, removeErr)
	}
	box.removeSort([]string{srcTree.ID})
	evt := util.NewCmdResult("removeDoc", 0, util.PushModeBroadcast)
	evt.Data = map[string]interface{}{
		"ids": []string{srcTree.ID},
	}
	util.PushEvent(evt)

	srcTreeBox, srcTreePath = srcTree.Box, srcTree.Path // 返回旧的文档块位置，前端后续会删除旧的文档块
	targetTree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	treenode.RemoveBlockTreesByRootID(srcTree.ID)
	treenode.RemoveBlockTreesByRootID(targetTree.ID)
	err = indexWriteTreeUpsertQueue(targetTree)
	IncSync()
	go func() {
		time.Sleep(util.SQLFlushInterval)
		RefreshBacklink(srcTree.ID)
		RefreshBacklink(targetTree.ID)
		ResetVirtualBlockRefCache()
	}()
	return
}

func Heading2Doc(srcHeadingID, targetBoxID, targetPath, previousPath string) (srcRootBlockID, newTargetPath string, err error) {
	FlushTxQueue()

	srcTree, _ := LoadTreeByBlockID(srcHeadingID)
	if nil == srcTree {
		err = ErrBlockNotFound
		return
	}
	srcRootBlockID = srcTree.Root.ID

	headingBlock, err := getBlock(srcHeadingID, srcTree)
	if err != nil {
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
	headingText := getNodeRefText0(headingNode, Conf.Editor.BlockRefDynamicAnchorTextMaxLen, true)
	if strings.Contains(headingText, "/") {
		headingText = strings.ReplaceAll(headingText, "/", "_")
		util.PushMsg(Conf.language(246), 7000)
	}

	moveToRoot := "/" == targetPath
	toHP := path.Join("/", headingText)
	toFolder := "/"
	if "" != previousPath {
		previousDoc := treenode.GetBlockTreeRootByPath(targetBoxID, previousPath)
		if nil == previousDoc {
			err = ErrBlockNotFound
			return
		}
		parentPath := path.Dir(previousPath)
		if "/" != parentPath {
			parentPath = strings.TrimSuffix(parentPath, "/") + ".sy"
			parentDoc := treenode.GetBlockTreeRootByPath(targetBoxID, parentPath)
			if nil == parentDoc {
				err = ErrBlockNotFound
				return
			}
			toHP = path.Join(parentDoc.HPath, headingText)
			toFolder = path.Join(path.Dir(parentPath), parentDoc.ID)
		}
	} else {
		if !moveToRoot {
			parentDoc := treenode.GetBlockTreeRootByPath(targetBoxID, targetPath)
			if nil == parentDoc {
				err = ErrBlockNotFound
				return
			}
			toHP = path.Join(parentDoc.HPath, headingText)
			toFolder = path.Join(path.Dir(targetPath), parentDoc.ID)
		}
	}

	newTargetPath = path.Join(toFolder, srcHeadingID+".sy")
	if !box.Exist(toFolder) {
		if err = box.MkdirAll(toFolder); err != nil {
			return
		}
	}

	// 折叠标题转换为文档时需要自动展开下方块 https://github.com/siyuan-note/siyuan/issues/2947
	children := treenode.HeadingChildren(headingNode)
	for _, child := range children {
		ast.Walk(child, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			n.RemoveIALAttr("heading-fold")
			n.RemoveIALAttr("fold")
			return ast.WalkContinue
		})
	}
	headingNode.RemoveIALAttr("fold")
	headingNode.RemoveIALAttr("heading-fold")

	luteEngine := util.NewLute()
	newTree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument, ID: srcHeadingID}, Context: &parse.Context{ParseOption: luteEngine.ParseOptions}}
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
			c.HeadingLevel = c.HeadingLevel - topLevel + 2
			if 6 < c.HeadingLevel {
				c.HeadingLevel = 6
			}
		}
	}

	headingNode.Unlink()
	srcTree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	if nil == srcTree.Root.FirstChild {
		srcTree.Root.AppendChild(treenode.NewParagraph(""))
	}
	treenode.RemoveBlockTreesByRootID(srcTree.ID)
	if err = indexWriteTreeUpsertQueue(srcTree); err != nil {
		return "", "", err
	}

	newTree.Box, newTree.Path = targetBoxID, newTargetPath
	newTree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	newTree.Root.Spec = treenode.CurrentSpec
	if "" != previousPath {
		box.addSort(previousPath, newTree.ID)
	} else {
		box.setSortByConf(path.Dir(newTargetPath), newTree.ID)
	}
	if err = indexWriteTreeUpsertQueue(newTree); err != nil {
		return "", "", err
	}
	IncSync()
	go func() {
		RefreshBacklink(srcTree.ID)
		RefreshBacklink(newTree.ID)
		ResetVirtualBlockRefCache()
	}()
	return
}
