package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestImportMathDelimiters(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	t.Cleanup(func() { Conf = previous })
	for _, enabled := range []bool{true, false} {
		editor := conf.NewEditor()
		editor.MathDelimiterCompatibility = new(enabled)
		Conf.Editor.Store(editor)
		source := []byte("| Formula | Value |\n| --- | --- |\n| \\(\\hat VY\\) | 0.60 |\n\n\\[\nx+y\n\\]\n\n```tex\n\\(code\\)\n```")
		tree, _, _, _ := parseStdMd(source, true)
		inline, block := 0, 0
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering {
				if n.Type == ast.NodeInlineMath || n.Type == ast.NodeTextMark && n.TextMarkType == "inline-math" {
					inline++
				}
				if n.Type == ast.NodeMathBlock {
					block++
				}
			}
			return ast.WalkContinue
		})
		want := 0
		if enabled {
			want = 1
		}
		if inline != want || block != want {
			t.Fatalf("enabled=%v inline=%d block=%d", enabled, inline, block)
		}
		engine := util.NewLute()
		encoded := render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
		restored, _, err := dataparser.ParseJSON(encoded, engine.ParseOptions)
		if err != nil {
			t.Fatal(err)
		}
		dom := engine.SpinBlockDOM(engine.Tree2BlockDOM(restored, engine.RenderOptions, engine.ParseOptions))
		if strings.Count(dom, `data-type="inline-math"`) != want || strings.Count(dom, `data-type="NodeMathBlock"`) != want {
			t.Fatalf("saved formulas changed after reopening: %s", dom)
		}
		if enabled {
			markdown := engine.BlockDOM2StdMd(dom)
			if !strings.Contains(markdown, "$\\hat VY$") || !strings.Contains(markdown, "$$\nx+y\n$$") {
				t.Fatalf("export lost canonical formulas: %s", markdown)
			}
		}
		// Normal editor engines must not inherit import-only parsing options.
		if util.NewLute().ParseOptions.LatexMath || util.NewStdLute().ParseOptions.LatexMath {
			t.Fatal("external-input syntax escaped its entry point")
		}
	}
}
