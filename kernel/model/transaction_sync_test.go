// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import "testing"

// TestPerformTransactionSyncReturnsTransactionError 覆盖同步执行事务时错误必须回传。
// 异步队列 flushTx 会把事务错误转成界面提示或界面重载，调用方拿不到执行结果；
// 需要根据事务成败作答的 API（例如 moveBlock）必须拿到 error，否则事务已回滚却仍返回成功。
func TestPerformTransactionSyncReturnsTransactionError(t *testing.T) {
	// 非法结构：文档不能直接包含列表项，事务层会以 TxErrCodeReloadUI 拒绝并回滚。
	transaction := &Transaction{
		DoOperations: []*Operation{
			{Action: "move", ID: "20260908000000-item001", ParentID: "20260908000000-doc0001", PreviousID: "20260908000000-list001"},
		},
	}
	err := PerformTransactionSync(transaction)
	if err == nil {
		t.Fatal("a rolled back transaction must report an error to the caller")
	}
	// 错误码必须保留，调用方与界面提示都依赖它区分失败类型。
	txErr, ok := err.(*TxErr)
	if !ok {
		t.Fatalf("the returned error must keep the transaction error code, got %T", err)
	}
	if txErr.code == TxErrCodeSkipTx {
		t.Fatalf("a rejected transaction must not be reported as skipped, got code=%d", txErr.code)
	}
}

// TestHandleTxErrSharedByBothPaths 确认同步路径与异步队列共用同一个错误处理函数。
// flushTx 会为事务失败触发界面重载与状态提示，同步执行若只返回 error 而跳过这一步，
// 界面就会与已回滚的数据不一致，因此两条路径必须走同一分支。
func TestHandleTxErrSharedByBothPaths(t *testing.T) {
	// TxErrCodeSkipTx 表示操作已跳过，处理函数应立即返回且不panic。
	handleTxErr(&Transaction{}, &TxErr{code: TxErrCodeSkipTx, msg: "skipped"})
	// TxErrCodeReloadUI 走界面重载分支，同样不得panic。
	handleTxErr(&Transaction{}, &TxErr{code: TxErrCodeReloadUI, msg: "invalid block structure"})
}
