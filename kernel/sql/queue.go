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

package sql

import (
	"database/sql"
	"errors"
	"fmt"
	"path"
	"runtime/debug"
	"sync"
	"time"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	operationQueue []*dbQueueOperation
	dbQueueLock    = sync.Mutex{}

	txLock = sync.Mutex{}
)

type dbQueueOperation struct {
	inQueueTime                   time.Time
	action                        string      // upsert/delete/delete_id/rename/rename_sub_tree/delete_box/delete_box_refs/insert_refs/index/delete_ids/update_block_content/delete_assets
	indexPath                     string      // index
	upsertTree                    *parse.Tree // upsert/insert_refs/update_refs/delete_refs
	removeTreeBox, removeTreePath string      // delete
	removeTreeIDBox, removeTreeID string      // delete_id
	removeTreeIDs                 []string    // delete_ids
	box                           string      // delete_box/delete_box_refs/index
	renameTree                    *parse.Tree // rename/rename_sub_tree
	block                         *Block      // update_block_content
	removeAssetHashes             []string    // delete_assets
}

func FlushTxJob() {
	task.AppendTask(task.DatabaseIndexCommit, FlushQueue)
}

func WaitForWritingDatabase() {
	var printLog bool
	var lastPrintLog bool
	for i := 0; isWritingDatabase(); i++ {
		time.Sleep(50 * time.Millisecond)
		if 200 < i && !printLog { // 10s 后打日志
			logging.LogWarnf("database is writing: \n%s", logging.ShortStack())
			printLog = true
		}
		if 1200 < i && !lastPrintLog { // 60s 后打日志
			logging.LogWarnf("database is still writing")
			lastPrintLog = true
		}
	}
}

func isWritingDatabase() bool {
	time.Sleep(util.SQLFlushInterval + 50*time.Millisecond)
	if 0 < len(operationQueue) || util.IsMutexLocked(&txLock) {
		return true
	}
	return false
}

func IsEmptyQueue() bool {
	return 1 > len(operationQueue) && !util.IsMutexLocked(&txLock)
}

func ClearQueue() {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()
	operationQueue = nil
}

func FlushQueue() {
	ops := mergeUpsertTrees()
	if 1 > len(ops) {
		return
	}

	txLock.Lock()
	defer txLock.Unlock()
	start := time.Now()

	context := map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	total := len(ops)
	if 512 < total {
		disableCache()
		defer enableCache()
	}

	groupOpsTotal := map[string]int{}
	for _, op := range ops {
		groupOpsTotal[op.action]++
	}

	groupOpsCurrent := map[string]int{}
	for i, op := range ops {
		if util.IsExiting {
			return
		}

		tx, err := beginTx()
		if nil != err {
			return
		}

		groupOpsCurrent[op.action]++
		context["current"] = groupOpsCurrent[op.action]
		context["total"] = groupOpsTotal[op.action]
		if err = execOp(op, tx, context); nil != err {
			tx.Rollback()
			logging.LogErrorf("queue operation [%s] failed: %s", op.action, err)
			continue
		}

		if err = commitTx(tx); nil != err {
			logging.LogErrorf("commit tx failed: %s", err)
			return
		}

		if 16 < i && 0 == i%128 {
			debug.FreeOSMemory()
		}
	}

	if 128 < len(ops) {
		debug.FreeOSMemory()
	}

	elapsed := time.Now().Sub(start).Milliseconds()
	if 7000 < elapsed {
		logging.LogInfof("database op tx [%dms]", elapsed)
	}

	// Push database index commit event https://github.com/siyuan-note/siyuan/issues/8814
	util.BroadcastByType("main", "databaseIndexCommit", 0, "", nil)
}

func execOp(op *dbQueueOperation, tx *sql.Tx, context map[string]interface{}) (err error) {
	switch op.action {
	case "index":
		err = indexTree(tx, op.box, op.indexPath, context)
	case "upsert":
		err = upsertTree(tx, op.upsertTree, context)
	case "delete":
		err = batchDeleteByPathPrefix(tx, op.removeTreeBox, op.removeTreePath)
	case "delete_id":
		err = deleteByRootID(tx, op.removeTreeID, context)
	case "delete_ids":
		err = batchDeleteByRootIDs(tx, op.removeTreeIDs, context)
	case "rename":
		err = batchUpdateHPath(tx, op.renameTree.Box, op.renameTree.ID, op.renameTree.HPath, context)
		if nil != err {
			break
		}
		err = updateRootContent(tx, path.Base(op.renameTree.HPath), op.renameTree.Root.IALAttr("updated"), op.renameTree.ID)
	case "rename_sub_tree":
		err = batchUpdateHPath(tx, op.renameTree.Box, op.renameTree.ID, op.renameTree.HPath, context)
	case "delete_box":
		err = deleteByBoxTx(tx, op.box)
	case "delete_box_refs":
		err = deleteRefsByBoxTx(tx, op.box)
	case "insert_refs":
		err = insertRefs(tx, op.upsertTree)
	case "update_refs":
		err = upsertRefs(tx, op.upsertTree)
	case "delete_refs":
		err = deleteRefs(tx, op.upsertTree)
	case "update_block_content":
		err = updateBlockContent(tx, op.block)
	case "delete_assets":
		err = deleteAssetsByHashes(tx, op.removeAssetHashes)
	default:
		msg := fmt.Sprintf("unknown operation [%s]", op.action)
		logging.LogErrorf(msg)
		err = errors.New(msg)
	}
	return
}

