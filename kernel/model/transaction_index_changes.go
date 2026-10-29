// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type transactionIndexChanges struct {
	blockIDs map[string]bool
	full     bool
}

// captureIndexReplacement 记录替换前后的子树和容器，标题结构及未知写入保留完整投影。
func (tx *Transaction) captureIndexReplacement(tree *parse.Tree, before, after *ast.Node) {
	if tx.indexChanges == nil {
		tx.indexChanges = map[string]*transactionIndexChanges{}
	}
	change := tx.indexChanges[tree.ID]
	if change == nil {
		change = &transactionIndexChanges{blockIDs: map[string]bool{}}
		tx.indexChanges[tree.ID] = change
	}
	if change.full {
		return
	}
	record := func(root *ast.Node) {
		ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering {
				if node.Type == ast.NodeHeading || node.Type == ast.NodeInlineHTML {
					change.full = true
				}
				if node.IsBlock() && node.ID != "" {
					change.blockIDs[node.ID] = true
				}
			}
			return ast.WalkContinue
		})
	}
	record(before)
	record(after)
	for parent := before.Parent; parent != nil && parent.Type != ast.NodeDocument; parent = parent.Parent {
		record(parent)
	}
	// 段落编辑也会刷新语义标题父级的时间戳，这些标题只需重新生成自身主块。
	for _, parent := range treenode.ParentNodesWithHeadings(before) {
		if parent.IsBlock() && parent.ID != "" {
			change.blockIDs[parent.ID] = true
		}
	}
	change.blockIDs[tree.ID] = true
}

func (tx *Transaction) treeIndexChanges(tree *parse.Tree) *sql.TreeIndexChanges {
	change := tx.indexChanges[tree.ID]
	if change == nil || change.full {
		return nil
	}
	// 事务整理可能补入属性或结构操作，未收集其完整影响时不能沿用局部提示。
	for _, operation := range tx.DoOperations {
		if operation == nil || operation.Action != "update" {
			return nil
		}
	}
	ids := make([]string, 0, len(change.blockIDs))
	for id := range change.blockIDs {
		ids = append(ids, id)
	}
	return sql.NewTreeIndexChanges(ids)
}
