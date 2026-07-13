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
	"math"
	"path"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	operationQueue []*dbQueueOperation
	dbQueueLock    = sync.Mutex{}
	dbQueueCond    = sync.NewCond(&dbQueueLock)
)

type dbQueueOperation struct {
	inQueueTime                   time.Time
	action                        string      // upsert/delete/delete_id/rename/move/delete_box/delete_box_refs/index/delete_ids/update_block_content/delete_assets/index_node
	indexTree                     *parse.Tree // index/rename/move
	upsertTree                    *parse.Tree // upsert/update_refs/delete_refs
	removeTreeBox, removeTreePath string      // delete
	removeTreeID                  string      // delete_id
	removeTreeIDs                 []string    // delete_ids
	box                           string      // delete_box/delete_box_refs/index/index_node
	block                         *Block      // update_block_content
	id                            string      // index_node
	removeAssetHashes             []string    // delete_assets
}

// boxID 从 op 提取目标 boxID，供 beginTxForBox 路由到加密 db 或全局 db。
// delete_ids/delete_assets 无 box 上下文，返回空串 → 走全局 db。
func (op *dbQueueOperation) boxID() string {
	switch op.action {
	case "index", "rename", "move":
		if op.indexTree != nil {
			return op.indexTree.Box
		}
	case "upsert", "update_refs", "delete_refs":
		if op.upsertTree != nil {
			return op.upsertTree.Box
		}
	case "delete", "delete_id":
		return op.removeTreeBox
	case "delete_box", "delete_box_refs", "index_node":
		return op.box
	case "update_block_content":
		if op.block != nil {
			return op.block.Box
		}
	}
	return ""
}

func FlushTxJob() {
	task.AppendTask(task.DatabaseIndexCommit, FlushQueue)
}

