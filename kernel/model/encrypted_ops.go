// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// 本文件提供加密笔记本的专用操作函数。每个函数接收 boxID，路由到加密 db。
// 与原函数（GetBlockRefText、GetDoc 等）完全独立，原函数行为不变。
// 调用方为 API handler 层：当请求带 notebook 参数且为加密笔记本时，调这里的 InBox 版。

// GetBlockRefTextInBox 在指定加密笔记本内解析块引锚文本。
func GetBlockRefTextInBox(id, boxID string) string {
	FlushTxQueue()

	bt := treenode.GetBlockTreeInBox(id, boxID)
	if nil == bt {
		return ErrBlockNotFound.Error()
	}

	tree, err := loadTreeByBlockTree(bt)
	if err != nil {
		return ""
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return ErrBlockNotFound.Error()
	}

	return getNodeRefText(node)
}

// GetRefTextInBox 在指定加密笔记本内查块的引用文本（SQL 查询版，不走文件系统）。
func GetRefTextInBox(defBlockID, boxID string) string {
	return sql.GetRefTextInBox(defBlockID, boxID)
}
