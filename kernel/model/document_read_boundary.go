// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// loadDocumentAtTransactionBoundary 在串行执行边界取得独立来源，普通缓存的解析和渲染在锁外完成。
// 普通缓存读取在空队列时共享读锁；有排队写入时，只完成取得写锁后捕获的一批。
func loadDocumentAtTransactionBoundary(id, boxID string, timing *util.Performance) (*parse.Tree, error) {
	source, err := captureDocumentSourceAtTransactionBoundary(id, boxID, timing)
	if err != nil {
		return nil, err
	}
	if source != nil {
		timing.Count("source_snapshot", 1)
		timing.Stage("parse_source")
		return source.Parse(util.NewLute())
	}
	// 完整加载可能涉及生命周期等待、格式订正与补建父文档，沿用全局完成等待及原有锁顺序。
	timing.Stage("wait_transactions")
	FlushTxQueue()
	timing.Stage("load_tree")
	return loadTreeByBlockIDInBox0(id, boxID, false)
}

func captureDocumentSourceAtTransactionBoundary(id, boxID string, timing *util.Performance) (source *filesys.CachedTreeSource, err error) {
	readAtTransactionBoundary(func() {
		timing.Stage("load_tree")
		bt, lookupErr := lookupBlockTreeInBox(id, boxID, false)
		if lookupErr != nil {
			err = lookupErr
			return
		}
		if IsEncryptedBox(bt.BoxID) {
			return
		}
		source, err = filesys.CaptureCachedTreeSource(bt.BoxID, bt.Path)
	}, timing)
	return
}

func readAtTransactionBoundary(read func(), timing *util.Performance) {
	timing.Stage("wait_transactions")
	flushLock.RLock()
	if txQueueSize() == 0 {
		defer flushLock.RUnlock()
		timing.Count("flushed_transactions", 0)
		read()
		return
	}
	flushLock.RUnlock()
	flushLock.Lock()
	isFlushing.Store(true)
	defer func() {
		isFlushing.Store(false)
		flushLock.Unlock()
	}()
	timing.Stage("flush_transactions")
	transactions := takeQueuedTransactions()
	timing.Count("flushed_transactions", int64(len(transactions)))
	for _, transaction := range transactions {
		flushTx(transaction)
	}
	read()
}
