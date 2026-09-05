package treenode

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTabsSpecAndStructure(t *testing.T) {
	tree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument, Spec: "2"}}
	if UpgradeSpec(tree) {
		t.Fatal("ordinary documents must stay on spec 2")
	}
	tabs := &ast.Node{Type: ast.NodeTabs, ID: ast.NewNodeID()}
	tree.Root.AppendChild(tabs)
	if !NormalizeTabs(tree.Root) || tabs.FirstChild.Type != ast.NodeTabItem || tabs.FirstChild.FirstChild.Type != ast.NodeParagraph {
		t.Fatal("empty tab normalization failed")
	}
	if !UpgradeSpec(tree) || tree.Root.Spec != "3" {
		t.Fatal("tabs require spec 3")
	}
	if err := ValidateBlockSubtree(tree.Root); err != nil {
		t.Fatal(err)
	}
	if err := ValidateTabsAttrs(tabs, map[string]string{TabsActiveIDAttr: tabs.FirstChild.FirstChild.ID}); err == nil {
		t.Fatal("descendant cannot be selected as a direct tab")
	}
	if err := ValidateTabsAttrs(tabs, map[string]string{TabsPositionAttr: "right"}); err == nil {
		t.Fatal("invalid layout accepted")
	}
	tabs.Unlink()
	UpgradeSpec(tree)
	if tree.Root.Spec != "3" {
		t.Fatal("spec must not downgrade")
	}
	if CanContainBlock(ast.NodeDocument, ast.NodeTabItem) || CanContainBlock(ast.NodeTabs, ast.NodeParagraph) {
		t.Fatal("invalid tab parent accepted")
	}
}

func TestTabTitleWalkerOwnershipAndRewrite(t *testing.T) {
	title := `**Title** ((20260905120000-ref0001 'Reference')) ![Image](assets/picture.png)`
	item := &ast.Node{Type: ast.NodeTabItem, ID: ast.NewNodeID(), TabItemTitle: title}
	body := NewParagraph("")
	item.AppendChild(body)
	references := 0
	WalkWithTabTitles(item, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && IsBlockRef(n) {
			references++
			if ParentBlock(n) != item {
				t.Fatal("title reference has incorrect owner")
			}
		}
		return ast.WalkContinue
	})
	if references != 1 || item.TabItemTitle != title || item.FirstChild != body {
		t.Fatal("read traversal changed the document")
	}
	WalkWithTabTitles(item, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && IsBlockRef(n) {
			n.TextMarkBlockRefID = "20260905120000-ref0002"
		}
		if entering && n.Type == ast.NodeLinkDest {
			n.Tokens = []byte("assets/renamed.png")
		}
		return ast.WalkContinue
	})
	if !strings.Contains(item.TabItemTitle, "ref0002") || !strings.Contains(item.TabItemTitle, "renamed.png") || item.FirstChild != body {
		t.Fatal(item.TabItemTitle)
	}
	l := util.NewLute()
	finish := MaterializeTabTitles(item)
	item.FirstChild.FirstChild.Unlink()
	finish()
	if item.FirstChild != body || strings.Contains(FormatNode(TabTitleParagraph(item), l), "Title") {
		t.Fatal("temporary title was not restored")
	}
}

func TestTabsOriginalTitleOwnershipAndNormalization(t *testing.T) {
	l := util.NewLute()
	tree := parse.Parse("", []byte("**Title** ((20260905120000-ref0001 'Reference'))\n"), l.ParseOptions)
	parse.NestedInlines2FlattedSpans(tree, false)
	title := tree.Root.FirstChild
	title.ID = ast.NewNodeID()
	title.SetIALAttr("id", title.ID)
	title.SetIALAttr("tabs-title", "true")
	title.SetIALAttr("custom-test", "retained")
	item := &ast.Node{Type: ast.NodeTabItem, ID: ast.NewNodeID(), TabItemTitle: "unused fallback"}
	item.AppendChild(title)
	if !NormalizeTabs(item) || title.Next == nil || title.Next.Type != ast.NodeParagraph {
		t.Fatal("title must not replace the empty body caret")
	}
	if NormalizeTabs(item) {
		t.Fatal("normalization must be stable")
	}
	references := 0
	WalkWithTabTitles(item, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && IsBlockRef(n) {
			references++
			if ParentBlock(n) != title {
				t.Fatal("original title paragraph must own its references")
			}
			n.TextMarkBlockRefID = "20260905120000-ref0002"
		}
		return ast.WalkContinue
	})
	if references != 1 || !strings.Contains(FormatNode(title, l), "ref0002") {
		t.Fatal("title reference traversal or rewrite failed")
	}
	finish := MaterializeTabTitles(item)
	finish()
	if item.TabTitleBlock() != title || title.IALAttr("custom-test") != "retained" || TabTitleParagraph(item) != nil {
		t.Fatal("title identity was replaced or synthesized twice")
	}
}
