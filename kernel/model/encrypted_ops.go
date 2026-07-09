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

package model

import (
	"github.com/88250/lute/ast"
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

	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n.IsTextMarkType("inline-memo") {
			n.TextMarkInlineMemoContent = ""
			return ast.WalkContinue
		}
		return ast.WalkContinue
	})

	return getNodeRefText(node)
}

// GetRefTextInBox 在指定加密笔记本内查块的引用文本（SQL 查询版，不走文件系统）。
func GetRefTextInBox(defBlockID, boxID string) string {
	return sql.GetRefTextInBox(defBlockID, boxID)
}
