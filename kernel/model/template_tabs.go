// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// 模板循环可以重复使用块 ID，按节点保存选中项，在重新生成 ID 后恢复各组选择。
func captureTemplateTabsSelection(root *ast.Node) func() {
	selected := map[*ast.Node]*ast.Node{}
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTabs == node.Type {
			if item := treenode.TabsActiveItem(node); nil != item {
				selected[node] = item
			}
		}
		return ast.WalkContinue
	})
	return func() {
		for tabs, item := range selected {
			tabs.SetIALAttr(treenode.TabsActiveIDAttr, item.ID)
		}
	}
}
