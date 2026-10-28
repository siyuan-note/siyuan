// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	historyOperationQueue []*historyDBQueueOperation
	historyDBQueueLock    = sync.Mutex{}
	historyTxLock         = sync.Mutex{}
)

type historyDBQueueOperation struct {
	inQueueTime time.Time
	action      string // index/deleteOutdated

	histories []*History // index
	before    int64      // deleteOutdated
}

func FlushHistoryTxJob() {
	task.AppendTask(task.HistoryDatabaseIndexCommit, FlushHistoryQueue)
}

func FlushHistoryQueue() {
	ops := getHistoryOperations()
	total := len(ops)
	if 1 > total {
		return
	}

	historyTxLock.Lock()
	defer historyTxLock.Unlock()
	start := time.Now()

	groupOpsTotal := map[string]int{}
	for _, op := range ops {
		groupOpsTotal[op.action]++
	}

	context := map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	groupOpsCurrent := map[string]int{}
	for i, op := range ops {
		if util.IsExiting.Load() {
			return
		}

		tx, err := beginHistoryTx()
		if err != nil {
			return
		}

		groupOpsCurrent[op.action]++
		context["current"] = groupOpsCurrent[op.action]
		context["total"] = groupOpsTotal[op.action]

		if err = execHistoryOp(op, tx, context); err != nil {
			tx.Rollback()
			logging.LogErrorf("queue operation failed: %s", err)

			if 0 < len(op.histories) {
				dir := op.histories[0].Path[:strings.Index(op.histories[0].Path, "/")]
				dirPath := filepath.Join(util.HistoryDir, dir)
				if removeErr := os.RemoveAll(dirPath); nil != removeErr {
					logging.LogErrorf("remove corrupted history dir [%s] failed: %s", dirPath, removeErr)
				}
			}

			eventbus.Publish(util.EvtSQLHistoryRebuild)
			return
		}

		if err = commitTx(tx); err != nil {
			logging.LogErrorf("commit tx failed: %s", err)
			return
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
		logging.LogInfof("database history op tx [%dms]", elapsed)
	}
}

func execHistoryOp(op *historyDBQueueOperation, tx *sql.Tx, context map[string]any) (err error) {
	switch op.action {
	case "index":
		err = insertHistories(tx, op.histories, context)
	case "deleteOutdated":
		err = deleteOutdatedHistories(tx, op.before)
	default:
		msg := fmt.Sprintf("unknown history operation [%s]", op.action)
		logging.LogErrorf("%s", msg)
		err = errors.New(msg)
	}
	return
}

func DeleteOutdatedHistories(before int64) {
	historyDBQueueLock.Lock()
	defer historyDBQueueLock.Unlock()

	newOp := &historyDBQueueOperation{inQueueTime: time.Now(), action: "deleteOutdated", before: before}
	historyOperationQueue = append(historyOperationQueue, newOp)
}

func IndexHistoriesQueue(histories []*History) {
	if 1 > len(histories) {
		return
	}

	historyDBQueueLock.Lock()
	defer historyDBQueueLock.Unlock()

	newOp := &historyDBQueueOperation{inQueueTime: time.Now(), action: "index", histories: histories}
	historyOperationQueue = append(historyOperationQueue, newOp)
}

func getHistoryOperations() (ops []*historyDBQueueOperation) {
	historyDBQueueLock.Lock()
	defer historyDBQueueLock.Unlock()

	ops = historyOperationQueue
	historyOperationQueue = nil
	return
}
