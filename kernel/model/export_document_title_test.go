//go:build fts5

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportDocumentTitleInlines(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	boxID := prepareDocumentTitleFeatureBox(t)
	source := newHPathTestDoc(t, boxID, "/", "Source", 1)
	definition := newHPathTestDoc(t, boxID, "/", "Definition", 1)
	setTitle := func(tree *parse.Tree, markdown string) {
		t.Helper()
		paragraph := parse.Parse("", []byte(markdown), util.NewLute().ParseOptions).Root.FirstChild
		if err := treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
			t.Fatal(err)
		}
	}
	setTitle(definition, "**TargetStyled** ![](assets/target.png)")
	setTitle(source, "**TitleOnly** ![title](assets/title.png) [Link](https://example.com/a/b)")
	title, err := treenode.DocumentTitleParagraph(source.Root)
	if err != nil {
		t.Fatal(err)
	}
	title.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: definition.ID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "TargetAnchor"})
	if err = treenode.SetDocumentTitleParagraph(source.Root, title); err != nil {
		t.Fatal(err)
	}
	source.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("BODY_MARKER")})
	saveDocumentTitleFeatureTree(t, definition)
	saveDocumentTitleFeatureTree(t, source)
	originalTitle := source.Root.DocumentTitle.Content
	for _, mode := range []int{2, 3, 4} {
		for _, addTitle := range []bool{false, true} {
			config := *Conf.Export.Load()
			config.AddTitle, config.BlockRefMode = addTitle, mode
			markdown := exportMarkdownContent0(source.ID, source, markdownExportOptions{Config: config, Ext: ".md"})
			if !strings.Contains(markdown, "BODY_MARKER") {
				t.Fatal("export lost document body")
			}
			if addTitle {
				if strings.Count(markdown, "TitleOnly") != 1 || !strings.Contains(markdown, "**TitleOnly**") ||
					!strings.Contains(markdown, "assets/title.png") || !strings.Contains(markdown, "https://example.com/a/b") ||
					!strings.Contains(markdown, "TargetAnchor") {
					t.Fatalf("rich title missing or duplicated (mode %d): %s", mode, markdown)
				}
				if mode == 4 && (!strings.Contains(markdown, "[^") || !strings.Contains(markdown, "**TargetStyled**") || !strings.Contains(markdown, "assets/target.png")) {
					t.Fatalf("title references or rich document footnote title lost: %s", markdown)
				}
			} else if strings.Contains(markdown, "TitleOnly") || strings.Contains(markdown, "TargetAnchor") || strings.Contains(markdown, "assets/title.png") {
				t.Fatalf("AddTitle=false still exported title: %s", markdown)
			}
			if source.Root.DocumentTitle == nil || source.Root.DocumentTitle.Content != originalTitle || source.Root.FirstChild.Next != nil {
				t.Fatal("export changed original title source or body")
			}
		}
	}
	config := *Conf.Export.Load()
	config.AddTitle = true
	exported, err := exportTree(source, treeExportOptions{Config: config, CustomTitle: "Custom/plain **literal**"})
	if err != nil {
		t.Fatal(err)
	}
	heading := exported.Root.FirstChild
	if heading.Type != ast.NodeHeading || heading.FirstChild.Type != ast.NodeText || string(heading.FirstChild.Tokens) != "Custom/plain **literal**" || heading.FirstChild.Next != nil {
		t.Fatal("explicit custom title was not preserved as literal text")
	}
	loaded, err := filesys.LoadTree(boxID, source.Path, util.NewLute())
	if err != nil || loaded.Root.DocumentTitle.Content != originalTitle {
		t.Fatal("export changed persisted source title", err)
	}
	child := newHPathTestDoc(t, boxID, "/"+source.ID, "Child", 1)
	setTitle(child, "**ChildStyled** ![child](assets/child.png)")
	saveDocumentTitleFeatureTree(t, child)
	merged, err := mergeSubDocs(loaded, MergeHeadingOptions{DocHeadingMode: MergeDocHeadingModeTree}, true)
	if err != nil {
		t.Fatal(err)
	}
	markdown := exportMarkdownContent0(source.ID, merged, markdownExportOptions{Config: config, Ext: ".md"})
	if strings.Count(markdown, "ChildStyled") != 1 || !strings.Contains(markdown, "**ChildStyled**") || !strings.Contains(markdown, "assets/child.png") {
		t.Fatalf("merged child document lost or duplicated rich title: %s", markdown)
	}
}
