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
	"errors"
	"fmt"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/lex"
	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func IsFoldHeading(transactions *[]*Transaction) bool {
	for _, tx := range *transactions {
		for _, op := range tx.DoOperations {
			if "foldHeading" == op.Action {
				return true
			}
		}
	}
	return false
}

func IsUnfoldHeading(transactions *[]*Transaction) bool {
	for _, tx := range *transactions {
		for _, op := range tx.DoOperations {
			if "unfoldHeading" == op.Action {
				return true
			}
		}
	}
	return false
}

func IsMoveOutlineHeading(transactions *[]*Transaction) bool {
	for _, tx := range *transactions {
		for _, op := range tx.DoOperations {
			if "moveOutlineHeading" == op.Action {
				return true
			}
		}
	}
	return false
}

func WaitForWritingFiles() {
	var printLog bool
	var lastPrintLog bool
	for i := 0; isWritingFiles(); i++ {
		time.Sleep(5 * time.Millisecond)
		if 2000 < i && !printLog { // 10s 后打日志
			logging.LogWarnf("file is writing: \n%s", logging.ShortStack())
			printLog = true
		}
		if 12000 < i && !lastPrintLog { // 60s 后打日志
			logging.LogWarnf("file is still writing")
			lastPrintLog = true
		}
	}
}

var (
	txQueue   = make(chan *Transaction, 7)
	flushLock = sync.Mutex{}
)

func isWritingFiles() bool {
	time.Sleep(time.Duration(50) * time.Millisecond)
	return 0 < len(txQueue)
}

func init() {
	go func() {
		for {
			select {
			case tx := <-txQueue:
				flushTx(tx)
			}
		}
	}()
}

func flushTx(tx *Transaction) {
	defer logging.Recover()
	flushLock.Lock()
	defer flushLock.Unlock()

	start := time.Now()
	if txErr := performTx(tx); nil != txErr {
		switch txErr.code {
		case TxErrCodeBlockNotFound:
			util.PushTxErr("Transaction failed", txErr.code, nil)
			return
		case TxErrCodeDataIsSyncing:
			util.PushMsg(Conf.Language(222), 5000)
		default:
			txData, _ := gulu.JSON.MarshalJSON(tx)
			logging.LogFatalf(logging.ExitCodeFatal, "transaction failed [%d]: %s\n  tx [%s]", txErr.code, txErr.msg, txData)
		}
	}
	elapsed := time.Now().Sub(start).Milliseconds()
	if 0 < len(tx.DoOperations) {
		if 2000 < elapsed {
			logging.LogWarnf("op tx [%dms]", elapsed)
		}
	}
}

func PerformTransactions(transactions *[]*Transaction) {
	for _, tx := range *transactions {
		tx.m = &sync.Mutex{}
		txQueue <- tx
	}
	return
}

const (
	TxErrCodeBlockNotFound  = 0
	TxErrCodeDataIsSyncing  = 1
	TxErrCodeWriteTree      = 2
	TxErrWriteAttributeView = 3
)

type TxErr struct {
	code int
	msg  string
	id   string
}

func performTx(tx *Transaction) (ret *TxErr) {
	if 1 > len(tx.DoOperations) {
		return
	}

	//os.MkdirAll("pprof", 0755)
	//cpuProfile, _ := os.Create("pprof/cpu_profile_tx")
	//pprof.StartCPUProfile(cpuProfile)
	//defer pprof.StopCPUProfile()

	var err error
	if err = tx.begin(); nil != err {
		if strings.Contains(err.Error(), "database is closed") {
			return
		}
		logging.LogErrorf("begin tx failed: %s", err)
		ret = &TxErr{msg: err.Error()}
		return
	}

	defer func() {
		if e := recover(); nil != e {
			stack := debug.Stack()
			msg := fmt.Sprintf("PANIC RECOVERED: %v\n\t%s\n", e, stack)
			logging.LogErrorf(msg)

			if 1 == tx.state.Load() {
				tx.rollback()
				return
			}
		}
	}()

	for _, op := range tx.DoOperations {
		switch op.Action {
		case "create":
			ret = tx.doCreate(op)
		case "update":
			ret = tx.doUpdate(op)
		case "insert":
			ret = tx.doInsert(op)
		case "delete":
			ret = tx.doDelete(op)
		case "move":
			ret = tx.doMove(op)
		case "moveOutlineHeading":
			ret = tx.doMoveOutlineHeading(op)
		case "append":
			ret = tx.doAppend(op)
		case "appendInsert":
			ret = tx.doAppendInsert(op)
		case "prependInsert":
			ret = tx.doPrependInsert(op)
		case "foldHeading":
			ret = tx.doFoldHeading(op)
		case "unfoldHeading":
			ret = tx.doUnfoldHeading(op)
		case "setAttrs":
			ret = tx.doSetAttrs(op)
		case "doUpdateUpdated":
			ret = tx.doUpdateUpdated(op)
		case "addFlashcards":
			ret = tx.doAddFlashcards(op)
		case "removeFlashcards":
			ret = tx.doRemoveFlashcards(op)
		case "setAttrViewName":
			ret = tx.doSetAttrViewName(op)
		case "setAttrViewFilters":
			ret = tx.doSetAttrViewFilters(op)
		case "setAttrViewSorts":
			ret = tx.doSetAttrViewSorts(op)
		case "setAttrViewPageSize":
			ret = tx.doSetAttrViewPageSize(op)
		case "setAttrViewColWidth":
			ret = tx.doSetAttrViewColumnWidth(op)
		case "setAttrViewColWrap":
			ret = tx.doSetAttrViewColumnWrap(op)
		case "setAttrViewColHidden":
			ret = tx.doSetAttrViewColumnHidden(op)
		case "setAttrViewColPin":
			ret = tx.doSetAttrViewColumnPin(op)
		case "setAttrViewColIcon":
			ret = tx.doSetAttrViewColumnIcon(op)
		case "insertAttrViewBlock":
			ret = tx.doInsertAttrViewBlock(op)
		case "removeAttrViewBlock":
			ret = tx.doRemoveAttrViewBlock(op)
		case "addAttrViewCol":
			ret = tx.doAddAttrViewColumn(op)
		case "updateAttrViewCol":
			ret = tx.doUpdateAttrViewColumn(op)
		case "removeAttrViewCol":
			ret = tx.doRemoveAttrViewColumn(op)
		case "sortAttrViewRow":
			ret = tx.doSortAttrViewRow(op)
		case "sortAttrViewCol":
			ret = tx.doSortAttrViewColumn(op)
		case "sortAttrViewKey":
			ret = tx.doSortAttrViewKey(op)
		case "updateAttrViewCell":
			ret = tx.doUpdateAttrViewCell(op)
		case "updateAttrViewColOptions":
			ret = tx.doUpdateAttrViewColOptions(op)
		case "removeAttrViewColOption":
			ret = tx.doRemoveAttrViewColOption(op)
		case "updateAttrViewColOption":
			ret = tx.doUpdateAttrViewColOption(op)
		case "setAttrViewColCalc":
			ret = tx.doSetAttrViewColCalc(op)
		case "updateAttrViewColNumberFormat":
			ret = tx.doUpdateAttrViewColNumberFormat(op)
		case "replaceAttrViewBlock":
			ret = tx.doReplaceAttrViewBlock(op)
		case "updateAttrViewColTemplate":
			ret = tx.doUpdateAttrViewColTemplate(op)
		case "addAttrViewView":
			ret = tx.doAddAttrViewView(op)
		case "removeAttrViewView":
			ret = tx.doRemoveAttrViewView(op)
		case "setAttrViewViewName":
			ret = tx.doSetAttrViewViewName(op)
		case "setAttrViewViewIcon":
			ret = tx.doSetAttrViewViewIcon(op)
		case "duplicateAttrViewView":
			ret = tx.doDuplicateAttrViewView(op)
		case "sortAttrViewView":
			ret = tx.doSortAttrViewView(op)
		case "updateAttrViewColRelation":
			ret = tx.doUpdateAttrViewColRelation(op)
		case "updateAttrViewColRollup":
			ret = tx.doUpdateAttrViewColRollup(op)
		case "hideAttrViewName":
			ret = tx.doHideAttrViewName(op)
		case "setAttrViewColDate":
			ret = tx.doSetAttrViewColDate(op)
		case "unbindAttrViewBlock":
			ret = tx.doUnbindAttrViewBlock(op)
		case "duplicateAttrViewKey":
			ret = tx.doDuplicateAttrViewKey(op)
		}

		if nil != ret {
			tx.rollback()
			return
		}
	}

	if cr := tx.commit(); nil != cr {
		logging.LogErrorf("commit tx failed: %s", cr)
		return &TxErr{msg: cr.Error()}
	}
	return
}

