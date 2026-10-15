package model

import (
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
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

func TestBacklinkAnchorSortInlineTitles(t *testing.T) {
	const defID = "20261015120000-ref0001"
	for _, typ := range []ast.NodeType{ast.NodeCallout, ast.NodeTabItem} {
		t.Run(typ.String(), func(t *testing.T) {
			root := &ast.Node{Type: ast.NodeDocument, ID: ast.NewNodeID()}
			tree := &parse.Tree{Root: root, ID: root.ID}
			var blocks []*Block
			var refs []*sql.Ref
			for _, text := range []string{"A10", "A2"} {
				title := `<span data-type="block-ref" data-id="` + defID + `" data-subtype="s">` + text + `</span>`
				node := &ast.Node{Type: typ, ID: ast.NewNodeID(), CalloutTitle: title, TabItemTitle: title}
				body := treenode.NewParagraph("")
				body.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: defID,
					TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Body"})
				node.AppendChild(body)
				root.AppendChild(node)
				blocks = append(blocks, &Block{ID: node.ID})
				refs = append(refs, &sql.Ref{BlockID: node.ID, DefBlockID: defID}, &sql.Ref{BlockID: body.ID, DefBlockID: defID})
			}
			for _, mode := range []int{1, 2} {
				keys := backlinkAnchorSortKeys(blocks, tree, refs, nil, mode)
				if keys[blocks[0].ID] != "A10" || keys[blocks[1].ID] != "A2" {
					t.Fatalf("title must supply the first matching anchor: %v", keys)
				}
				items := []*Backlink{{ID: blocks[0].ID}, {ID: blocks[1].ID}}
				sortBacklinksByAnchor(items, keys, mode)
				wantFirst := blocks[0].ID
				if mode == 1 {
					wantFirst = blocks[1].ID
				}
				if items[0].ID != wantFirst {
					t.Fatalf("mode %d did not sort title anchors naturally", mode)
				}
			}
		})
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
