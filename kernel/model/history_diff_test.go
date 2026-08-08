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
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
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
	left := make([]rune, 2000)
	right := make([]rune, 2000)
	for i := range left {
		left[i] = 'a'
		right[i] = 'b'
	}
	if _, ok := lcsMatches(left, right, docDiffMaxLCSCells); ok {
		t.Fatal("expected LCS calculation to exceed its budget")
	}
}

func TestDocDiffLCSCumulativeBudget(t *testing.T) {
	left := make([]int, 1000)
	right := make([]int, 1000)
	for i := range left {
		left[i] = i
		right[i] = i + len(left)
	}
	budget := &docDiffLCSBudget{remaining: 1_500_000}
	if _, ok := lcsMatchesWithBudget(left, right, docDiffMaxLCSCells, budget); !ok {
		t.Fatal("expected the first LCS calculation to fit the cumulative budget")
	}
	if _, ok := lcsMatchesWithBudget(left, right, docDiffMaxLCSCells, budget); ok {
		t.Fatal("expected the second LCS calculation to exceed the cumulative budget")
	}
}

func TestDocDiffLCSEqualFastPath(t *testing.T) {
	values := make([]rune, 3000)
	budget := &docDiffLCSBudget{remaining: 0}
	matches, ok := lcsMatchesWithBudget(values, values, docDiffMaxLCSCells, budget)
	if !ok || len(matches) != len(values) {
		t.Fatal("expected equal values to use the LCS fast path")
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

func TestMarkDocInlineFormatDiff(t *testing.T) {
	left := &ast.Node{Type: ast.NodeParagraph, ID: "20260729000000-left01"}
	left.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("same")})
	right := &ast.Node{Type: ast.NodeParagraph, ID: "20260729000000-right1"}
	right.AppendChild(&ast.Node{
		Type:                ast.NodeTextMark,
		TextMarkType:        "strong",
		TextMarkTextContent: "same",
	})

	markDocInlineDiff(left, right)

	if "inline" != left.FirstChild.IALAttr("data-history-diff") {
		t.Fatal("expected changed formatting on the left to be marked")
	}
	if "inline" != right.FirstChild.IALAttr("data-history-diff") {
		t.Fatal("expected changed formatting on the right to be marked")
	}
}

func TestMarkDocInlineMathDiff(t *testing.T) {
	left := &ast.Node{Type: ast.NodeParagraph, ID: "20260729000000-left01"}
	left.AppendChild(&ast.Node{
		Type:                      ast.NodeTextMark,
		TextMarkType:              "inline-math",
		TextMarkInlineMathContent: "a+b",
	})
	right := &ast.Node{Type: ast.NodeParagraph, ID: "20260729000000-right1"}
	right.AppendChild(&ast.Node{
		Type:                      ast.NodeTextMark,
		TextMarkType:              "inline-math",
		TextMarkInlineMathContent: "a-b",
	})

	markDocInlineDiff(left, right)

	if "inline" != left.FirstChild.IALAttr("data-history-diff") {
		t.Fatal("expected changed inline math on the left to be marked")
	}
	if "inline" != right.FirstChild.IALAttr("data-history-diff") {
		t.Fatal("expected changed inline math on the right to be marked")
	}
	if dom := util.NewLute().RenderNodeBlockDOM(left); !strings.Contains(dom, `data-history-diff="inline"`) {
		t.Fatalf("expected rendered inline math to contain a diff marker, got [%s]", dom)
	}
}

func TestMarkDocInlineMathMove(t *testing.T) {
	left := &ast.Node{Type: ast.NodeParagraph, ID: "20260729000000-left01"}
	left.AppendChild(&ast.Node{
		Type:                      ast.NodeTextMark,
		TextMarkType:              "inline-math",
		TextMarkInlineMathContent: "a+b",
	})
	left.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("text")})
	right := &ast.Node{Type: ast.NodeParagraph, ID: "20260729000000-right1"}
	right.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("text")})
	right.AppendChild(&ast.Node{
		Type:                      ast.NodeTextMark,
		TextMarkType:              "inline-math",
		TextMarkInlineMathContent: "a+b",
	})

	markDocInlineDiff(left, right)

	if "inline" != left.FirstChild.IALAttr("data-history-diff") {
		t.Fatal("expected the moved inline math on the left to be marked")
	}
	if "inline" != right.LastChild.IALAttr("data-history-diff") {
		t.Fatal("expected the moved inline math on the right to be marked")
	}
}

func TestMarkDocInlineTableCellBoundary(t *testing.T) {
	newTable := func(first, second string) *ast.Node {
		table := &ast.Node{Type: ast.NodeTable, ID: "20260729000000-table01"}
		row := &ast.Node{Type: ast.NodeTableRow}
		firstCell := &ast.Node{Type: ast.NodeTableCell}
		firstCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(first)})
		secondCell := &ast.Node{Type: ast.NodeTableCell}
		secondCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(second)})
		row.AppendChild(firstCell)
		row.AppendChild(secondCell)
		table.AppendChild(row)
		return table
	}
	left := newTable("ab", "c")
	right := newTable("a", "bc")

	markDocInlineDiff(left, right)

	if dom := util.NewLute().RenderNodeBlockDOM(left); !strings.Contains(dom, `data-history-diff="inline"`) {
		t.Fatalf("expected text moved across table cells to be marked, got [%s]", dom)
	}
	if dom := util.NewLute().RenderNodeBlockDOM(right); !strings.Contains(dom, `data-history-diff="inline"`) {
		t.Fatalf("expected text moved across table cells to be marked, got [%s]", dom)
	}
}