func (tx *Transaction) doMove(operation *Operation) (ret *TxErr) {
	var err error
	id := operation.ID
	srcTree, err := tx.loadTree(id)
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", id, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	srcNode := treenode.GetNodeInTree(srcTree, id)
	if nil == srcNode {
		logging.LogErrorf("get node [%s] in tree [%s] failed", id, srcTree.Root.ID)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	var headingChildren []*ast.Node
	if isMovingFoldHeading := ast.NodeHeading == srcNode.Type && "1" == srcNode.IALAttr("fold"); isMovingFoldHeading {
		headingChildren = treenode.HeadingChildren(srcNode)
		// Blocks below other non-folded headings are no longer moved when moving a folded heading https://github.com/siyuan-note/siyuan/issues/8321
		headingChildren = treenode.GetHeadingFold(headingChildren)
	}

	refreshHeadingChildrenUpdated(srcNode, time.Now().Format("20060102150405"))

	var srcEmptyList *ast.Node
	if ast.NodeListItem == srcNode.Type && srcNode.Parent.FirstChild == srcNode && srcNode.Parent.LastChild == srcNode {
		// 列表中唯一的列表项被移除后，该列表就为空了
		srcEmptyList = srcNode.Parent
	}

	targetPreviousID := operation.PreviousID
	targetParentID := operation.ParentID
	if "" != targetPreviousID {
		if id == targetPreviousID {
			return
		}

		var targetTree *parse.Tree
		targetTree, err = tx.loadTree(targetPreviousID)
		if nil != err {
			logging.LogErrorf("load tree [%s] failed: %s", targetPreviousID, err)
			return &TxErr{code: TxErrCodeBlockNotFound, id: targetPreviousID}
		}
		isSameTree := srcTree.ID == targetTree.ID
		if isSameTree {
			targetTree = srcTree
		}

		targetNode := treenode.GetNodeInTree(targetTree, targetPreviousID)
		if nil == targetNode {
			logging.LogErrorf("get node [%s] in tree [%s] failed", targetPreviousID, targetTree.Root.ID)
			return &TxErr{code: TxErrCodeBlockNotFound, id: targetPreviousID}
		}

		if ast.NodeHeading == targetNode.Type && "1" == targetNode.IALAttr("fold") {
			targetChildren := treenode.HeadingChildren(targetNode)
			targetChildren = treenode.GetHeadingFold(targetChildren)

			if l := len(targetChildren); 0 < l {
				targetNode = targetChildren[l-1]
			}
		}

		if isMovingFoldHeadingIntoSelf(targetNode, headingChildren) {
			return
		}

		for i := len(headingChildren) - 1; -1 < i; i-- {
			c := headingChildren[i]
			targetNode.InsertAfter(c)
		}
		targetNode.InsertAfter(srcNode)
		if nil != srcEmptyList {
			srcEmptyList.Unlink()
		}

		refreshHeadingChildrenUpdated(srcNode, time.Now().Format("20060102150405"))

		refreshUpdated(srcNode)
		refreshUpdated(srcTree.Root)
		if err = tx.writeTree(srcTree); nil != err {
			return
		}
		if !isSameTree {
			if err = tx.writeTree(targetTree); nil != err {
				return
			}
		}
		return
	}

	if id == targetParentID {
		return
	}

	targetTree, err := tx.loadTree(targetParentID)
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", targetParentID, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: targetParentID}
	}
	isSameTree := srcTree.ID == targetTree.ID
	if isSameTree {
		targetTree = srcTree
	}

	targetNode := treenode.GetNodeInTree(targetTree, targetParentID)
	if nil == targetNode {
		logging.LogErrorf("get node [%s] in tree [%s] failed", targetParentID, targetTree.Root.ID)
		return &TxErr{code: TxErrCodeBlockNotFound, id: targetParentID}
	}

	if isMovingFoldHeadingIntoSelf(targetNode, headingChildren) {
		return
	}

	processed := false
	if ast.NodeSuperBlock == targetNode.Type {
		// 在布局节点后插入
		targetNode = targetNode.FirstChild.Next
		for i := len(headingChildren) - 1; -1 < i; i-- {
			c := headingChildren[i]
			targetNode.InsertAfter(c)
		}
		targetNode.InsertAfter(srcNode)
		if nil != srcEmptyList {
			srcEmptyList.Unlink()
		}
		processed = true
	} else if ast.NodeListItem == targetNode.Type {
		if 3 == targetNode.ListData.Typ {
			// 在任务列表标记节点后插入
			targetNode = targetNode.FirstChild
			for i := len(headingChildren) - 1; -1 < i; i-- {
				c := headingChildren[i]
				targetNode.InsertAfter(c)
			}
			targetNode.InsertAfter(srcNode)
			if nil != srcEmptyList {
				srcEmptyList.Unlink()
			}
			processed = true
		}
	}

	if !processed {
		for i := len(headingChildren) - 1; -1 < i; i-- {
			c := headingChildren[i]
			targetNode.PrependChild(c)
		}

		targetNode.PrependChild(srcNode)
		if nil != srcEmptyList {
			srcEmptyList.Unlink()
		}
	}

	refreshHeadingChildrenUpdated(srcNode, time.Now().Format("20060102150405"))

	refreshUpdated(srcNode)
	refreshUpdated(srcTree.Root)
	if err = tx.writeTree(srcTree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: id}
	}
	if !isSameTree {
		if err = tx.writeTree(targetTree); nil != err {
			return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: id}
		}
	}
	return
}

