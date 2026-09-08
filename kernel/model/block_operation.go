// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"fmt"

	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// PerformBlockOperation 在事务串行区内校验并执行外部块操作，返回实际执行结果。
func PerformBlockOperation(operation *Operation) (transactions []*Transaction, err error) {
	flushLock.Lock()
	isFlushing.Store(true)
	defer func() {
		isFlushing.Store(false)
		flushLock.Unlock()
	}()

	// 先处理已入队的修改，确保目标校验和执行使用一致的文档状态。
	for _, queued := range takeQueuedTransactions() {
		flushTx(queued)
	}

	switch operation.Action {
	case "appendInsert", "insert":
		if operation.Action == "appendInsert" || operation.PreviousID == "" && operation.NextID == "" {
			if err = treenode.CheckContainerParent(operation.ParentID); err != nil {
				return nil, err
			}
		}
	case "delete":
		// 外部删除请求必须命中现存节点，编辑器内部仍可使用幂等删除。
		tree, loadErr := LoadTreeByBlockID(operation.ID)
		if loadErr != nil {
			return nil, loadErr
		}
		node := treenode.GetNodeInTree(tree, operation.ID)
		if node == nil {
			return nil, fmt.Errorf("block not found [%s]", operation.ID)
		}
		if node == tree.Root {
			return nil, fmt.Errorf("document cannot be deleted as a block [%s]", operation.ID)
		}
	default:
		return nil, fmt.Errorf("unsupported block operation [%s]", operation.Action)
	}

	tx := &Transaction{DoOperations: []*Operation{operation}}
	if err = performTxSyncLocked(tx); err != nil {
		return nil, err
	}
	return []*Transaction{tx}, nil
}