func WaitFlushTx() {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	var printLog, lastPrintLog bool
	var i int

	for len(operationQueue) > 0 || flushingTx.Load() {
		if i == 0 {
			// 第一次等待时使用较短的超时
			dbQueueCond.Wait()
		} else {
			// 后续等待添加超时检测，用于打印警告日志
			timer := time.AfterFunc(50*time.Millisecond, func() {
				dbQueueCond.Broadcast()
			})
			dbQueueCond.Wait()
			timer.Stop()
		}

		i++
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

func ClearQueue() {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()
	operationQueue = nil
	clearIndexQueueEntries()
}

var flushingTx = atomic.Bool{}

func FlushQueue() {
	initDatabaseLock.Lock()
	defer initDatabaseLock.Unlock()

	ops, indexSnapshot := getOperations()
	total := len(ops)
	if 1 > total && !flushingTx.Load() {
		processDiskQueue()
		return
	}

	flushingTx.Store(true)
	defer func() {
		flushingTx.Store(false)
		// 通知等待的协程队列已刷新完成
		dbQueueCond.Broadcast()
	}()

	start := time.Now()

	// logging.LogInfof("flushing database queue, total operations [%d]", total)

	// 如果有重命名树的操作，则统计各路径前缀的块树数量，数量较大的话阻塞整个队列，以便尽可能合并重命名树的操作 RenameTreeQueue(tree)
	var renameTreeOp *dbQueueOperation
	for _, op := range ops {
		if "rename" == op.action {
			renameTreeOp = op
			break
		}
	}
	if nil != renameTreeOp {
		childCount := treenode.CountBlockTreesByPathPrefix(renameTreeOp.indexTree.Box, path.Dir(renameTreeOp.indexTree.Path))
		if 512 < childCount {
			scale := math.Log(float64(childCount)/512.0+1.0) / math.Log(2.0)
			secs := 1.0 * scale
			if secs < 1.0 {
				secs = 1.0
			}
			if secs > 12.0 {
				secs = 12.0
			}
			logging.LogInfof("rename tree [%s] with large child count [%d], sleep [%.2fs] to wait for more operations", renameTreeOp.indexTree.Path, childCount, secs)
			time.Sleep(time.Duration(secs * float64(time.Second)))
		}
	}

	context := map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	if 512 < len(ops) {
		disableCache()
		defer enableCache()
	}

	groupOpsTotal := map[string]int{}
	for _, op := range ops {
		groupOpsTotal[op.action]++
	}

	groupOpsCurrent := map[string]int{}
	for i, op := range ops {
		if util.IsExiting.Load() {
			return
		}

		tx, err := beginTxForBox(op.boxID())
		if err != nil {
			return
		}

		groupOpsCurrent[op.action]++
		context["current"] = groupOpsCurrent[op.action]
		context["total"] = groupOpsTotal[op.action]
		if err = execOp(op, tx, context); err != nil {
			tx.Rollback()
			closeTxPreparedStmts(tx)
			logging.LogErrorf("queue operation [%s] failed: %s", op.action, err)
			continue
		}

		if err = commitTx(tx); err != nil {
			logging.LogErrorf("commit tx failed: %s", err)
			continue
		}

		switch op.action {
		case "index":
			eventbus.Publish(eventbus.EvtEmbeddingDirty, op.indexTree.ID)
		case "upsert":
			eventbus.Publish(eventbus.EvtEmbeddingDirty, op.upsertTree.ID)
		case "update_block_content":
			eventbus.Publish(eventbus.EvtEmbeddingDirty, op.block.ID)
		case "index_node":
			eventbus.Publish(eventbus.EvtEmbeddingDirty, op.id)
		}

		if 16 < i && 0 == i%128 {
			debug.FreeOSMemory()
		}
	}

	if 128 < total {
		debug.FreeOSMemory()
	}

	elapsed := time.Since(start).Milliseconds()
	if 7000 < elapsed {
		logging.LogInfof("database op tx [%dms]", elapsed)
	}

	// Push database index commit event https://github.com/siyuan-note/siyuan/issues/8814
	util.BroadcastByType("main", "databaseIndexCommit", 0, "", nil)

	eventbus.Publish(eventbus.EvtSQLIndexFlushed)

	clearIndexQueue(indexSnapshot)
	processDiskQueue()
}

func execOp(op *dbQueueOperation, tx *sql.Tx, context map[string]any) (err error) {
	switch op.action {
	case "index":
		err = indexTree(tx, op.indexTree, context)
	case "upsert":
		err = upsertTree(tx, op.upsertTree, context)
	case "delete":
		err = batchDeleteByPathPrefix(tx, op.removeTreeBox, op.removeTreePath)
		if nil == err {
			tx.Exec("DELETE FROM block_embeddings WHERE box = ? AND path LIKE ?", op.removeTreeBox, op.removeTreePath+"%")
		}
	case "delete_id":
		err = deleteByRootID(tx, op.removeTreeID, context)
		if nil == err {
			tx.Exec("DELETE FROM block_embeddings WHERE root_id = ?", op.removeTreeID)
		}
	case "delete_ids":
		err = batchDeleteByRootIDs(tx, op.removeTreeIDs, context)
		if nil == err {
			for _, rootID := range op.removeTreeIDs {
				tx.Exec("DELETE FROM block_embeddings WHERE root_id = ?", rootID)
			}
		}
	case "rename":
		err = batchUpdateHPath(tx, op.indexTree, context)
		if err != nil {
			break
		}

		err = updateRootContent(tx, path.Base(op.indexTree.HPath), op.indexTree.Root.IALAttr("updated"), treenode.IALStr(op.indexTree.Root), op.indexTree.ID)
		if nil == err {
			tx.Exec("UPDATE block_embeddings SET box = ?, path = ? WHERE root_id = ?", op.indexTree.Box, op.indexTree.Path, op.indexTree.ID)
		}
	case "move":
		err = batchUpdatePath(tx, op.indexTree, context)
		if nil == err {
			tx.Exec("UPDATE block_embeddings SET box = ?, path = ? WHERE root_id = ?", op.indexTree.Box, op.indexTree.Path, op.indexTree.ID)
		}
	case "delete_box":
		// 清理 box 的内容索引。事务由 beginTxForBox(op.boxID()) 按所属库路由：
		// 普通 box 落到全局 siyuan.db，加密笔记本落到其独立 content db，删除均生效。
		// 注意加密笔记本关闭时必须清空 content db 数据，否则下次 Mount 的全量 Index
		// 会用纯 INSERT 在无主键的 blocks 表上叠加重复行，导致搜索结果翻倍。
		err = deleteByBoxTx(tx, op.box)
		if nil == err {
			tx.Exec("DELETE FROM block_embeddings WHERE box = ?", op.box)
		}
	case "delete_box_refs":
		err = deleteRefsByBoxTx(tx, op.box)
	case "update_refs":
		err = upsertRefs(tx, op.upsertTree)
	case "delete_refs":
		err = deleteRefs(tx, op.upsertTree)
	case "update_block_content":
		err = updateBlockContent(tx, op.block)
	case "delete_assets":
		err = deleteAssetsByHashes(tx, op.removeAssetHashes)
	case "index_node":
		err = indexNode(tx, op.id, op.box)
	default:
		msg := fmt.Sprintf("unknown operation [%s]", op.action)
		logging.LogErrorf("%s", msg)
		err = errors.New(msg)
	}
	return
}

func IndexNodeQueue(id string) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	boxID := ""
	if bt := treenode.GetBlockTree(id); bt != nil {
		boxID = bt.BoxID
	}
	newOp := &dbQueueOperation{id: id, box: boxID, inQueueTime: time.Now(), action: "index_node"}
	for i, op := range operationQueue {
		if "index_node" == op.action && op.id == id {
			operationQueue[i] = newOp
			return
		}
	}
	appendOperation(newOp)
}

func BatchRemoveAssetsQueue(hashes []string) {
	if 1 > len(hashes) {
		return
	}

	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{removeAssetHashes: hashes, inQueueTime: time.Now(), action: "delete_assets"}
	appendOperation(newOp)
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
	appendOperation(newOp)
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
	appendOperation(newOp)
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
	appendOperation(newOp)
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
	appendOperation(newOp)
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
	appendOperation(newOp)
}

func IndexTreeQueue(tree *parse.Tree) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{indexTree: tree, inQueueTime: time.Now(), action: "index"}
	for i, op := range operationQueue {
		if "index" == op.action && op.indexTree.ID == tree.ID { // 相同树则覆盖
			operationQueue[i] = newOp
			return
		}
	}
	appendOperation(newOp)
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
	appendOperation(newOp)
}