func isMovingFoldHeadingIntoSelf(targetNode *ast.Node, headingChildren []*ast.Node) bool {
	for _, headingChild := range headingChildren {
		if headingChild.ID == targetNode.ID {
			// 不能将折叠标题移动到自己下方节点的前或后 https://github.com/siyuan-note/siyuan/issues/7163
			return true
		}
	}
	return false
}

func (tx *Transaction) doPrependInsert(operation *Operation) (ret *TxErr) {
	var err error
	block := treenode.GetBlockTree(operation.ParentID)
	if nil == block {
		logging.LogWarnf("not found block [%s]", operation.ParentID)
		util.ReloadUI() // 比如分屏后编辑器状态不一致，这里强制重新载入界面
		return
	}
	tree, err := tx.loadTree(block.ID)
	if nil != err {
		msg := fmt.Sprintf("load tree [%s] failed: %s", block.ID, err)
		logging.LogErrorf(msg)
		return &TxErr{code: TxErrCodeBlockNotFound, id: block.ID}
	}

	data := strings.ReplaceAll(operation.Data.(string), editor.FrontEndCaret, "")
	subTree := tx.luteEngine.BlockDOM2Tree(data)
	insertedNode := subTree.Root.FirstChild
	if nil == insertedNode {
		return &TxErr{code: TxErrCodeBlockNotFound, msg: "invalid data tree", id: block.ID}
	}
	var remains []*ast.Node
	for remain := insertedNode.Next; nil != remain; remain = remain.Next {
		if ast.NodeKramdownBlockIAL != remain.Type {
			if "" == remain.ID {
				remain.ID = ast.NewNodeID()
				remain.SetIALAttr("id", remain.ID)
			}
			remains = append(remains, remain)
		}
	}
	if "" == insertedNode.ID {
		insertedNode.ID = ast.NewNodeID()
		insertedNode.SetIALAttr("id", insertedNode.ID)
	}

	node := treenode.GetNodeInTree(tree, operation.ParentID)
	if nil == node {
		logging.LogErrorf("get node [%s] in tree [%s] failed", operation.ParentID, tree.Root.ID)
		return &TxErr{code: TxErrCodeBlockNotFound, id: operation.ParentID}
	}
	isContainer := node.IsContainerBlock()
	for i := len(remains) - 1; 0 <= i; i-- {
		remain := remains[i]
		if isContainer {
			if ast.NodeListItem == node.Type && 3 == node.ListData.Typ {
				node.FirstChild.InsertAfter(remain)
			} else if ast.NodeSuperBlock == node.Type {
				node.FirstChild.Next.InsertAfter(remain)
			} else {
				node.PrependChild(remain)
			}
		} else {
			node.InsertAfter(remain)
		}
	}
	if isContainer {
		if ast.NodeListItem == node.Type && 3 == node.ListData.Typ {
			node.FirstChild.InsertAfter(insertedNode)
		} else if ast.NodeSuperBlock == node.Type {
			node.FirstChild.Next.InsertAfter(insertedNode)
		} else {
			node.PrependChild(insertedNode)
		}
	} else {
		node.InsertAfter(insertedNode)
	}
	createdUpdated(insertedNode)
	tx.nodes[insertedNode.ID] = insertedNode
	if err = tx.writeTree(tree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: block.ID}
	}

	operation.ID = insertedNode.ID
	operation.ParentID = insertedNode.Parent.ID

	// 将 prependInsert 转换为 insert 推送
	operation.Action = "insert"
	if nil != insertedNode.Previous {
		operation.PreviousID = insertedNode.Previous.ID
	}
	return
}

