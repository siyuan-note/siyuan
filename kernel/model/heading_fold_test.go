// SiYuan - From thought to insight, with agents
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
