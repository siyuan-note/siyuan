// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
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

func TestImportMathDelimitersRichCells(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	t.Cleanup(func() { Conf = previous })
	for _, enabled := range []bool{true, false} {
		editor := conf.NewEditor()
		editor.MathDelimiterCompatibility = new(enabled)
		Conf.Editor.Store(editor)
		source := []byte("| Formula |\n| --- |\n| <p><span>\\(x+y\\)</span></p><p>\\[z\\]</p><pre><code>\\(code\\)</code></pre> |")
		tree, _, _, _ := parseStdMd(source, true)
		engine := util.NewLute()
		encoded := render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
		restored, _, err := dataparser.ParseJSON(encoded, engine.ParseOptions)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		ast.Walk(restored.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || n.Type != ast.NodeTableCell || n.TableCellRich == nil {
				return ast.WalkContinue
			}
			found = true
			fragment, err := parse.ParseTableCellRich(n.TableCellRich)
			if err != nil {
				t.Fatal(err)
			}
			dom := engine.SpinBlockDOM(engine.Tree2BlockDOM(fragment, engine.RenderOptions, engine.ParseOptions))
			want := 0
			if enabled {
				want = 1
			}
			if strings.Count(dom, `data-type="inline-math"`) != want || strings.Count(dom, `data-type="NodeMathBlock"`) != want || !strings.Contains(dom, "code") {
				t.Fatalf("enabled=%v reopened rich cell=%s", enabled, dom)
			}
			return ast.WalkSkipChildren
		})
		if !found {
			t.Fatal("missing rich table cell")
		}
	}
}

func TestObsidianMathDelimiterProtection(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	t.Cleanup(func() { Conf = previous })
	source := []byte("\\(\\text{[[Missing]] %%literal%% [^note]}\\)\n\n\\[\nx ^power\n\\]\n")
	for _, enabled := range []bool{true, false} {
		editor := conf.NewEditor()
		editor.MathDelimiterCompatibility = new(enabled)
		Conf.Editor.Store(editor)
		scan := scanObsidianSource(source)
		want := 1
		if enabled {
			want = 0
		}
		if len(scan.Wikis) != want || len(scan.Comments) != want || len(scan.BlockIDs) != want || scan.Footnotes != want {
			t.Fatalf("enabled=%v unexpected formula scan: %+v", enabled, scan)
		}
		doc := newObsidianTestDoc("Math")
		vault := &obsidianVaultContext{}
		transformed, stats := transformObsidianMarkdown(vault, doc, source)
		tree, err := parseObsidianMd(transformed, vault, doc, stats)
		if err != nil {
			t.Fatal(err)
		}
		if enabled {
			engine := util.NewLute()
			dom := engine.Tree2BlockDOM(tree, engine.RenderOptions, engine.ParseOptions)
			if !strings.Contains(dom, `\text{[[Missing]] %%literal%% [^note]}`) || !strings.Contains(dom, "x ^power") {
				t.Fatalf("Obsidian conversion changed formula content: %s", dom)
			}
		}
	}
}
