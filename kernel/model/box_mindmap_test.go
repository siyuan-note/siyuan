package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestNormalizeTreeAddsTypedMindmapIDs(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	list := &ast.Node{Type: ast.NodeMindmap, ListData: &ast.ListData{}}
	item := &ast.Node{Type: ast.NodeMindmapItem, ListData: &ast.ListData{}}
	root.AppendChild(list)
	list.AppendChild(item)
	root.AppendChild(&ast.Node{Type: ast.NodeKramdownBlockIAL, Tokens: []byte(`{: id="20260925000000-root001"}`)})
	normalizeTree(&parse.Tree{Root: root})
	for _, node := range []*ast.Node{list, item} {
		if node.ID == "" || node.IALAttr("id") != node.ID || node.IALAttr("updated") == "" {
			t.Fatalf("typed mind map block has no ID: %s", node.Type)
		}
	}
}
