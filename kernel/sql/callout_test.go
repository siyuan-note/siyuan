package sql

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCalloutTitleReferenceIndex(t *testing.T) {
	const defID = "20261015120000-ref0001"
	for _, title := range []string{
		`<span data-type="block-ref" data-id="` + defID + `" data-subtype="d">Dynamic</span>`,
		`((` + defID + ` "Static"))`,
	} {
		tree := treenode.NewTree("20261015120000-box0001", "/20261015120000-doc0001.sy", "/Callout", "Callout")
		callout := &ast.Node{Type: ast.NodeCallout, ID: ast.NewNodeID(), CalloutType: "NOTE", CalloutTitle: title + " " + title}
		body := treenode.NewParagraph("")
		callout.AppendChild(body)
		tree.Root.AppendChild(callout)
		refs, _ := refsFromTree(tree)
		if len(refs) != 1 || refs[0].BlockID != callout.ID || refs[0].DefBlockID != defID || refs[0].RootID != tree.ID {
			t.Fatalf("title reference ownership or deduplication failed: %+v", refs)
		}
		if callout.FirstChild != body || body.Next != nil || callout.CalloutTitle != title+" "+title {
			t.Fatal("indexing must preserve title and body")
		}
		body.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: defID,
			TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Body"})
		refs, _ = refsFromTree(tree)
		if len(refs) != 2 || refs[0].BlockID == refs[1].BlockID {
			t.Fatalf("body references must retain independent ownership: %+v", refs)
		}
		callout.CalloutTitle = "Plain title"
		refs, _ = refsFromTree(tree)
		if len(refs) != 1 || refs[0].BlockID != body.ID {
			t.Fatal("removing the title reference must retain only the body reference")
		}
	}
}

func TestCalloutMarkdownTitleIndex(t *testing.T) {
	l := util.NewLute()
	tree := parse.Parse("", []byte("> [!NOTE] ((20261015120000-ref0001 'Title'))\n> Body\n"), l.ParseOptions)
	parse.NestedInlines2FlattedSpans(tree, false)
	tree.ID, tree.Box, tree.Path = "20261015120000-doc0001", "20261015120000-box0001", "/20261015120000-doc0001.sy"
	tree.Root.ID = tree.ID
	callout := tree.Root.FirstChild
	callout.ID = ast.NewNodeID()
	if callout.Type != ast.NodeCallout {
		t.Fatal("expected a callout parsed from Markdown")
	}
	refs, _ := refsFromTree(tree)
	if len(refs) != 1 || refs[0].BlockID != callout.ID || !strings.Contains(nodeStaticContent(callout, nil, false, false, false, false), "Title") {
		t.Fatalf("parsed callout title was not indexed: %+v", refs)
	}
}