func RenameTreeQueue(tree *parse.Tree) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{
		indexTree:   tree,
		inQueueTime: time.Now(),
		action:      "rename",
	}
	for i, op := range operationQueue {
		if "rename" == op.action && op.indexTree.ID == tree.ID { // 相同树则覆盖
			operationQueue[i] = newOp
			return
		}
	}
	appendOperation(newOp)
}

func MoveTreeQueue(tree *parse.Tree) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{
		indexTree:   tree,
		inQueueTime: time.Now(),
		action:      "move",
	}
	for i, op := range operationQueue {
		if "move" == op.action && op.indexTree.ID == tree.ID { // 相同树则覆盖
			operationQueue[i] = newOp
			return
		}
	}
	appendOperation(newOp)
}

func RemoveTreeQueue(boxID, rootID string) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{removeTreeBox: boxID, removeTreeID: rootID, inQueueTime: time.Now(), action: "delete_id"}
	for i, op := range operationQueue {
		if "delete_id" == op.action && op.removeTreeID == rootID {
			operationQueue[i] = newOp
			return
		}
	}
	appendOperation(newOp)
}

func BatchRemoveTreeQueue(rootIDs []string) {
	if 1 > len(rootIDs) {
		return
	}

	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	newOp := &dbQueueOperation{removeTreeIDs: rootIDs, inQueueTime: time.Now(), action: "delete_ids"}
	appendOperation(newOp)
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
	appendOperation(newOp)
}

func getOperations() (ops []*dbQueueOperation, indexSnapshot int64) {
	dbQueueLock.Lock()
	defer dbQueueLock.Unlock()

	ops = operationQueue
	operationQueue = nil
	indexSnapshot = indexQueueSize.Load()
	return
}

func appendOperation(op *dbQueueOperation) {
	operationQueue = append(operationQueue, op)
	appendToIndexQueue(op)
	eventbus.Publish(eventbus.EvtSQLIndexChanged)
}

func processDiskQueue() {
	entries := loadIndexQueue()
	if 1 > len(entries) {
		return
	}

	logging.LogInfof("flushing [%d] disk index queue operations", len(entries))

	luteEngine := lute.New()
	context := map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	groupOpsCurrent := map[string]int{}
	for _, e := range entries {
		op := indexEntryToOp(e, luteEngine, "flush disk queue")
		if nil == op {
			continue
		}
		tx, err := beginTxForBox(op.boxID())
		if err != nil {
			return
		}
		groupOpsCurrent[op.action]++
		context["current"] = groupOpsCurrent[op.action]
		context["total"] = len(entries)
		if err = execOp(op, tx, context); err != nil {
			tx.Rollback()
			closeTxPreparedStmts(tx)
			logging.LogErrorf("queue operation [%s] failed: %s", op.action, err)
			continue
		}
		if err = commitTx(tx); err != nil {
			logging.LogErrorf("commit tx failed: %s", err)
			continue
		}
	}

	clearIndexQueueEntries()
}
