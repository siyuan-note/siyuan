// SiYuan - Build Your Eternal Digital Garden
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
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	util2 "github.com/88250/lute/util"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	ErrNotFullyBoot = errors.New("the kernel has not been fully booted, please try again later")
)

var writingDataLock = sync.Mutex{}

func IsFoldHeading(transactions *[]*Transaction) bool {
	if 1 == len(*transactions) && 1 == len((*transactions)[0].DoOperations) {
		if op := (*transactions)[0].DoOperations[0]; "foldHeading" == op.Action {
			return true
		}
	}
	return false
}

func IsUnfoldHeading(transactions *[]*Transaction) bool {
	if 1 == len(*transactions) && 1 == len((*transactions)[0].DoOperations) {
		if op := (*transactions)[0].DoOperations[0]; "unfoldHeading" == op.Action {
			return true
		}
	}
	return false
}

func IsSetAttrs(transactions *[]*Transaction) *Operation {
	if 1 == len(*transactions) && 1 == len((*transactions)[0].DoOperations) {
		if op := (*transactions)[0].DoOperations[0]; "setAttrs" == op.Action {
			return op
		}
	}
	return nil
}

const txFixDelay = 10

var (
	txQueue     []*Transaction
	txQueueLock = sync.Mutex{}
	txDelay     = txFixDelay

	currentTx *Transaction
)

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

func isWritingFiles() bool {
	time.Sleep(time.Duration(txDelay+5) * time.Millisecond)
	if 0 < len(txQueue) || util.IsMutexLocked(&txQueueLock) {
		return true
	}
	return nil != currentTx
}

func AutoFlushTx() {
	for {
		flushTx()
		time.Sleep(time.Duration(txDelay) * time.Millisecond)
	}
}

func flushTx() {
	writingDataLock.Lock()
	defer writingDataLock.Unlock()
	defer logging.Recover()

	currentTx = mergeTx()
	start := time.Now()
	if txErr := performTx(currentTx); nil != txErr {
		switch txErr.code {
		case TxErrCodeBlockNotFound:
			util.PushTxErr("Transaction failed", txErr.code, nil)
			return
		case TxErrCodeUnableLockFile:
			util.PushTxErr(Conf.Language(76), txErr.code, txErr.id)
			return
		default:
			logging.LogFatalf("transaction failed: %s", txErr.msg)
		}
	}
	elapsed := time.Now().Sub(start).Milliseconds()
	if 0 < len(currentTx.DoOperations) {
		if 2000 < elapsed {
			logging.LogWarnf("tx [%dms]", elapsed)
		}
	}
	currentTx = nil
}

func mergeTx() (ret *Transaction) {
	txQueueLock.Lock()
	defer txQueueLock.Unlock()

	ret = &Transaction{}
	var doOps []*Operation
	for _, tx := range txQueue {
		for _, op := range tx.DoOperations {
			if l := len(doOps); 0 < l {
				lastOp := doOps[l-1]
				if "update" == lastOp.Action && "update" == op.Action && lastOp.ID == op.ID { // 连续相同的更新操作
					lastOp.discard = true
				}
			}
			doOps = append(doOps, op)
		}
	}

	for _, op := range doOps {
		if !op.discard {
			ret.DoOperations = append(ret.DoOperations, op)
		}
	}

	txQueue = nil
	return
}

func PerformTransactions(transactions *[]*Transaction) (err error) {
	if !util.IsBooted() {
		err = ErrNotFullyBoot
		return
	}

	txQueueLock.Lock()
	txQueue = append(txQueue, *transactions...)
	txQueueLock.Unlock()
	return
}

const (
	TxErrCodeBlockNotFound  = 0
	TxErrCodeUnableLockFile = 1
	TxErrCodeWriteTree      = 2
)

type TxErr struct {
	code int
	msg  string
	id   string
}

