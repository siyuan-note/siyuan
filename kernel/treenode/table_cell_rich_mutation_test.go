// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
)

func TestMaterializeTableCellRichStructuralMutation(t *testing.T) {
	tree, cell := richTableTree(t, "#review# text\n\n- keep list\n")
	finish, err := MaterializeTableCellRich(tree.Root)
	if err != nil {
		t.Fatal(err)
	}
	var tags []*ast.Node
	ast.Walk(cell, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.Type == ast.NodeTextMark && n.IsTextMarkType("tag") {
			tags = append(tags, n)
		}
		return ast.WalkContinue
	})
	if len(tags) != 1 {
		t.Fatalf("source tag not materialized: %d", len(tags))
	}
	tags[0].Unlink()
	if err := finish(); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(cell.TableCellRich.Content, "review") || !strings.Contains(cell.TableCellRich.Content, "keep list") {
		t.Fatal(cell.TableCellRich.Content)
	}
	if err := SyncTableCellRichInlineChanges(tree.Root); err != nil {
		t.Fatal(err)
	}
	if err := finish(); err != nil {
		t.Fatal(err)
	}
}

func TestMaterializeTableCellRichPreservesUnchangedAndInvalidSources(t *testing.T) {
	tree, cell := richTableTree(t, "text\n\n- item\n")
	original := cell.TableCellRich.Content
	finish, err := MaterializeTableCellRich(tree.Root)
	if err != nil {
		t.Fatal(err)
	}
	if err = finish(); err != nil || cell.TableCellRich.Content != original {
		t.Fatal("no-op rewrote source", err)
	}
	projection := cell.FirstChild
	cell.TableCellRich.Spec = 99
	if _, err = MaterializeTableCellRich(tree.Root); err == nil || cell.TableCellRich.Content != original || cell.FirstChild != projection {
		t.Fatal("invalid source was modified")
	}
}
