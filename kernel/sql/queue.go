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

package sql

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"path"
	"sync"
	"time"

	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	upsertTreesFlushDelay = 3000
)

var (
	operationQueue      []*treeQueueOperation
	upsertTreeQueueLock = sync.Mutex{}

	txLock = sync.Mutex{}
)

type treeQueueOperation struct {
	inQueueTime time.Time
	action      string // upsert/delete/delete_id/rename

	upsertTree                                                          *parse.Tree // upsert
	removeTreeBox, removeTreePath                                       string      // delete
	removeTreeIDBox, removeTreeID                                       string      // delete_id
	renameTreeBox, renameTreeID, renameTreeOldHPath, renameTreeNewHPath string      // rename
}

func AutoFlushTreeQueue() {
	for {
		flushTreeQueue()
		time.Sleep(time.Duration(upsertTreesFlushDelay) * time.Millisecond)
	}
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
	time.Sleep(time.Duration(upsertTreesFlushDelay+50) * time.Millisecond)
	if 0 < len(operationQueue) || util.IsMutexLocked(&txLock) {
		return true
	}
	return false
}

func flushTreeQueue() {
	ops := mergeUpsertTrees()
	if 1 > len(ops) {
		return
	}

	txLock.Lock()
	defer txLock.Unlock()
	start := time.Now()
	tx, err := BeginTx()
	if nil != err {
		return
	}

	boxes := hashset.New()
	for _, op := range ops {
		switch op.action {
		case "upsert":
			tree := op.upsertTree
			if err = upsertTree(tx, tree); nil != err {
				logging.LogErrorf("upsert tree [%s] into database failed: %s", tree.Box+tree.Path, err)
			}
			boxes.Add(op.upsertTree.Box)
		case "delete":
			batchDeleteByPathPrefix(tx, op.removeTreeBox, op.removeTreePath)
			boxes.Add(op.removeTreeBox)
		case "delete_id":
			DeleteByRootID(tx, op.removeTreeID)
			boxes.Add(op.removeTreeIDBox)
		case "rename":
			batchUpdateHPath(tx, op.renameTreeBox, op.renameTreeID, op.renameTreeOldHPath, op.renameTreeNewHPath)
			updateRootContent(tx, path.Base(op.renameTreeNewHPath), op.renameTreeID)
			boxes.Add(op.renameTreeBox)
		default:
			logging.LogErrorf("unknown operation [%s]", op.action)
		}
	}
	CommitTx(tx)
	elapsed := time.Now().Sub(start).Milliseconds()
	if 5000 < elapsed {
		logging.LogInfof("op tx [%dms]", elapsed)
	}

	start = time.Now()
	tx, err = BeginTx()
	if nil != err {
		return
	}
	for _, box := range boxes.Values() {
		updateBoxHash(tx, box.(string))
	}
	CommitTx(tx)
	elapsed = time.Now().Sub(start).Milliseconds()
	if 1000 < elapsed {
		logging.LogInfof("hash tx [%dms]", elapsed)
	}
}

func mergeUpsertTrees() (ops []*treeQueueOperation) {
	upsertTreeQueueLock.Lock()
	defer upsertTreeQueueLock.Unlock()

	ops = operationQueue
	operationQueue = nil
	return
}

func UpsertTreeQueue(tree *parse.Tree) {
	upsertTreeQueueLock.Lock()
	defer upsertTreeQueueLock.Unlock()

	newOp := &treeQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "upsert"}
	for i, op := range operationQueue {
		if "upsert" == op.action && op.upsertTree.ID == tree.ID { // 相同树则覆盖
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func RenameTreeQueue(tree *parse.Tree, oldHPath string) {
	upsertTreeQueueLock.Lock()
	defer upsertTreeQueueLock.Unlock()

	newOp := &treeQueueOperation{renameTreeBox: tree.Box, renameTreeID: tree.ID, renameTreeOldHPath: oldHPath, renameTreeNewHPath: tree.HPath, inQueueTime: time.Now(), action: "rename"}
	for i, op := range operationQueue {
		if "rename" == op.action && op.renameTreeID == tree.ID { // 相同树则覆盖
			operationQueue[i] = newOp
			return
		}
	}
	operationQueue = append(operationQueue, newOp)
}

func RemoveTreeQueue(box, rootID string) {
	upsertTreeQueueLock.Lock()
	defer upsertTreeQueueLock.Unlock()

	var tmp []*treeQueueOperation
	// 将已有的 upsert 操作去重
	for _, op := range operationQueue {
		if "upsert" == op.action && op.upsertTree.ID != rootID {
			tmp = append(tmp, op)
		}
	}
	operationQueue = tmp

	newOp := &treeQueueOperation{removeTreeIDBox: box, removeTreeID: rootID, inQueueTime: time.Now(), action: "delete_id"}
	operationQueue = append(operationQueue, newOp)
}

func RemoveTreePathQueue(treeBox, treePathPrefix string) {
	upsertTreeQueueLock.Lock()
	defer upsertTreeQueueLock.Unlock()

	var tmp []*treeQueueOperation
	// 将已有的 upsert 操作去重
	for _, op := range operationQueue {
		if "upsert" == op.action && (op.removeTreeBox != treeBox || op.upsertTree.Path != treePathPrefix) {
			tmp = append(tmp, op)
		}
	}
	operationQueue = tmp

	newOp := &treeQueueOperation{removeTreeBox: treeBox, removeTreePath: treePathPrefix, inQueueTime: time.Now(), action: "delete"}
	operationQueue = append(operationQueue, newOp)
}

func updateBoxHash(tx *sql.Tx, boxID string) {
	sum := boxChecksum(boxID)
	PutBoxHash(tx, boxID, sum)
}

func boxChecksum(box string) (ret string) {
	rows, err := query("SELECT hash FROM blocks WHERE type = 'd' AND box = ? ORDER BY id DESC", box)
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	buf := bytes.Buffer{}
	for rows.Next() {
		var hash string
		if err = rows.Scan(&hash); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		buf.WriteString(hash)
	}
	ret = fmt.Sprintf("%x", sha256.Sum256(buf.Bytes()))
	return
}