func (tx *Transaction) doAppendInsert(operation *Operation) (ret *TxErr) {
	var err error
	block := treenode.GetBlockTree(operation.ParentID)
	if nil == block {
		logging.LogWarnf("not found block [%s]", operation.ParentID)
		util.ReloadUI() // 比如分屏后编辑器状态不一致，这里强制重新载入界面
		return
	}
	tree, err := tx.loadTree(block.ID)
	if nil != err {
		msg := fmt.Sprintf("load tree [%s] failed: %s", block.ID, err)
		logging.LogErrorf(msg)
		return &TxErr{code: TxErrCodeBlockNotFound, id: block.ID}
	}

	data := strings.ReplaceAll(operation.Data.(string), editor.FrontEndCaret, "")
	subTree := tx.luteEngine.BlockDOM2Tree(data)
	insertedNode := subTree.Root.FirstChild
	if nil == insertedNode {
		return &TxErr{code: TxErrCodeBlockNotFound, msg: "invalid data tree", id: block.ID}
	}
	if "" == insertedNode.ID {
		insertedNode.ID = ast.NewNodeID()
		insertedNode.SetIALAttr("id", insertedNode.ID)
	}
	var toInserts []*ast.Node
	for toInsert := insertedNode; nil != toInsert; toInsert = toInsert.Next {
		if ast.NodeKramdownBlockIAL != toInsert.Type {
			if "" == toInsert.ID {
				toInsert.ID = ast.NewNodeID()
				toInsert.SetIALAttr("id", toInsert.ID)
			}
			toInserts = append(toInserts, toInsert)
		}
	}

	node := treenode.GetNodeInTree(tree, operation.ParentID)
	if nil == node {
		logging.LogErrorf("get node [%s] in tree [%s] failed", operation.ParentID, tree.Root.ID)
		return &TxErr{code: TxErrCodeBlockNotFound, id: operation.ParentID}
	}
	isContainer := node.IsContainerBlock()
	for i := 0; i < len(toInserts); i++ {
		toInsert := toInserts[i]
		if isContainer {
			if ast.NodeList == node.Type {
				// 列表下只能挂列表项，所以这里需要分情况处理 https://github.com/siyuan-note/siyuan/issues/9955
				if ast.NodeList == toInsert.Type {
					var childLis []*ast.Node
					for childLi := toInsert.FirstChild; nil != childLi; childLi = childLi.Next {
						childLis = append(childLis, childLi)
					}
					for _, childLi := range childLis {
						node.AppendChild(childLi)
					}
				} else {
					newLiID := ast.NewNodeID()
					newLi := &ast.Node{ID: newLiID, Type: ast.NodeListItem, ListData: &ast.ListData{Typ: node.ListData.Typ}}
					newLi.SetIALAttr("id", newLiID)
					node.AppendChild(newLi)
					newLi.AppendChild(toInsert)
				}
			} else if ast.NodeSuperBlock == node.Type {
				node.LastChild.InsertBefore(toInsert)
			} else {
				node.AppendChild(toInsert)
			}
		} else {
			node.InsertAfter(toInsert)
		}
	}

	createdUpdated(insertedNode)
	tx.nodes[insertedNode.ID] = insertedNode
	if err = tx.writeTree(tree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: block.ID}
	}

	operation.ID = insertedNode.ID
	operation.ParentID = insertedNode.Parent.ID

	// 将 appendInsert 转换为 insert 推送
	operation.Action = "insert"
	if nil != insertedNode.Previous {
		operation.PreviousID = insertedNode.Previous.ID
	}
	return
}

func (tx *Transaction) doAppend(operation *Operation) (ret *TxErr) {
	var err error
	id := operation.ID
	srcTree, err := tx.loadTree(id)
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", id, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	srcNode := treenode.GetNodeInTree(srcTree, id)
	if nil == srcNode {
		logging.LogErrorf("get node [%s] in tree [%s] failed", id, srcTree.Root.ID)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	if ast.NodeDocument == srcNode.Type {
		logging.LogWarnf("can't append a root to another root")
		return
	}

	var headingChildren []*ast.Node
	if isMovingFoldHeading := ast.NodeHeading == srcNode.Type && "1" == srcNode.IALAttr("fold"); isMovingFoldHeading {
		headingChildren = treenode.HeadingChildren(srcNode)
	}
	var srcEmptyList, targetNewList *ast.Node
	if ast.NodeListItem == srcNode.Type {
		targetNewListID := ast.NewNodeID()
		targetNewList = &ast.Node{ID: targetNewListID, Type: ast.NodeList, ListData: &ast.ListData{Typ: srcNode.ListData.Typ}}
		targetNewList.SetIALAttr("id", targetNewListID)
		if srcNode.Parent.FirstChild == srcNode && srcNode.Parent.LastChild == srcNode {
			// 列表中唯一的列表项被移除后，该列表就为空了
			srcEmptyList = srcNode.Parent
		}
	}

	targetRootID := operation.ParentID
	if id == targetRootID {
		logging.LogWarnf("target root id is nil")
		return
	}

	targetTree, err := tx.loadTree(targetRootID)
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", targetRootID, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: targetRootID}
	}
	isSameTree := srcTree.ID == targetTree.ID
	if isSameTree {
		targetTree = srcTree
	}

	targetRoot := targetTree.Root
	if nil != targetNewList {
		if nil != targetRoot.LastChild {
			if ast.NodeList != targetRoot.LastChild.Type {
				targetNewList.AppendChild(srcNode)
				targetRoot.AppendChild(targetNewList)
			} else {
				targetRoot.LastChild.AppendChild(srcNode)
			}
		} else {
			targetRoot.AppendChild(srcNode)
		}
	} else {
		targetRoot.AppendChild(srcNode)
	}
	for _, c := range headingChildren {
		targetRoot.AppendChild(c)
	}
	if nil != srcEmptyList {
		srcEmptyList.Unlink()
	}

	if err = tx.writeTree(srcTree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: id}
	}

	if !isSameTree {
		if err = tx.writeTree(targetTree); nil != err {
			return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: id}
		}
	}
	return
}

func (tx *Transaction) doDelete(operation *Operation) (ret *TxErr) {
	//	logging.LogInfof("commit delete [%+v]", operation)

	var err error
	id := operation.ID
	tree, err := tx.loadTree(id)
	if nil != err {
		if errors.Is(err, ErrBlockNotFound) {
			// move 以后这里会空，算作正常情况
			return
		}

		msg := fmt.Sprintf("load tree [%s] failed: %s", id, err)
		logging.LogErrorf(msg)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return nil // move 以后的情况，列表项移动导致的状态异常 https://github.com/siyuan-note/insider/issues/961
	}

	parent := node.Parent
	if nil != node.Next && ast.NodeKramdownBlockIAL == node.Next.Type && bytes.Contains(node.Next.Tokens, []byte(node.ID)) {
		// 列表块撤销状态异常 https://github.com/siyuan-note/siyuan/issues/3985
		node.Next.Unlink()
	}

	refreshHeadingChildrenUpdated(node, time.Now().Format("20060102150405"))

	node.Unlink()
	if nil != parent && ast.NodeListItem == parent.Type && nil == parent.FirstChild {
		// 保持空列表项
		node.FirstChild = nil
		parent.AppendChild(node)
	}
	treenode.RemoveBlockTree(node.ID)

	delete(tx.nodes, node.ID)
	if err = tx.writeTree(tree); nil != err {
		return
	}

	syncDelete2AttributeView(node)
	removeAvBlockRel(node)
	return
}