func BatchRemoveAssetsQueue(hashes []string) {
	if 1 > len(hashes) {
		return
	}

	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{removeAssetHashes: hashes, inQueueTime: time.Now(), action: "delete_assets"}
	operationQueue = append(operationQueue, newOp)
}

func UpdateBlockContentQueue(block *Block) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{block: block, inQueueTime: time.Now(), action: "update_block_content"}
	for i, op := range operationQueue {
		if "update_block_content" == op.action && op.block.ID == block.ID {
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func DeleteRefsTreeQueue(tree *parse.Tree) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "delete_refs"}
	for i, op := range operationQueue {
		if "delete_refs" == op.action && op.upsertTree.ID == tree.ID {
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func UpdateRefsTreeQueue(tree *parse.Tree) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "update_refs"}
	for i, op := range operationQueue {
		if "update_refs" == op.action && op.upsertTree.ID == tree.ID {
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func InsertRefsTreeQueue(tree *parse.Tree) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "insert_refs"}
	for i, op := range operationQueue {
		if "insert_refs" == op.action && op.upsertTree.ID == tree.ID {
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func DeleteBoxRefsQueue(boxID string) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{box: boxID, inQueueTime: time.Now(), action: "delete_box_refs"}
	for i, op := range operationQueue {
		if "delete_box_refs" == op.action && op.box == boxID {
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func DeleteBoxQueue(boxID string) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{box: boxID, inQueueTime: time.Now(), action: "delete_box"}
	for i, op := range operationQueue {
		if "delete_box" == op.action && op.box == boxID {
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func IndexTreeQueue(box, p string) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{indexPath: p, box: box, inQueueTime: time.Now(), action: "index"}
	for i, op := range operationQueue {
		if "index" == op.action && op.indexPath == p && op.box == box { // 相同树则覆盖
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func UpsertTreeQueue(tree *parse.Tree) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "upsert"}
	for i, op := range operationQueue {
		if "upsert" == op.action && op.upsertTree.ID == tree.ID { // 相同树则覆盖
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func RenameTreeQueue(tree *parse.Tree) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{
		renameTree:  tree,
		inQueueTime: time.Now(),
		action:      "rename",
	}
	for i, op := range operationQueue {
		if "rename" == op.action && op.renameTree.ID == tree.ID { // 相同树则覆盖
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func RenameSubTreeQueue(tree *parse.Tree) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{
		renameTree:  tree,
		inQueueTime: time.Now(),
		action:      "rename_sub_tree",
	}
	for i, op := range operationQueue {
		if "rename_sub_tree" == op.action && op.renameTree.ID == tree.ID { // 相同树则覆盖
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func RemoveTreeQueue(box, rootID string) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{removeTreeIDBox: box, removeTreeID: rootID, inQueueTime: time.Now(), action: "delete_id"}
	for i, op := range operationQueue {
		if "delete_id" == op.action && op.removeTreeIDBox == box && op.removeTreeID == rootID {
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func BatchRemoveTreeQueue(rootIDs []string) {
	if 1 > len(rootIDs) {
		return
	}

	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{removeTreeIDs: rootIDs, inQueueTime: time.Now(), action: "delete_ids"}
	operationQueue = append(operationQueue, newOp)
}

func RemoveTreePathQueue(treeBox, treePathPrefix string) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{removeTreeBox: treeBox, removeTreePath: treePathPrefix, inQueueTime: time.Now(), action: "delete"}
	for i, op := range operationQueue {
		if "delete" == op.action && (op.removeTreeBox == treeBox && op.removeTreePath == treePathPrefix) {
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func mergeUpsertTrees() (ops []*dbQueueOperation) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	ops = operationQueue
	operationQueue = nil
	return
}
