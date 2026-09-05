package sql

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestTabsIndexIncludesEveryTitleAndBody(t *testing.T) {
	tabs := &ast.Node{Type: ast.NodeTabs}
	for _, text := range []string{"First", "Second"} {
		item := &ast.Node{Type: ast.NodeTabItem, ID: ast.NewNodeID(), TabItemTitle: "**" + text + " title**"}
		paragraph := &ast.Node{Type: ast.NodeParagraph}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text + " body")})
		item.AppendChild(paragraph)
		tabs.AppendChild(item)
	}
	tabs.SetIALAttr("tabs-active-id", tabs.FirstChild.ID)
	content := nodeStaticContent(tabs, nil, false, false, false, false)
	for _, text := range []string{"First title", "First body", "Second title", "Second body"} {
		if !strings.Contains(content, text) {
			t.Fatalf("missing %q in %q", text, content)
		}
	}
}

func TestTabTitleReferenceOwnership(t *testing.T) {
	tree := treenode.NewTree("20260905120000-box0001", "/20260905120000-doc0001.sy", "/Tabs", "Tabs")
	item := &ast.Node{Type: ast.NodeTabItem, ID: "20260905120000-item001",
		TabItemTitle: `<span data-type="block-ref" data-id="20260905120000-ref0001" data-subtype="d">Referenced title</span>`}
	body := treenode.NewParagraph("20260905120000-para001")
	item.AppendChild(body)
	tabs := &ast.Node{Type: ast.NodeTabs, ID: "20260905120000-tabs001"}
	tabs.AppendChild(item)
	tree.Root.AppendChild(tabs)
	refs, _ := refsFromTree(tree)
	if len(refs) != 1 || refs[0].BlockID != item.ID || refs[0].DefBlockID != "20260905120000-ref0001" {
		t.Fatalf("title references: %+v", refs)
	}
	if item.FirstChild != body {
		t.Fatal("indexing changed the tab body")
	}
}