func removeAvBlockRel(node *ast.Node) {
	var avIDs []string
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeAttributeView == n.Type {
			avID := n.AttributeViewID
			if changed := av.RemoveBlockRel(avID, n.ID, treenode.ExistBlockTree); changed {
				avIDs = append(avIDs, avID)
			}
		}
		return ast.WalkContinue
	})
	avIDs = gulu.Str.RemoveDuplicatedElem(avIDs)
	for _, avID := range avIDs {
		util.PushReloadAttrView(avID)
	}
}

func syncDelete2AttributeView(node *ast.Node) {
	changedAvIDs := hashset.New()
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() {
			return ast.WalkContinue
		}

		avs := n.IALAttr(av.NodeAttrNameAvs)
		if "" == avs {
			return ast.WalkContinue
		}

		avIDs := strings.Split(avs, ",")
		for _, avID := range avIDs {
			attrView, parseErr := av.ParseAttributeView(avID)
			if nil != parseErr {
				continue
			}

			changedAv := false
			blockValues := attrView.GetBlockKeyValues()
			if nil == blockValues {
				continue
			}

			for i, blockValue := range blockValues.Values {
				if blockValue.Block.ID == n.ID {
					blockValues.Values = append(blockValues.Values[:i], blockValues.Values[i+1:]...)
					changedAv = true
					break
				}
			}

			if changedAv {
				av.SaveAttributeView(attrView)
				changedAvIDs.Add(avID)
			}
		}
		return ast.WalkContinue
	})

	for _, avID := range changedAvIDs.Values() {
		util.PushReloadAttrView(avID.(string))
	}
}

func (tx *Transaction) doInsert(operation *Operation) (ret *TxErr) {
	var err error
	opParentID := operation.ParentID
	block := treenode.GetBlockTree(opParentID)
	if nil == block {
		block = treenode.GetBlockTree(operation.PreviousID)
		if nil == block {
			block = treenode.GetBlockTree(operation.NextID)
		}
	}
	if nil == block {
		logging.LogWarnf("not found block [%s, %s, %s]", operation.ParentID, operation.PreviousID, operation.NextID)
		util.ReloadUI() // 比如分屏后编辑器状态不一致，这里强制重新载入界面
		return
	}

	tree, err := tx.loadTree(block.ID)
	if nil != err {
		msg := fmt.Sprintf("load tree [%s] failed: %s", block.ID, err)
		logging.LogErrorf(msg)
		return &TxErr{code: TxErrCodeBlockNotFound, id: block.ID}
	}

	data := strings.ReplaceAll(operation.Data.(string), editor.FrontEndCaret, "")
	subTree := tx.luteEngine.BlockDOM2Tree(data)

	p := block.Path
	assets := getAssetsDir(filepath.Join(util.DataDir, block.BoxID), filepath.Dir(filepath.Join(util.DataDir, block.BoxID, p)))
	isGlobalAssets := strings.HasPrefix(assets, filepath.Join(util.DataDir, "assets"))
	if !isGlobalAssets {
		// 本地资源文件需要移动到用户手动建立的 assets 下 https://github.com/siyuan-note/siyuan/issues/2410
		ast.Walk(subTree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if ast.NodeLinkDest == n.Type && bytes.HasPrefix(n.Tokens, []byte("assets/")) {
				assetP := gulu.Str.FromBytes(n.Tokens)
				assetPath, e := GetAssetAbsPath(assetP)
				if nil != e {
					logging.LogErrorf("get path of asset [%s] failed: %s", assetP, err)
					return ast.WalkContinue
				}

				if !strings.HasPrefix(assetPath, filepath.Join(util.DataDir, "assets")) {
					// 非全局 assets 则跳过
					return ast.WalkContinue
				}

				// 只有全局 assets 才移动到相对 assets
				targetP := filepath.Join(assets, filepath.Base(assetPath))
				if e = filelock.Rename(assetPath, targetP); nil != err {
					logging.LogErrorf("copy path of asset from [%s] to [%s] failed: %s", assetPath, targetP, err)
					return ast.WalkContinue
				}
			}
			return ast.WalkContinue
		})
	}
	insertedNode := subTree.Root.FirstChild
	if nil == insertedNode {
		return &TxErr{code: TxErrCodeBlockNotFound, msg: "invalid data tree", id: block.ID}
	}
	var remains []*ast.Node
	for remain := insertedNode.Next; nil != remain; remain = remain.Next {
		if ast.NodeKramdownBlockIAL != remain.Type {
			if "" == remain.ID {
				remain.ID = ast.NewNodeID()
				remain.SetIALAttr("id", remain.ID)
			}
			remains = append(remains, remain)
		}
	}
	if "" == insertedNode.ID {
		insertedNode.ID = ast.NewNodeID()
		insertedNode.SetIALAttr("id", insertedNode.ID)
	}

	var node *ast.Node
	nextID := operation.NextID
	previousID := operation.PreviousID
	if "" != nextID {
		node = treenode.GetNodeInTree(tree, nextID)
		if nil == node {
			logging.LogErrorf("get node [%s] in tree [%s] failed", nextID, tree.Root.ID)
			return &TxErr{code: TxErrCodeBlockNotFound, id: nextID}
		}

		if ast.NodeList == insertedNode.Type && nil != node.Parent && ast.NodeList == node.Parent.Type {
			insertedNode = insertedNode.FirstChild
		}
		node.InsertBefore(insertedNode)
	} else if "" != previousID {
		node = treenode.GetNodeInTree(tree, previousID)
		if nil == node {
			logging.LogErrorf("get node [%s] in tree [%s] failed", previousID, tree.Root.ID)
			return &TxErr{code: TxErrCodeBlockNotFound, id: previousID}
		}

		if ast.NodeHeading == node.Type && "1" == node.IALAttr("fold") {
			children := treenode.HeadingChildren(node)
			if l := len(children); 0 < l {
				node = children[l-1]
			}
		}
		if ast.NodeList == insertedNode.Type && nil != node.Parent && ast.NodeList == node.Parent.Type {
			insertedNode = insertedNode.FirstChild
		}
		for i := len(remains) - 1; 0 <= i; i-- {
			remain := remains[i]
			node.InsertAfter(remain)
		}
		node.InsertAfter(insertedNode)
	} else {
		node = treenode.GetNodeInTree(tree, operation.ParentID)
		if nil == node {
			logging.LogErrorf("get node [%s] in tree [%s] failed", operation.ParentID, tree.Root.ID)
			return &TxErr{code: TxErrCodeBlockNotFound, id: operation.ParentID}
		}
		if ast.NodeSuperBlock == node.Type {
			// 在布局节点后插入
			node.FirstChild.Next.InsertAfter(insertedNode)
		} else {
			if ast.NodeList == insertedNode.Type && nil != insertedNode.FirstChild && operation.ID == insertedNode.FirstChild.ID && operation.ID != insertedNode.ID {
				// 将一个列表项移动到另一个列表的第一项时 https://github.com/siyuan-note/siyuan/issues/2341
				insertedNode = insertedNode.FirstChild
			}

			if ast.NodeListItem == node.Type && 3 == node.ListData.Typ {
				// 在任务列表标记节点后插入
				node.FirstChild.InsertAfter(insertedNode)
				for _, remain := range remains {
					node.FirstChild.InsertAfter(remain)
				}
			} else {
				for i := len(remains) - 1; 0 <= i; i-- {
					remain := remains[i]
					node.PrependChild(remain)
				}
				node.PrependChild(insertedNode)
			}
		}
	}

	refreshHeadingChildrenUpdated(insertedNode, time.Now().Format("20060102150405"))

	createdUpdated(insertedNode)
	tx.nodes[insertedNode.ID] = insertedNode
	if err = tx.writeTree(tree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: block.ID}
	}

	upsertAvBlockRel(insertedNode)

	operation.ID = insertedNode.ID
	operation.ParentID = insertedNode.Parent.ID

	checkUpsertInUserGuide(tree)
	return
}

