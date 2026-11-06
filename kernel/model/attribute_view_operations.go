// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

// 在事务串行区内读取字段和行身份并构造写入，避免校验后字段类型或绑定状态发生变化。
func PerformPreparedAttributeViewOperations(build func() ([]*Operation, error)) error {
	flushLock.Lock()
	isFlushing.Store(true)
	defer func() {
		isFlushing.Store(false)
		flushLock.Unlock()
	}()
	for _, queued := range takeQueuedTransactions() {
		flushTx(queued)
	}
	operations, err := build()
	if err != nil {
		return err
	}
	tx := &Transaction{DoOperations: operations, fromAPI: true}
	completion := tx.prepareCommitWait()
	defer close(completion.done)
	return performTxSyncLocked(tx)
}
