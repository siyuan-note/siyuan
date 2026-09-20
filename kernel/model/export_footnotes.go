// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// pruneExportFootnotes 只保留从正文可达的脚注，缩略或折叠移除引用后不保留孤立引用链和环。
// 资源预取时正文尚未转换为脚注引用，通过 footnotes 将块引用映射到脚注编号。
func pruneExportFootnotes(root, defs *ast.Node, footnotes map[string]*refAsFootnotes) {
	if defs == nil {
		return
	}
	byID := map[string]*ast.Node{}
	for def := defs.FirstChild; def != nil; def = def.Next {
		byID[def.FootnotesRefId] = def
	}
	seen := map[string]bool{}
	var pending []*ast.Node
	collect := func(node *ast.Node) {
		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			if n == defs {
				return ast.WalkSkipChildren
			}
			id := ""
			if n.Type == ast.NodeFootnotesRef {
				id = n.FootnotesRefId
			} else if footnotes != nil {
				defID := ""
				if treenode.IsBlockRef(n) {
					defID, _, _ = treenode.GetBlockRef(n)
				} else if treenode.IsBlockLink(n) {
					defID = strings.TrimPrefix(n.TextMarkAHref, "siyuan://blocks/")
				}
				if foot := footnotes[defID]; foot != nil {
					id = foot.refNum
				}
			}
			if def := byID[id]; def != nil && !seen[id] {
				seen[id] = true
				pending = append(pending, def)
			}
			return ast.WalkContinue
		})
	}
	collect(root)
	for i := 0; i < len(pending); i++ {
		collect(pending[i])
	}
	for def := defs.FirstChild; def != nil; {
		next := def.Next
		if !seen[def.FootnotesRefId] {
			def.Unlink()
		}
		def = next
	}
	if defs.FirstChild == nil {
		defs.Unlink()
	}
}