func (tx *Transaction) doUpdate(operation *Operation) (ret *TxErr) {
	id := operation.ID
	tree, err := tx.loadTree(id)
	if nil != err {
		if errors.Is(err, ErrBlockNotFound) {
			logging.LogWarnf("not found block [%s]", id)
			return
		}

		logging.LogErrorf("load tree [%s] failed: %s", id, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	data := strings.ReplaceAll(operation.Data.(string), editor.FrontEndCaret, "")
	if "" == data {
		logging.LogErrorf("update data is nil")
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	subTree := tx.luteEngine.BlockDOM2Tree(data)
	subTree.ID, subTree.Box, subTree.Path = tree.ID, tree.Box, tree.Path
	oldNode := treenode.GetNodeInTree(tree, id)
	if nil == oldNode {
		logging.LogErrorf("get node [%s] in tree [%s] failed", id, tree.Root.ID)
		return &TxErr{msg: ErrBlockNotFound.Error(), id: id}
	}

	var unlinks []*ast.Node
	ast.Walk(subTree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeTextMark == n.Type {
			if n.IsTextMarkType("inline-math") {
				if "" == strings.TrimSpace(n.TextMarkInlineMathContent) {
					// 剔除空白的行级公式
					unlinks = append(unlinks, n)
				}
			} else if n.IsTextMarkType("block-ref") {
				sql.CacheRef(subTree, n)

				if "d" == n.TextMarkBlockRefSubtype {
					// 偶发编辑文档标题后引用处的动态锚文本不更新 https://github.com/siyuan-note/siyuan/issues/5891
					// 使用缓存的动态锚文本强制覆盖当前块中的引用节点动态锚文本
					if dRefText, ok := treenode.DynamicRefTexts.Load(n.TextMarkBlockRefID); ok && "" != dRefText {
						n.TextMarkTextContent = dRefText.(string)
					}
				}
			}
		}
		return ast.WalkContinue
	})

	for _, n := range unlinks {
		n.Unlink()
	}

	updatedNode := subTree.Root.FirstChild
	if nil == updatedNode {
		logging.LogErrorf("get fist node in sub tree [%s] failed", subTree.Root.ID)
		return &TxErr{msg: ErrBlockNotFound.Error(), id: id}
	}
	if ast.NodeList == updatedNode.Type && ast.NodeList == oldNode.Parent.Type {
		updatedNode = updatedNode.FirstChild
	}

	if oldNode.IsContainerBlock() {
		// 更新容器块的话需要考虑其子块中可能存在的折叠标题，需要把这些折叠标题的下方块移动到新节点下面
		treenode.MoveFoldHeading(updatedNode, oldNode)
	}

	refreshHeadingChildrenUpdated(oldNode, time.Now().Format("20060102150405"))

	cache.PutBlockIAL(updatedNode.ID, parse.IAL2Map(updatedNode.KramdownIAL))

	// 替换为新节点
	oldNode.InsertAfter(updatedNode)
	oldNode.Unlink()

	createdUpdated(updatedNode)
	refreshHeadingChildrenUpdated(updatedNode, updatedNode.IALAttr("updated"))

	tx.nodes[updatedNode.ID] = updatedNode
	if err = tx.writeTree(tree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: id}
	}

	upsertAvBlockRel(updatedNode)

	checkUpsertInUserGuide(tree)
	return
}

func refreshHeadingChildrenUpdated(heading *ast.Node, updated string) {
	if nil == heading || ast.NodeHeading != heading.Type {
		return
	}

	// 将非标题块更新为标题块时需要更新下方块的 parent id
	// The parent block field of the blocks under the heading block is calculated incorrectly https://github.com/siyuan-note/siyuan/issues/9869
	children := treenode.HeadingChildren(heading)
	for _, child := range children {
		child.SetIALAttr("updated", updated)
	}
}

func upsertAvBlockRel(node *ast.Node) {
	var avIDs []string
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeAttributeView == n.Type {
			avID := n.AttributeViewID
			if changed := av.UpsertBlockRel(avID, n.ID); changed {
				avIDs = append(avIDs, avID)
			}
		}
		return ast.WalkContinue
	})
	avIDs = gulu.Str.RemoveDuplicatedElem(avIDs)
	for _, avID := range avIDs {
		util.PushReloadAttrView(avID)
	}
}

func (tx *Transaction) doUpdateUpdated(operation *Operation) (ret *TxErr) {
	id := operation.ID
	tree, err := tx.loadTree(id)
	if nil != err {
		if errors.Is(err, ErrBlockNotFound) {
			logging.LogWarnf("not found block [%s]", id)
			return
		}

		logging.LogErrorf("load tree [%s] failed: %s", id, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		logging.LogErrorf("get node [%s] in tree [%s] failed", id, tree.Root.ID)
		return &TxErr{msg: ErrBlockNotFound.Error(), id: id}
	}

	node.SetIALAttr("updated", operation.Data.(string))
	createdUpdated(node)
	tx.nodes[node.ID] = node
	if err = tx.writeTree(tree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: id}
	}
	return
}

