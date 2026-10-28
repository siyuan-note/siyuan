// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestBuildHeadingFoldTransactionPreservesMixedState(t *testing.T) {
	expanded := &ast.Node{Type: ast.NodeHeading, ID: "expanded"}
	folded := &ast.Node{Type: ast.NodeHeading, ID: "folded"}
	treenode.SetSelfFolded(folded, true)

	transaction := buildHeadingFoldTransaction([]*ast.Node{expanded, folded})
	assertFoldOperations(t, transaction.DoOperations, "foldHeading:expanded")
	assertFoldOperations(t, transaction.UndoOperations, "unfoldHeading:expanded")
}

func TestBuildHeadingFoldTransactionUnfoldsAll(t *testing.T) {
	first := &ast.Node{Type: ast.NodeHeading, ID: "first"}
	second := &ast.Node{Type: ast.NodeHeading, ID: "second"}
	treenode.SetSelfFolded(first, true)
	treenode.SetSelfFolded(second, true)

	transaction := buildHeadingFoldTransaction([]*ast.Node{first, second})
	assertFoldOperations(t, transaction.DoOperations, "unfoldHeading:second", "unfoldHeading:first")
	assertFoldOperations(t, transaction.UndoOperations, "foldHeading:second", "foldHeading:first")
}

func assertFoldOperations(t *testing.T, operations []*Operation, expected ...string) {
	t.Helper()
	if len(operations) != len(expected) {
		t.Fatalf("expected %d operations, got %d", len(expected), len(operations))
	}
	for i, operation := range operations {
		actual := operation.Action + ":" + operation.ID
		if actual != expected[i] {
			t.Fatalf("expected operation [%s] at index %d, got [%s]", expected[i], i, actual)
		}
	}
}
