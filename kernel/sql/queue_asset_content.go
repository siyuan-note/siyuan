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
	"runtime/debug"
	"sync"
	"time"

	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	assetContentOperationQueue []*assetContentDBQueueOperation
	assetContentDBQueueLock    = sync.Mutex{}

	assetContentTxLock = sync.Mutex{}
)

type assetContentDBQueueOperation struct {
	inQueueTime time.Time
	action      string // index/deletePath

	assetContents []*AssetContent // index
	path          string          // deletePath
}

func FlushAssetContentTxJob() {
	task.AppendTask(task.AssetContentDatabaseIndexCommit, FlushAssetContentQueue)
}

func FlushAssetContentQueue() {
	ops := getAssetContentOperations()
	if 1 > len(ops) {
		return
	}

	assetContentTxLock.Lock()
	defer assetContentTxLock.Unlock()
	start := time.Now()

	groupOpsTotal := map[string]int{}
	for _, op := range ops {
		groupOpsTotal[op.action]++
	}

	context := map[string]interface{}{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	groupOpsCurrent := map[string]int{}
	for i, op := range ops {
		if util.IsExiting {
			return
		}

		tx, err := beginAssetContentTx()
		if nil != err {
			return
		}

		groupOpsCurrent[op.action]++
		context["current"] = groupOpsCurrent[op.action]
		context["total"] = groupOpsTotal[op.action]

		if err = execAssetContentOp(op, tx, context); nil != err {
			tx.Rollback()
			logging.LogErrorf("queue operation failed: %s", err)
			eventbus.Publish(util.EvtSQLAssetContentRebuild)
			return
		}

		if err = commitAssetContentTx(tx); nil != err {
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
		logging.LogInfof("database asset content op tx [%dms]", elapsed)
	}
}

func execAssetContentOp(op *assetContentDBQueueOperation, tx *sql.Tx, context map[string]interface{}) (err error) {
	switch op.action {
	case "index":
		err = insertAssetContents(tx, op.assetContents, context)
	case "deletePath":
		err = deleteAssetContentsByPath(tx, op.path, context)
	default:
		msg := fmt.Sprintf("unknown asset content operation [%s]", op.action)
		logging.LogErrorf(msg)
		err = errors.New(msg)
	}
	return
}

func DeleteAssetContentsByPathQueue(path string) {
	assetContentTxLock.Lock()
	defer assetContentTxLock.Unlock()

	newOp := &assetContentDBQueueOperation{inQueueTime: time.Now(), action: "deletePath", path: path}
	assetContentOperationQueue = append(assetContentOperationQueue, newOp)
}

func IndexAssetContentsQueue(assetContents []*AssetContent) {
	assetContentTxLock.Lock()
	defer assetContentTxLock.Unlock()

	newOp := &assetContentDBQueueOperation{inQueueTime: time.Now(), action: "index", assetContents: assetContents}
	assetContentOperationQueue = append(assetContentOperationQueue, newOp)
}

func getAssetContentOperations() (ops []*assetContentDBQueueOperation) {
	assetContentTxLock.Lock()
	defer assetContentTxLock.Unlock()

	ops = assetContentOperationQueue
	assetContentOperationQueue = nil
	return
}