func (tx *Transaction) doCreate(operation *Operation) (ret *TxErr) {
	tree := operation.Data.(*parse.Tree)
	tx.writeTree(tree)

	checkUpsertInUserGuide(tree)
	return
}

func (tx *Transaction) doSetAttrs(operation *Operation) (ret *TxErr) {
	id := operation.ID
	tree, err := tx.loadTree(id)
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", id, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		logging.LogErrorf("get node [%s] in tree [%s] failed", id, tree.Root.ID)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	attrs := map[string]string{}
	if err = gulu.JSON.UnmarshalJSON([]byte(operation.Data.(string)), &attrs); nil != err {
		logging.LogErrorf("unmarshal attrs failed: %s", err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	var invalidNames []string
	for name := range attrs {
		for i := 0; i < len(name); i++ {
			if !lex.IsASCIILetterNumHyphen(name[i]) {
				logging.LogWarnf("invalid attr name [%s]", name)
				invalidNames = append(invalidNames, name)
			}
		}
	}
	for _, name := range invalidNames {
		delete(attrs, name)
	}

	for name, value := range attrs {
		if "" == value {
			node.RemoveIALAttr(name)
		} else {
			node.SetIALAttr(name, value)
		}
	}

	if err = tx.writeTree(tree); nil != err {
		return
	}
	cache.PutBlockIAL(id, parse.IAL2Map(node.KramdownIAL))
	return
}

func refreshUpdated(node *ast.Node) {
	updated := util.CurrentTimeSecondsStr()
	node.SetIALAttr("updated", updated)
	parents := treenode.ParentNodesWithHeadings(node)
	for _, parent := range parents { // 更新所有父节点的更新时间字段
		parent.SetIALAttr("updated", updated)
	}
}

func createdUpdated(node *ast.Node) {
	created := util.TimeFromID(node.ID)
	updated := node.IALAttr("updated")
	if "" == updated {
		updated = created
	}
	if updated < created {
		updated = created // 复制粘贴块后创建时间小于更新时间 https://github.com/siyuan-note/siyuan/issues/3624
	}
	parents := treenode.ParentNodesWithHeadings(node)
	for _, parent := range parents { // 更新所有父节点的更新时间字段
		parent.SetIALAttr("updated", updated)
		cache.PutBlockIAL(parent.ID, parse.IAL2Map(parent.KramdownIAL))
	}
}

type Operation struct {
	Action     string      `json:"action"`
	Data       interface{} `json:"data"`
	ID         string      `json:"id"`
	ParentID   string      `json:"parentID"`
	PreviousID string      `json:"previousID"`
	NextID     string      `json:"nextID"`
	RetData    interface{} `json:"retData"`
	BlockIDs   []string    `json:"blockIDs"`
	BlockID    string      `json:"blockID"`

	DeckID string `json:"deckID"` // 用于添加/删除闪卡

	AvID                string                   `json:"avID"`              // 属性视图 ID
	SrcIDs              []string                 `json:"srcIDs"`            // 用于从属性视图中删除行
	Srcs                []map[string]interface{} `json:"srcs"`              // 用于添加属性视图行（包括绑定块）{id, content, isDetached}
	IsDetached          bool                     `json:"isDetached"`        // 用于标识是否未绑定块，仅存在于属性视图中
	IgnoreFillFilterVal bool                     `json:"ignoreFillFilter"`  // 用于标识是否忽略填充筛选值
	Name                string                   `json:"name"`              // 属性视图列名
	Typ                 string                   `json:"type"`              // 属性视图列类型
	Format              string                   `json:"format"`            // 属性视图列格式化
	KeyID               string                   `json:"keyID"`             // 属性视列 ID
	RowID               string                   `json:"rowID"`             // 属性视图行 ID
	IsTwoWay            bool                     `json:"isTwoWay"`          // 属性视图关联列是否是双向关系
	BackRelationKeyID   string                   `json:"backRelationKeyID"` // 属性视图关联列回链关联列的 ID
}

type Transaction struct {
	Timestamp      int64        `json:"timestamp"`
	DoOperations   []*Operation `json:"doOperations"`
	UndoOperations []*Operation `json:"undoOperations"`

	trees map[string]*parse.Tree
	nodes map[string]*ast.Node

	luteEngine *lute.Lute
	m          *sync.Mutex
	state      atomic.Int32 // 0: 初始化，1：未提交，:2: 已提交，3: 已回滚
}

func (tx *Transaction) WaitForCommit() {
	for {
		if 1 == tx.state.Load() {
			time.Sleep(10 * time.Millisecond)
			continue
		}
		return
	}
}

func (tx *Transaction) begin() (err error) {
	if nil != err {
		return
	}
	tx.trees = map[string]*parse.Tree{}
	tx.nodes = map[string]*ast.Node{}
	tx.luteEngine = util.NewLute()
	tx.m.Lock()
	tx.state.Store(1)
	return
}

func (tx *Transaction) commit() (err error) {
	for _, tree := range tx.trees {
		if err = writeTreeUpsertQueue(tree); nil != err {
			return
		}

		var sources []interface{}
		sources = append(sources, tx)
		util.PushSaveDoc(tree.ID, "tx", sources)
	}
	refreshDynamicRefTexts(tx.nodes, tx.trees)
	IncSync()
	tx.state.Store(2)
	tx.m.Unlock()
	return
}

func (tx *Transaction) rollback() {
	tx.trees, tx.nodes = nil, nil
	tx.state.Store(3)
	tx.m.Unlock()
	return
}

func (tx *Transaction) loadTree(id string) (ret *parse.Tree, err error) {
	var rootID, box, p string
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return nil, ErrBlockNotFound
	}
	rootID = bt.RootID
	box = bt.BoxID
	p = bt.Path

	ret = tx.trees[rootID]
	if nil != ret {
		return
	}

	ret, err = filesys.LoadTree(box, p, tx.luteEngine)
	if nil != err {
		return
	}
	tx.trees[rootID] = ret
	return
}

func (tx *Transaction) writeTree(tree *parse.Tree) (err error) {
	tx.trees[tree.ID] = tree
	treenode.UpsertBlockTree(tree)
	return
}

// refreshDynamicRefText 用于刷新块引用的动态锚文本。
// 该实现依赖了数据库缓存，导致外部调用时可能需要阻塞等待数据库写入后才能获取到 refs
func refreshDynamicRefText(updatedDefNode *ast.Node, updatedTree *parse.Tree) {
	changedDefs := map[string]*ast.Node{updatedDefNode.ID: updatedDefNode}
	changedTrees := map[string]*parse.Tree{updatedTree.ID: updatedTree}
	refreshDynamicRefTexts(changedDefs, changedTrees)
}

// refreshDynamicRefTexts 用于批量刷新块引用的动态锚文本。
// 该实现依赖了数据库缓存，导致外部调用时可能需要阻塞等待数据库写入后才能获取到 refs
func refreshDynamicRefTexts(updatedDefNodes map[string]*ast.Node, updatedTrees map[string]*parse.Tree) {
	// 1. 更新引用的动态锚文本
	treeRefNodeIDs := map[string]*hashset.Set{}
	for _, updateNode := range updatedDefNodes {
		refs := sql.GetRefsCacheByDefID(updateNode.ID)
		if nil != updateNode.Parent && ast.NodeDocument != updateNode.Parent.Type &&
			updateNode.Parent.IsContainerBlock() && (updateNode == treenode.FirstLeafBlock(updateNode.Parent)) { // 容器块下第一个子块
			var parentRefs []*sql.Ref
			if ast.NodeListItem == updateNode.Parent.Type { // 引用列表块时动态锚文本未跟随定义块内容变动 https://github.com/siyuan-note/siyuan/issues/4393
				parentRefs = sql.GetRefsCacheByDefID(updateNode.Parent.Parent.ID)
				updatedDefNodes[updateNode.Parent.ID] = updateNode.Parent
				updatedDefNodes[updateNode.Parent.Parent.ID] = updateNode.Parent.Parent
			} else {
				parentRefs = sql.GetRefsCacheByDefID(updateNode.Parent.ID)
				updatedDefNodes[updateNode.Parent.ID] = updateNode.Parent
			}

			if 0 < len(parentRefs) {
				refs = append(refs, parentRefs...)
			}
		}
		for _, ref := range refs {
			if refIDs, ok := treeRefNodeIDs[ref.RootID]; !ok {
				refIDs = hashset.New()
				refIDs.Add(ref.BlockID)
				treeRefNodeIDs[ref.RootID] = refIDs
			} else {
				refIDs.Add(ref.BlockID)
			}
		}
	}

	changedRefTree := map[string]*parse.Tree{}

	for refTreeID, refNodeIDs := range treeRefNodeIDs {
		refTree, ok := updatedTrees[refTreeID]
		if !ok {
			var err error
			refTree, err = LoadTreeByBlockID(refTreeID)
			if nil != err {
				continue
			}
		}

		var refTreeChanged bool
		ast.Walk(refTree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if n.IsBlock() && refNodeIDs.Contains(n.ID) {
				changed := updateRefText(n, updatedDefNodes)
				if !refTreeChanged && changed {
					refTreeChanged = true
				}
				return ast.WalkContinue
			}
			return ast.WalkContinue
		})

		if refTreeChanged {
			changedRefTree[refTreeID] = refTree
		}
	}

	// 2. 更新属性视图主键内容
	for _, updatedDefNode := range updatedDefNodes {
		avs := updatedDefNode.IALAttr(av.NodeAttrNameAvs)
		if "" == avs {
			continue
		}

		avIDs := strings.Split(avs, ",")
		for _, avID := range avIDs {
			attrView, parseErr := av.ParseAttributeView(avID)
			if nil != parseErr {
				continue
			}

			changedAv := false
			blockValues := attrView.GetBlockKeyValues()
			if nil == blockValues {
				continue
			}

			for _, blockValue := range blockValues.Values {
				if blockValue.Block.ID == updatedDefNode.ID {
					newContent := getNodeRefText(updatedDefNode)
					if newContent != blockValue.Block.Content {
						blockValue.Block.Content = newContent
						changedAv = true
					}
					break
				}
			}
			if changedAv {
				av.SaveAttributeView(attrView)
				util.PushReloadAttrView(avID)
			}
		}
	}

	// 3. 保存变更
	for _, tree := range changedRefTree {
		indexWriteTreeUpsertQueue(tree)
	}
}

