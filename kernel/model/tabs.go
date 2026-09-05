// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// remapTabTitleBlockIDs 改写页签标题内的块引用和块链接，保留对外部块的引用。
func remapTabTitleBlockIDs(root *ast.Node, ids map[string]string) {
	treenode.WalkWithTabTitles(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || nil == node.Parent || !node.ParentIs(ast.NodeTabItem) {
			return ast.WalkContinue
		}
		if treenode.IsBlockRef(node) {
			id, _, _ := treenode.GetBlockRef(node)
			if mapped := ids[id]; "" != mapped {
				node.TextMarkBlockRefID = mapped
			}
		} else if treenode.IsBlockLink(node) {
			id := strings.TrimPrefix(node.TextMarkAHref, "siyuan://blocks/")
			if mapped := ids[id]; "" != mapped {
				node.TextMarkAHref = "siyuan://blocks/" + mapped
			}
		}
		return ast.WalkContinue
	})
}