func performTx(tx *Transaction) (ret *TxErr) {
	if 1 > len(tx.DoOperations) {
		txDelay -= 1000
		if 100*txFixDelay < txDelay {
			txDelay = txDelay / 2
		} else if 0 > txDelay {
			txDelay = txFixDelay
		}
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

	start := time.Now()
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
	elapsed := int(time.Now().Sub(start).Milliseconds())
	txDelay = 10 + elapsed
	if 1000*10 < txDelay {
		txDelay = 1000 * 10
	}
	return
}

func (tx *Transaction) doMove(operation *Operation) (ret *TxErr) {
	var err error
	id := operation.ID
	srcTree, err := tx.loadTree(id)
	if nil != err {
		logging.LogErrorf("load tree [id=%s] failed: %s", id, err)
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
	}
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
			logging.LogErrorf("load tree [id=%s] failed: %s", targetPreviousID, err)
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
			if l := len(targetChildren); 0 < l {
				targetNode = targetChildren[l-1]
			}
		}
		for i := len(headingChildren) - 1; -1 < i; i-- {
			c := headingChildren[i]
			targetNode.InsertAfter(c)
		}
		targetNode.InsertAfter(srcNode)
		if nil != srcEmptyList {
			srcEmptyList.Unlink()
		}

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
		logging.LogErrorf("load tree [id=%s] failed: %s", targetParentID, err)
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

func (tx *Transaction) doPrependInsert(operation *Operation) (ret *TxErr) {
	var err error
	block := treenode.GetBlockTree(operation.ParentID)
	if nil == block {
		msg := fmt.Sprintf("not found parent block [id=%s]", operation.ParentID)
		logging.LogErrorf(msg)
		return &TxErr{code: TxErrCodeBlockNotFound, id: operation.ParentID}
	}
	tree, err := tx.loadTree(block.ID)
	if errors.Is(err, filelock.ErrUnableLockFile) {
		return &TxErr{code: TxErrCodeUnableLockFile, msg: err.Error(), id: block.ID}
	}
	if nil != err {
		msg := fmt.Sprintf("load tree [id=%s] failed: %s", block.ID, err)
		logging.LogErrorf(msg)
		return &TxErr{code: TxErrCodeBlockNotFound, id: block.ID}
	}

	data := strings.ReplaceAll(operation.Data.(string), util2.FrontEndCaret, "")
	luteEngine := NewLute()
	subTree := luteEngine.BlockDOM2Tree(data)
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
		msg := fmt.Sprintf("not found parent block [id=%s]", operation.ParentID)
		logging.LogErrorf(msg)
		return &TxErr{code: TxErrCodeBlockNotFound, id: operation.ParentID}
	}
	tree, err := tx.loadTree(block.ID)
	if errors.Is(err, filelock.ErrUnableLockFile) {
		return &TxErr{code: TxErrCodeUnableLockFile, msg: err.Error(), id: block.ID}
	}
	if nil != err {
		msg := fmt.Sprintf("load tree [id=%s] failed: %s", block.ID, err)
		logging.LogErrorf(msg)
		return &TxErr{code: TxErrCodeBlockNotFound, id: block.ID}
	}

	data := strings.ReplaceAll(operation.Data.(string), util2.FrontEndCaret, "")
	luteEngine := NewLute()
	subTree := luteEngine.BlockDOM2Tree(data)
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
			if ast.NodeSuperBlock == node.Type {
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
		logging.LogErrorf("load tree [id=%s] failed: %s", id, err)
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
		logging.LogErrorf("load tree [id=%s] failed: %s", targetRootID, err)
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
	if errors.Is(err, filelock.ErrUnableLockFile) {
		return &TxErr{code: TxErrCodeUnableLockFile, msg: err.Error(), id: id}
	}
	if ErrBlockNotFound == err {
		return nil // move 以后这里会空，算作正常情况
	}

	if nil != err {
		msg := fmt.Sprintf("load tree [id=%s] failed: %s", id, err)
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
	return
}

func (tx *Transaction) doInsert(operation *Operation) (ret *TxErr) {
	var err error
	opParentID := operation.ParentID
	block := treenode.GetBlockTree(opParentID)
	if nil == block {
		block = treenode.GetBlockTree(operation.PreviousID)
		if nil == block {
			msg := fmt.Sprintf("not found previous block [id=%s]", operation.PreviousID)
			logging.LogErrorf(msg)
			return &TxErr{code: TxErrCodeBlockNotFound, id: operation.PreviousID}
		}
	}
	tree, err := tx.loadTree(block.ID)
	if errors.Is(err, filelock.ErrUnableLockFile) {
		return &TxErr{code: TxErrCodeUnableLockFile, msg: err.Error(), id: block.ID}
	}
	if nil != err {
		msg := fmt.Sprintf("load tree [id=%s] failed: %s", block.ID, err)
		logging.LogErrorf(msg)
		return &TxErr{code: TxErrCodeBlockNotFound, id: block.ID}
	}

	data := strings.ReplaceAll(operation.Data.(string), util2.FrontEndCaret, "")
	luteEngine := NewLute()
	subTree := luteEngine.BlockDOM2Tree(data)

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
				if e = os.Rename(assetPath, targetP); nil != err {
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
	previousID := operation.PreviousID
	if "" != previousID {
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

	createdUpdated(insertedNode)
	tx.nodes[insertedNode.ID] = insertedNode
	if err = tx.writeTree(tree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: block.ID}
	}

	operation.ID = insertedNode.ID
	operation.ParentID = insertedNode.Parent.ID
	return
}

func (tx *Transaction) doUpdate(operation *Operation) (ret *TxErr) {
	id := operation.ID

	tree, err := tx.loadTree(id)
	if errors.Is(err, filelock.ErrUnableLockFile) {
		return &TxErr{code: TxErrCodeUnableLockFile, msg: err.Error(), id: id}
	}
	if nil != err {
		logging.LogErrorf("load tree [id=%s] failed: %s", id, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	data := strings.ReplaceAll(operation.Data.(string), util2.FrontEndCaret, "")
	if "" == data {
		logging.LogErrorf("update data is nil")
		return &TxErr{code: TxErrCodeBlockNotFound, id: id}
	}

	luteEngine := NewLute()
	subTree := luteEngine.BlockDOM2Tree(data)
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

		if ast.NodeInlineMath == n.Type {
			content := n.ChildByType(ast.NodeInlineMathContent)
			if nil == content || 1 > len(content.Tokens) {
				// 剔除空白的行级公式
				unlinks = append(unlinks, n)
			}
		} else if ast.NodeBlockRefID == n.Type {
			sql.CacheRef(subTree, n)
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

	cache.PutBlockIAL(updatedNode.ID, parse.IAL2Map(updatedNode.KramdownIAL))

	// 替换为新节点
	oldNode.InsertAfter(updatedNode)
	oldNode.Unlink()

	createdUpdated(updatedNode)
	tx.nodes[updatedNode.ID] = updatedNode
	if err = tx.writeTree(tree); nil != err {
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: id}
	}
	return
}

func (tx *Transaction) doCreate(operation *Operation) (ret *TxErr) {
	tree := operation.Data.(*parse.Tree)
	tx.writeTree(tree)
	return
}

func refreshUpdated(n *ast.Node) {
	updated := util.CurrentTimeSecondsStr()
	n.SetIALAttr("updated", updated)
	parents := treenode.ParentNodes(n)
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
	parents := treenode.ParentNodes(node)
	for _, parent := range parents { // 更新所有父节点的更新时间字段
		parent.SetIALAttr("updated", updated)
	}
}

type Operation struct {
	Action     string      `json:"action"`
	Data       interface{} `json:"data"`
	ID         string      `json:"id"`
	ParentID   string      `json:"parentID"`
	PreviousID string      `json:"previousID"`
	RetData    interface{} `json:"retData"`

	discard bool // 用于标识是否在事务合并中丢弃
}

type Transaction struct {
	DoOperations   []*Operation `json:"doOperations"`
	UndoOperations []*Operation `json:"undoOperations"`

	trees map[string]*parse.Tree
	nodes map[string]*ast.Node
}

func (tx *Transaction) begin() (err error) {
	if nil != err {
		return
	}
	tx.trees = map[string]*parse.Tree{}
	tx.nodes = map[string]*ast.Node{}
	return
}

func (tx *Transaction) commit() (err error) {
	for _, tree := range tx.trees {
		if err = writeJSONQueue(tree); nil != err {
			return
		}
	}
	refreshDynamicRefText(tx.nodes, tx.trees)
	IncSync()
	tx.trees = nil
	return
}

func (tx *Transaction) rollback() {
	tx.trees, tx.nodes = nil, nil
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

	ret, err = LoadTree(box, p)
	if nil != err {
		return
	}
	tx.trees[rootID] = ret
	return
}

func (tx *Transaction) writeTree(tree *parse.Tree) (err error) {
	tx.trees[tree.ID] = tree
	treenode.ReindexBlockTree(tree)
	return
}

func refreshDynamicRefText(updatedDefNodes map[string]*ast.Node, updatedTrees map[string]*parse.Tree) {
	// 这个实现依赖了数据库缓存，导致外部调用时可能需要阻塞等待数据库写入后才能获取到 refs
	// 比如通过块引创建文档后立即重命名文档，这时引用关系还没有入库，所以重命名查询不到引用关系，最终导致动态锚文本设置失败
	// 引用文档时锚文本没有跟随文档重命名 https://github.com/siyuan-note/siyuan/issues/4193
	// 解决方案是将重命名通过协程异步调用，详见 RenameDoc 函数

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

	for refTreeID, refNodeIDs := range treeRefNodeIDs {
		refTree, ok := updatedTrees[refTreeID]
		if !ok {
			var err error
			refTree, err = loadTreeByBlockID(refTreeID)
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
			indexWriteJSONQueue(refTree)
		}
	}
}

func updateRefText(refNode *ast.Node, changedDefNodes map[string]*ast.Node) (changed bool) {
	ast.Walk(refNode, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if ast.NodeBlockRef == n.Type && nil != n.ChildByType(ast.NodeBlockRefDynamicText) {
			defIDNode := n.ChildByType(ast.NodeBlockRefID)
			if nil == defIDNode {
				return ast.WalkSkipChildren
			}
			defID := defIDNode.TokensStr()
			defNode := changedDefNodes[defID]
			if nil == defNode {
				return ast.WalkSkipChildren
			}
			if ast.NodeDocument != defNode.Type && defNode.IsContainerBlock() {
				defNode = treenode.FirstLeafBlock(defNode)
			}
			defContent := renderBlockText(defNode)
			if Conf.Editor.BlockRefDynamicAnchorTextMaxLen < utf8.RuneCountInString(defContent) {
				defContent = gulu.Str.SubStr(defContent, Conf.Editor.BlockRefDynamicAnchorTextMaxLen) + "..."
			}
			treenode.SetDynamicBlockRefText(n, defContent)
			changed = true
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
	return
}