var updateRefTextRenameDocs = map[string]*parse.Tree{}
var updateRefTextRenameDocLock = sync.Mutex{}

func updateRefTextRenameDoc(renamedTree *parse.Tree) {
	updateRefTextRenameDocLock.Lock()
	updateRefTextRenameDocs[renamedTree.ID] = renamedTree
	updateRefTextRenameDocLock.Unlock()
}

func FlushUpdateRefTextRenameDocJob() {
	sql.WaitForWritingDatabase()
	flushUpdateRefTextRenameDoc()
}

func flushUpdateRefTextRenameDoc() {
	updateRefTextRenameDocLock.Lock()
	defer updateRefTextRenameDocLock.Unlock()

	for _, tree := range updateRefTextRenameDocs {
		refreshDynamicRefText(tree.Root, tree)
	}
	updateRefTextRenameDocs = map[string]*parse.Tree{}
}

func updateRefText(refNode *ast.Node, changedDefNodes map[string]*ast.Node) (changed bool) {
	ast.Walk(refNode, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if !treenode.IsBlockRef(n) {
			return ast.WalkContinue
		}

		defID, _, subtype := treenode.GetBlockRef(n)
		if "s" == subtype || "" == defID {
			return ast.WalkContinue
		}

		defNode := changedDefNodes[defID]
		if nil == defNode {
			return ast.WalkSkipChildren
		}

		refText := getNodeRefText(defNode)
		treenode.SetDynamicBlockRefText(n, refText)
		changed = true
		return ast.WalkContinue
	})
	return
}

func checkUpsertInUserGuide(tree *parse.Tree) {
	// In production mode, data reset warning pops up when editing data in the user guide https://github.com/siyuan-note/siyuan/issues/9757
	if "prod" == util.Mode && IsUserGuide(tree.Box) {
		util.PushErrMsg(Conf.Language(52), 7000)
	}
}
