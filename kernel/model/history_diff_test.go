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
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocDiffLCSMatches(t *testing.T) {
	matches, ok := lcsMatches([]rune("abcde"), []rune("abXde"), docDiffMaxLCSCells)
	if !ok {
		t.Fatal("expected LCS calculation to succeed")
	}
	expected := [][2]int{{0, 0}, {1, 1}, {3, 3}, {4, 4}}
	if len(matches) != len(expected) {
		t.Fatalf("expected %d matches, got %d", len(expected), len(matches))
	}
	for i, match := range matches {
		if match != expected[i] {
			t.Fatalf("expected match %v, got %v", expected[i], match)
		}
	}
}

func TestDocDiffLCSBudget(t *testing.T) {
	if _, ok := lcsMatches(make([]rune, 2000), make([]rune, 2000), docDiffMaxLCSCells); ok {
		t.Fatal("expected LCS calculation to exceed its budget")
	}
}

func TestDecodeDocTextMarkContentPreservesEntities(t *testing.T) {
	node := &ast.Node{
		Type:                ast.NodeTextMark,
		TextMarkType:        "strong",
		TextMarkTextContent: "a&lt;b",
	}
	visible, stored := decodeDocTextMarkContent(node)
	if "a<b" != string(visible) {
		t.Fatalf("expected visible text [a<b], got [%s]", string(visible))
	}
	if "a" != stored[0] || "&lt;" != stored[1] || "b" != stored[2] {
		t.Fatalf("unexpected stored rune mapping: %v", stored)
	}
}

func TestMarkDocInlineDiff(t *testing.T) {
	left := &ast.Node{Type: ast.NodeParagraph, ID: "20260729000000-left01"}
	left.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("before")})
	right := &ast.Node{Type: ast.NodeParagraph, ID: "20260729000000-right1"}
	right.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("beXore")})

	markDocInlineDiff(left, right)

	if nil == left.FirstChild.Next || "inline" != left.FirstChild.Next.IALAttr("data-history-diff") {
		t.Fatal("expected changed text on the left to be marked")
	}
	if nil == right.FirstChild.Next || "inline" != right.FirstChild.Next.IALAttr("data-history-diff") {
		t.Fatal("expected changed text on the right to be marked")
	}
	if dom := util.NewLute().RenderNodeBlockDOM(left); !strings.Contains(dom, `data-history-diff="inline"`) {
		t.Fatalf("expected rendered block DOM to contain an inline diff marker, got [%s]", dom)
	}
}

func TestDetectMovedDocBlocks(t *testing.T) {
	left := map[string]*docDiffBlock{
		"a": {parentID: "root"},
		"b": {parentID: "root"},
		"c": {parentID: "root"},
	}
	right := map[string]*docDiffBlock{
		"a": {parentID: "root"},
		"b": {parentID: "root"},
		"c": {parentID: "root"},
	}
	moved := detectMovedDocBlocks(left, right,
		map[string][]string{"root": {"a", "b", "c"}},
		map[string][]string{"root": {"b", "a", "c"}})
	if !moved["a"] && !moved["b"] {
		t.Fatal("expected a reordered block to be marked as moved")
	}
	if moved["c"] {
		t.Fatal("expected the stable block to remain unmoved")
	}
}
