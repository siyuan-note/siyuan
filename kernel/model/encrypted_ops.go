// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// 本文件提供加密笔记本的专用操作函数。每个函数接收 boxID，路由到加密 db。
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
