package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestExportMarkdownContentOmitsTableCellIAL(t *testing.T) {
	oldConf := Conf
	Conf = NewAppConf()
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	t.Cleanup(func() { Conf = oldConf })
	luteEngine := NewLute()
	tree := parse.Parse("", []byte("| Left | Center | Right |\n| :--- | :---: | ---: |\n| **bold** | middle | end |\n"), luteEngine.ParseOptions)
	var cells []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.Type == ast.NodeTableCell {
			n.SetIALAttr("style", "text-align: left;")
			cells = append(cells, n)
		}
		return ast.WalkContinue
	})
	if len(cells) != 6 {
		t.Fatalf("expected six cells, got %d", len(cells))
	}
	markdown := exportMarkdownContent0(tree.Root.ID, tree, markdownExportOptions{
		Config: conf.Export{
			BlockRefMode:          3,
			BlockEmbedMode:        1,
			FileAnnotationRefMode: 0,
			TagOpenMarker:         "#",
			TagCloseMarker:        "#",
			BlockRefTextLeft:      "",
			BlockRefTextRight:     "",
			AddTitle:              false,
			InlineMemo:            false,
		},
		CloudAssetsBase:            "",
		AssetsDestSpace2Underscore: false,
		AdjustHeadingLevel:         false,
		ImgTag:                     false,
		Ext:                        ".md",
		DefBlockIDs:                nil,
		References:                 nil,
		FillCSSVar:                 false,
		BoxPaths:                   nil,
		AVPublishFilter:            nil,
	})
	if strings.Contains(markdown, "{:") || strings.Contains(markdown, "text-align") {
		t.Fatalf("internal cell attributes leaked into Markdown: %s", markdown)
	}
	for _, content := range []string{"Left", "Center", "Right", "**bold**", "middle", "end"} {
		if !strings.Contains(markdown, content) {
			t.Fatalf("missing %q in Markdown: %s", content, markdown)
		}
	}
	parsed := parse.Parse("", []byte(markdown), luteEngine.ParseOptions)
	tables := 0
	ast.Walk(parsed.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.Type == ast.NodeTable {
			tables++
			if len(n.TableAligns) != 3 || n.TableAligns[0] != 1 || n.TableAligns[1] != 2 || n.TableAligns[2] != 3 {
				t.Fatalf("column alignment changed: %v", n.TableAligns)
			}
		}
		return ast.WalkContinue
	})
	if tables != 1 {
		t.Fatalf("expected one exported table, got %d", tables)
	}
	for _, cell := range cells {
		if cell.IALAttr("style") != "text-align: left;" {
			t.Fatal("export removed the source cell style")
		}
	}
}
