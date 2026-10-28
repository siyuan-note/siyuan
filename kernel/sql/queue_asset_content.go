// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	assetContentTxLock         = sync.Mutex{}
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

func FlushAssetContentQueue() error {
	assetContentTxLock.Lock()
	defer assetContentTxLock.Unlock()
	ops := getAssetContentOperations()
	total := len(ops)
	if 1 > total {
		return nil
	}

	if assetContentDB == nil {
		return errors.New("asset content database is unavailable")
	}
	start := time.Now()

	groupOpsTotal := map[string]int{}
	for _, op := range ops {
		groupOpsTotal[op.action]++
	}

	context := map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	groupOpsCurrent := map[string]int{}
	for i, op := range ops {
		if util.IsExiting.Load() {
			return errors.New("asset content indexing interrupted by shutdown")
		}

		tx, err := beginAssetContentTx()
		if err != nil {
			return err
		}

		groupOpsCurrent[op.action]++
		context["current"] = groupOpsCurrent[op.action]
		context["total"] = groupOpsTotal[op.action]

		if err = execAssetContentOp(op, tx, context); err != nil {
			tx.Rollback()
			logging.LogErrorf("queue operation failed: %s", err)
			eventbus.Publish(util.EvtSQLAssetContentRebuild)
			return err
		}

		if err = commitTx(tx); err != nil {
			logging.LogErrorf("commit tx failed: %s", err)
			return err
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
		logging.LogInfof("database asset content op tx [%dms]", elapsed)
	}
	return nil
}

func execAssetContentOp(op *assetContentDBQueueOperation, tx *sql.Tx, context map[string]any) (err error) {
	switch op.action {
	case "index":
		err = insertAssetContents(tx, op.assetContents, context)
	case "deletePath":
		err = deleteAssetContentsByPath(tx, op.path)
	default:
		msg := fmt.Sprintf("unknown asset content operation [%s]", op.action)
		logging.LogErrorf("%s", msg)
		err = errors.New(msg)
	}
	return
}

func DeleteAssetContentsByPathQueue(path string) {
	assetContentDBQueueLock.Lock()
	defer assetContentDBQueueLock.Unlock()

	newOp := &assetContentDBQueueOperation{inQueueTime: time.Now(), action: "deletePath", path: path}
	assetContentOperationQueue = append(assetContentOperationQueue, newOp)
}

func IndexAssetContentsQueue(assetContents []*AssetContent) {
	assetContentDBQueueLock.Lock()
	defer assetContentDBQueueLock.Unlock()

	newOp := &assetContentDBQueueOperation{inQueueTime: time.Now(), action: "index", assetContents: assetContents}
	assetContentOperationQueue = append(assetContentOperationQueue, newOp)
}

func getAssetContentOperations() (ops []*assetContentDBQueueOperation) {
	assetContentDBQueueLock.Lock()
	defer assetContentDBQueueLock.Unlock()

	ops = assetContentOperationQueue
	assetContentOperationQueue = nil
	return
}
