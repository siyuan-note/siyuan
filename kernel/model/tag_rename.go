// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func RenameTag(oldLabel, newLabel string) error {
	_, err := RenameTagWithTransaction(oldLabel, newLabel)
	return err
}

func RenameTagWithTransaction(oldLabel, newLabel string) (*Transaction, error) {
	return renameTag(oldLabel, newLabel, nil)
}

func renameTag(oldLabel, newLabel string, beforeCommit func()) (*Transaction, error) {
	if invalidChar := treenode.ContainsMarker(newLabel); invalidChar != "" {
		return nil, fmt.Errorf(Conf.Language(112), invalidChar)
	}
	newLabel = strings.TrimPrefix(newLabel, "/")
	newLabel = strings.TrimSuffix(newLabel, "/")
	newLabel = strings.TrimSpace(newLabel)
	if newLabel == "" {
		return nil, errors.New(Conf.Language(114))
	}
	if oldLabel == newLabel {
		return &Transaction{}, nil
	}
	type result struct {
		tx  *Transaction
		err error
	}
	ret := WithTransactionHistory(func(execute func(*Transaction) error) result {
		sql.FlushQueue()
		before, after := map[string]*parse.Tree{}, map[string]*parse.Tree{}
		sources := map[string][]byte{}
		changed := map[string]bool{}
		for _, span := range sql.QueryTagSpansByLabel(oldLabel) {
			if changed[span.BlockID] {
				continue
			}
			node, err := tagMutationNode(span.BlockID, before, after, sources)
			if err != nil {
				return result{err: err}
			}
			if node == nil {
				continue
			}
			if err = renameNodeTags(node, oldLabel, newLabel); err != nil {
				return result{err: err}
			}
			changed[span.BlockID] = true
		}
		tx := &Transaction{fromAPI: true, Timestamp: time.Now().UnixMilli(), tagMutationSources: sources}
		tx.appendTagMutationOperations(before, after, changed)
		if len(tx.DoOperations) == 0 {
			return result{tx: tx}
		}
		if beforeCommit != nil {
			beforeCommit()
		}
		if err := execute(tx); err != nil {
			return result{err: err}
		}
		return result{tx: tx}
	})
	return ret.tx, ret.err
}

func renameNodeTags(node *ast.Node, oldLabel, newLabel string) error {
	rename := func(label string) string {
		if label == oldLabel || strings.HasPrefix(label, oldLabel+"/") {
			return newLabel + strings.TrimPrefix(label, oldLabel)
		}
		return label
	}
	if node.Type == ast.NodeDocument {
		tags := strings.Split(node.IALAttr("tags"), ",")
		for i, tag := range tags {
			tags[i] = rename(tag)
		}
		node.SetIALAttr("tags", strings.Join(tags, ","))
		return nil
	}
	nestedBlocks := map[*ast.Node]bool{}
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n != node && n.IsBlock() && n.ID != "" {
			nestedBlocks[n] = true
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
	finishRich, err := treenode.MaterializeTableCellRich(node)
	if err != nil {
		return err
	}
	finishTitles := treenode.MaterializeInlineTitles(node)
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		// 富文本单元格和行内标题物化出的临时块使用所属块的事务操作。
		if nestedBlocks[n] {
			return ast.WalkSkipChildren
		}
		if n.Type == ast.NodeTextMark && n.IsTextMarkType("tag") {
			n.TextMarkTextContent = rename(n.TextMarkTextContent)
		}
		return ast.WalkContinue
	})
	finishTitles()
	return finishRich()
}
