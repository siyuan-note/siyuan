package model

import (
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func TestBacklinkAnchorSort(t *testing.T) {
	keys := map[string]string{"ten": "A10", "two": "A2", "one": "A1", "equal": "A2", "empty": ""}
	for mode, want := range map[int][]string{
		0: {"ten", "missing", "two", "one", "equal", "empty"},
		1: {"one", "two", "equal", "ten", "missing", "empty"},
		2: {"ten", "two", "equal", "one", "missing", "empty"},
		9: {"ten", "missing", "two", "one", "equal", "empty"},
	} {
		items := []*Backlink{{ID: "ten"}, {ID: "missing"}, {ID: "two"}, {ID: "one"}, {ID: "equal"}, {ID: "empty"}}
		sortBacklinksByAnchor(items, keys, mode)
		var got []string
		for _, item := range items {
			got = append(got, item.ID)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("mode %d: got %v, want %v", mode, got, want)
		}
	}
}

func TestBacklinkAnchorSortKeys(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument, ID: "root"}
	tree := &parse.Tree{Root: root, ID: root.ID}
	parent := &ast.Node{Type: ast.NodeBlockquote, ID: "parent"}
	root.AppendChild(parent)
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	parent.AppendChild(paragraph)
	ref := func(target, text, subtype string) *ast.Node {
		return &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: target,
			TextMarkTextContent: text, TextMarkBlockRefSubtype: subtype}
	}
	paragraph.AppendChild(ref("unrelated", "A0", "s"))
	paragraph.AppendChild(ref("child", " A10 ", "d"))
	paragraph.AppendChild(ref("target", "A1", "s"))
	paragraph.AppendChild(ref("child", "A2", "s"))
	refs := []*sql.Ref{{BlockID: paragraph.ID, DefBlockID: "target"}, {BlockID: paragraph.ID, DefBlockID: "child"}}
	blocks := []*Block{{ID: parent.ID}}
	mapping := map[string]string{parent.ID: paragraph.ID}
	if got := backlinkAnchorSortKeys(blocks, tree, refs, mapping, 1)[parent.ID]; got != "A10" {
		t.Fatalf("merged parent must use the first matching anchor in body order: %q", got)
	}
	if got := backlinkAnchorSortKeys(blocks, tree, refs[:1], mapping, 2)[parent.ID]; got != "A1" {
		t.Fatalf("references outside the target set affected sorting: %q", got)
	}
	paragraph.FirstChild.Next.TextMarkTextContent = ""
	if got := backlinkAnchorSortKeys(blocks, tree, refs, mapping, 1)[parent.ID]; got != "" {
		t.Fatalf("an empty first anchor must not select a later reference: %q", got)
	}
	if got := backlinkAnchorSortKeys(blocks, tree, refs, mapping, 0); got != nil {
		t.Fatal("body order should not extract anchor keys")
	}
}