func TestRenderFallbackDocVersionUsesRawContent(t *testing.T) {
	version := &loadedDocVersion{
		tree:   &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument, ID: "20260729000000-root001"}},
		title:  "Document",
		rootID: "20260729000000-root001",
		raw:    []byte(`{"ID":"20260729000000-root001"}`),
	}

	rendered := renderFallbackDocVersion(version)

	if string(version.raw) != rendered.Content {
		t.Fatalf("expected raw fallback content, got [%s]", rendered.Content)
	}
}

func TestParseDocVersionTreeNormalizesSpecAndRootID(t *testing.T) {
	oldConf := Conf
	Conf = NewAppConf()
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	defer func() {
		Conf = oldConf
	}()
	luteEngine := NewLute()
	tree := parse.Parse("", []byte("content"), luteEngine.ParseOptions)
	tree.Root.ID = "20260729000000-oldroot"
	tree.Root.SetIALAttr("id", tree.Root.ID)
	tree.Root.Spec = ""
	data := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()

	normalized, err := parseDocVersionTree(data, "20260729000000-newroot")
	if err != nil {
		t.Fatalf("expected document version normalization to succeed: %s", err)
	}
	if treenode.CurrentSpec != normalized.Root.Spec {
		t.Fatalf("expected spec [%s], got [%s]", treenode.CurrentSpec, normalized.Root.Spec)
	}
	if "20260729000000-newroot" != normalized.Root.ID {
		t.Fatalf("expected normalized root ID, got [%s]", normalized.Root.ID)
	}
}

func TestDocDiffBlockSignatureIgnoresDescendantsAndDisplayAttrs(t *testing.T) {
	left := &ast.Node{
		Type: ast.NodeBlockquote,
		ID:   "20260729000000-left01",
		KramdownIAL: [][]string{
			{"updated", "20260729000000"},
			{"fold", "1"},
		},
	}
	leftChild := &ast.Node{Type: ast.NodeParagraph, ID: "20260729000000-child1"}
	leftChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("before")})
	left.AppendChild(leftChild)

	right := &ast.Node{
		Type: ast.NodeBlockquote,
		ID:   "20260729000000-right1",
		KramdownIAL: [][]string{
			{"updated", "20260729000001"},
		},
	}
	rightChild := &ast.Node{Type: ast.NodeParagraph, ID: "20260729000000-child1"}
	rightChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("after")})
	right.AppendChild(rightChild)

	if docDiffBlockSignature(left) != docDiffBlockSignature(right) {
		t.Fatal("expected descendant content and display attributes to be ignored")
	}
}

func TestDocDiffBlockSignatureIncludesAttributeViewContent(t *testing.T) {
	block := &ast.Node{
		Type:            ast.NodeAttributeView,
		ID:              "20260729000000-block01",
		AttributeViewID: "20260729000000-view001",
	}
	left := docDiffBlockSignatureWithAttributeViews(block, map[string]string{block.AttributeViewID: "left"})
	right := docDiffBlockSignatureWithAttributeViews(block, map[string]string{block.AttributeViewID: "right"})
	if left == right {
		t.Fatal("expected attribute view content to affect the block signature")
	}
}

func TestDocDiffAttributeViewSignatureNormalizesJSONObjects(t *testing.T) {
	left := []byte(`{
		"spec": 1,
		"id": "20260729000000-view001",
		"updatedAt": 1785342031853,
		"keyValues": [{"key": {"id": "key", "type": "block"}, "values": []}]
	}`)
	right := []byte(`{"keyValues":[{"values":[],"key":{"type":"block","id":"key"}}],"updatedAt":1785342031853,"id":"20260729000000-view001","spec":1}`)
	if docDiffAttributeViewSignature(left) != docDiffAttributeViewSignature(right) {
		t.Fatal("expected equivalent attribute view JSON objects to have the same signature")
	}
	changed := []byte(`{"keyValues":[],"updatedAt":1785342031853,"id":"20260729000000-view001","spec":1}`)
	if docDiffAttributeViewSignature(left) == docDiffAttributeViewSignature(changed) {
		t.Fatal("expected changed attribute view content to have a different signature")
	}
}

func TestMergeDocDiffBlockOrder(t *testing.T) {
	order := mergeDocDiffBlockOrder(
		[]string{"a", "deleted-before", "b", "deleted-after"},
		[]string{"a", "added", "b"},
	)
	expected := []string{"a", "added", "deleted-before", "b", "deleted-after"}
	if len(order) != len(expected) {
		t.Fatalf("expected %d block IDs, got %d", len(expected), len(order))
	}
	for i, id := range expected {
		if order[i] != id {
			t.Fatalf("expected block ID [%s] at index %d, got [%s]", id, i, order[i])
		}
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
