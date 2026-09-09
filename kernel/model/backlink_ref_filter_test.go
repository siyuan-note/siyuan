package model

import (
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
)

func TestBacklinkEntryBlockIDs(t *testing.T) {
	doc := &ast.Node{Type: ast.NodeDocument, ID: "doc"}
	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading", HeadingLevel: 1}
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("heading")})
	list := &ast.Node{Type: ast.NodeList, ID: "list", ListData: &ast.ListData{}}
	item := &ast.Node{Type: ast.NodeListItem, ID: "item", ListData: &ast.ListData{}}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	child := &ast.Node{Type: ast.NodeList, ID: "child", ListData: &ast.ListData{}}
	item.AppendChild(paragraph)
	item.AppendChild(child)
	item.SetIALAttr("fold", "1")
	list.AppendChild(item)
	next := &ast.Node{Type: ast.NodeHeading, ID: "next", HeadingLevel: 1}
	doc.AppendChild(heading)
	doc.AppendChild(list)
	doc.AppendChild(next)
	for _, test := range []struct {
		node *ast.Node
		ids  []string
	}{
		{paragraph, []string{"paragraph"}},
		{item, []string{"item", "paragraph", "child"}},
		{heading, []string{"heading", "list", "item", "paragraph", "child"}},
		{doc, []string{"doc", "heading", "list", "item", "paragraph", "child", "next"}},
	} {
		if ids := backlinkEntryBlockIDs(test.node); !reflect.DeepEqual(ids, test.ids) {
			t.Fatalf("%s: got %v, expected %v", test.node.ID, ids, test.ids)
		}
	}
}

func TestExcludeBacklinkEntries(t *testing.T) {
	entries := []*Block{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	refs := map[string]map[string]bool{
		"a": {"archive": true, "topic": true},
		"b": {"same-name-different-id": true, "topic": true},
		"c": {"done": true},
	}
	assertBacklinkSourceIDs(t, excludeBacklinkEntries(entries, refs, []string{"archive", "done"}), []string{"b"})
	assertBacklinkSourceIDs(t, excludeBacklinkEntries(entries, refs, nil), []string{"a", "b", "c"})
	filter := NormalizeBacklinkSourceFilter(&BacklinkSourceFilter{
		ExcludedRefDefIDs: []string{"", "invalid", "20260909120000-abcdefg", "20260909120000-abcdefg"},
	})
	if nil == filter || !reflect.DeepEqual(filter.ExcludedRefDefIDs, []string{"20260909120000-abcdefg"}) {
		t.Fatalf("unexpected normalized filter: %+v", filter)
	}
}
