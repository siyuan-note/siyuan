// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// 外部写入在事务内检查身份；已删除的节点可在同一事务中重新插入，更新只允许复用被替换子树的身份。
func (tx *Transaction) validateBlockWriteIDs(root *ast.Node, tree *parse.Tree, replaced *ast.Node) error {
	if !tx.fromAPI || tx.isReplay {
		return nil
	}
	allowed := map[string]bool{}
	if replaced != nil {
		ast.Walk(replaced, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && n.IsBlock() {
				allowed[n.ID] = true
			}
			return ast.WalkContinue
		})
	}
	seen := map[string]bool{}
	existing := map[string]bool{}
	encrypted := IsEncryptedBox(tree.Box)
	for _, current := range tx.trees {
		if current.Box != tree.Box && (encrypted || IsEncryptedBox(current.Box)) {
			continue
		}
		ast.Walk(current.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && n.IsBlock() && n.ID != "" {
				existing[n.ID] = true
			}
			return ast.WalkContinue
		})
	}
	var err error
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || n.Type == ast.NodeDocument || n.Type == ast.NodeKramdownBlockIAL || !n.IsBlock() {
			return ast.WalkContinue
		}
		if n.ID == "" {
			n.SetIALAttr("id", ast.NewNodeID())
		}
		if !ast.IsNodeIDPattern(n.ID) {
			err = fmt.Errorf("invalid block ID [%s]", n.ID)
		} else if seen[n.ID] {
			err = fmt.Errorf("duplicate block ID [%s]", n.ID)
		} else if !allowed[n.ID] {
			if existing[n.ID] {
				err = fmt.Errorf("block ID already exists [%s]", n.ID)
			}
			boxID := ""
			if encrypted {
				boxID = tree.Box
			}
			if bt := treenode.GetBlockTreeInExactBox(n.ID, boxID); bt != nil {
				if current := tx.trees[bt.RootID]; current == nil || treenode.GetNodeInTree(current, n.ID) != nil {
					err = fmt.Errorf("block ID already exists [%s]", n.ID)
				}
			}
		}
		if err != nil {
			return ast.WalkStop
		}
		seen[n.ID] = true
		return ast.WalkContinue
	})
	return err
}
