package treenode

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/dataparser"
)

func TestMindmapBlockStructureAndSpec(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument, Spec: "4"}
	mindmap := &ast.Node{Type: ast.NodeMindmap, ID: "20260923120000-map0001", ListData: &ast.ListData{}}
	item := &ast.Node{Type: ast.NodeMindmapItem, ID: "20260923120000-item001", ListData: &ast.ListData{}}
	item.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: "20260923120000-para001"})
	child := &ast.Node{Type: ast.NodeMindmap, ID: "20260923120000-map0002", ListData: &ast.ListData{}}
	child.AppendChild(&ast.Node{Type: ast.NodeMindmapItem, ID: "20260923120000-item002", ListData: &ast.ListData{}})
	item.AppendChild(child)
	mindmap.AppendChild(item)
	root.AppendChild(mindmap)
	if err := ValidateBlockSubtree(mindmap); err != nil {
		t.Fatal(err)
	}
	oldList := &ast.Node{Type: ast.NodeList, ID: "20260923120000-list000", ListData: &ast.ListData{}}
	root.AppendChild(oldList)
	if err := ValidateBlockReplacement(oldList, mindmap); err != nil {
		t.Fatalf("list to mind map replacement failed: %v", err)
	}
	if CanContainBlock(ast.NodeDocument, ast.NodeMindmapItem) {
		t.Fatal("a mind map item cannot be a direct document child")
	}
	if !UpgradeSpec(&parse.Tree{Root: root}) || root.Spec != "5" {
		t.Fatalf("mind map document spec: %s", root.Spec)
	}
	item.AppendChild(&ast.Node{Type: ast.NodeList, ID: "20260923120000-list001"})
	if err := ValidateBlockSubtree(mindmap); err == nil {
		t.Fatal("a list must not be a direct mind map item child")
	}
}

func TestMindmapSpecJSONRejectsOlderVersion(t *testing.T) {
	data := `{"Type":"NodeDocument","Spec":"4","Children":[{"Type":"NodeMindmap","Children":[{"Type":"NodeMindmapItem"}]}]}`
	if err := CheckSpecJSON([]byte(data)); err == nil || !strings.Contains(err.Error(), "spec 5") {
		t.Fatalf("unsupported mind map format was accepted: %v", err)
	}
	legacy := `{"Type":"NodeDocument","Spec":"4","Children":[{"Type":"NodeList","Properties":{"custom-sy-list-mindmap":"1"},"Children":[{"Type":"NodeListItem"}]}]}`
	if err := CheckSpecJSON([]byte(legacy)); err != nil {
		t.Fatalf("existing list mind map cannot be read: %v", err)
	}
}

func TestMindmapSYJSONRead(t *testing.T) {
	data := []byte(`{"Type":"NodeDocument","Spec":"5","ID":"20260923120000-doc0001","Children":[{"Type":"NodeMindmap","ID":"20260923120000-map0001","ListData":{},"Children":[{"Type":"NodeMindmapItem","ID":"20260923120000-item001","ListData":{},"Children":[{"Type":"NodeParagraph","ID":"20260923120000-para001"}]}]}]}`)
	if err := CheckSpecJSON(data); err != nil {
		t.Fatal(err)
	}
	tree, _, err := dataparser.ParseJSON(data, parse.NewOptions())
	if err != nil {
		t.Fatal(err)
	}
	mindmap := tree.Root.FirstChild
	if mindmap.Type != ast.NodeMindmap || mindmap.ID != "20260923120000-map0001" ||
		mindmap.FirstChild.Type != ast.NodeMindmapItem || mindmap.FirstChild.ID != "20260923120000-item001" {
		t.Fatalf("mind map types or IDs were lost: %s %s", mindmap.Type, mindmap.ID)
	}
}
