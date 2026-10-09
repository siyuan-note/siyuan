// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func shorthandSyntaxTestSettings(t testing.TB) {
	previous := util.MarkdownSettings
	util.MarkdownSettings = util.NewMarkdown()
	t.Cleanup(func() { util.MarkdownSettings = previous })
}

func shorthandSyntaxNodes(tree *parse.Tree, typ ast.NodeType) (ret []*ast.Node) {
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == typ {
			ret = append(ret, node)
		}
		return ast.WalkContinue
	})
	return
}

func TestShorthandMarkdownSettings(t *testing.T) {
	shorthandSyntaxTestSettings(t)
	for _, factory := range []struct {
		name string
		new  func() *lute.Lute
	}{{"new", util.NewLute}, {"append", util.NewStdLute}} {
		for _, tc := range []struct {
			name, md, mark string
			set            func(bool)
			node           ast.NodeType
		}{
			{"asterisk", "**text**", "strong", func(v bool) { util.MarkdownSettings.InlineAsterisk = v }, ast.NodeTextMark},
			{"underscore", "__text__", "strong", func(v bool) { util.MarkdownSettings.InlineUnderscore = v }, ast.NodeTextMark},
			{"sup", "^text^", "sup", func(v bool) { util.MarkdownSettings.InlineSup = v }, ast.NodeTextMark},
			{"sub", "~text~", "sub", func(v bool) { util.MarkdownSettings.InlineSub = v }, ast.NodeTextMark},
			{"tag", "#text#", "tag", func(v bool) { util.MarkdownSettings.InlineTag = v }, ast.NodeTextMark},
			{"math", "$text$", "inline-math", func(v bool) { util.MarkdownSettings.InlineMath = v }, ast.NodeTextMark},
			{"strikethrough", "~~text~~", "s", func(v bool) { util.MarkdownSettings.InlineStrikethrough = v }, ast.NodeTextMark},
			{"full-width-strikethrough", "～～text～～", "s", func(v bool) { util.MarkdownSettings.InlineFullWidthStrikethrough = v }, ast.NodeTextMark},
			{"mark", "==text==", "mark", func(v bool) { util.MarkdownSettings.InlineMark = v }, ast.NodeTextMark},
			{"middle-dot", "···go\ntext\n···", "", func(v bool) { util.MarkdownSettings.CodeBlockMiddleDot = &v }, ast.NodeCodeBlock},
			{"full-width-task", "【X】text", "", func(v bool) { util.MarkdownSettings.BlockFullWidthTaskList = &v }, ast.NodeListItem},
		} {
			for _, enabled := range []bool{false, true} {
				name := factory.name + "/" + tc.name + "/disabled"
				if enabled {
					name = factory.name + "/" + tc.name + "/enabled"
				}
				t.Run(name, func(t *testing.T) {
					util.MarkdownSettings = util.NewMarkdown()
					tc.set(enabled)
					tree := parseShorthandMarkdown(tc.md, time.Now(), factory.new())
					found := false
					for _, node := range shorthandSyntaxNodes(tree, tc.node) {
						if "" == tc.mark || node.IsTextMarkType(tc.mark) {
							found = true
						}
					}
					if found != enabled {
						t.Fatalf("syntax found = %v, enabled = %v", found, enabled)
					}
				})
			}
		}
	}
}

func TestShorthandMiddleDotCodeProtection(t *testing.T) {
	shorthandSyntaxTestSettings(t)
	for _, tc := range []struct {
		name, md, code string
		tasks          int
	}{
		{"markdown-body", "···go\n# heading\n- item\n<div>html</div>\n【X】literal\n```\n···\n\n【】task", "# heading\n- item\n<div>html</div>\n【X】literal\n```\n", 1},
		{"quote", "> ···go\n> - item\n> ···\n\n【】task", "- item\n", 1},
		{"list", "- ···go\n  - item\n  ···\n\n【】task", "- item\n", 1},
		{"list-tab-close", "- ···go\n  body\n\t···\n\n【】task", "body\n", 1},
		{"root-tab-close", "···go\n\t···\nbody\n···", "\t···\nbody\n", 0},
		{"short-close", "····go\n···\nbody\n····", "···\nbody\n", 0},
		{"suffix-close", "···go\n···extra\nbody\n···", "···extra\nbody\n", 0},
		{"indented-close", "  ···go\n     ···\nbody\n···\n\n【】task", "     ···\nbody\n", 1},
		{"unclosed", "···go\nbody\n【】literal", "body\n【】literal\n", 0},
		{"exit-quote", "> ···go\n> body\n\n【】task", "body\n", 1},
		{"native-code", "```go\n···\n【】literal\n```\n\n【】task", "···\n【】literal\n", 1},
		{"unclosed-before-short-pairs", "····go\nhead\n···js\none\n···\n\n···js\ntwo\n···", "head\n···js\none\n···\n\n···js\ntwo\n···\n", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tree := parseShorthandMarkdown(tc.md, time.Now(), util.NewLute())
			codes := shorthandSyntaxNodes(tree, ast.NodeCodeBlockCode)
			if 1 != len(codes) || string(codes[0].Tokens) != tc.code {
				var actual []string
				for _, code := range codes {
					actual = append(actual, string(code.Tokens))
				}
				t.Fatalf("code = %q, want %q", actual, tc.code)
			}
			count := 0
			for _, item := range shorthandSyntaxNodes(tree, ast.NodeListItem) {
				if 3 == item.ListData.Typ {
					count++
				}
			}
			if count != tc.tasks {
				t.Fatalf("task count = %d, want %d", count, tc.tasks)
			}
		})
	}
}

func TestShorthandTaskMarkersAndLiteralProtection(t *testing.T) {
	shorthandSyntaxTestSettings(t)
	for _, tc := range []struct {
		md     string
		marker string
	}{
		{"【】task", " "}, {"【X】task", "X"}, {"【x】task", "X"}, {"【/】task", "/"},
		{"【\"】task", "&quot;"}, {"【&】task", "&amp;"}, {"[X】task", "X"}, {"【X]task", "X"},
		{"【<】task", "&lt;"}, {"【>】task", "&gt;"},
		{"> 【】task", " "}, {"- 【】task", " "}, {"- parent\n  【】task", " "},
		{"\\【】literal", ""}, {"`【】literal`", ""}, {"`code\n【】literal\ncode`", ""},
		{"<pre>\n【】literal\n···\n</pre>", ""}, {"$$\n【】literal\n···\n$$", ""},
		{";;;plugin/test\n【】literal\n···\n;;;", ""}, {"【\t】literal", ""},
		{"[]literal", ""}, {"¥¥literal", ""},
		{"    【X】literal", ""}, {"text\n2. 【X】literal", ""},
	} {
		t.Run(tc.md, func(t *testing.T) {
			tree := parseShorthandMarkdown(tc.md, time.Now(), util.NewLute())
			var actual []string
			for _, item := range shorthandSyntaxNodes(tree, ast.NodeListItem) {
				if 3 == item.ListData.Typ {
					actual = append(actual, item.ChildByType(ast.NodeTaskListItemMarker).EffectiveTaskListItemMarker())
				}
			}
			if "" == tc.marker && 0 != len(actual) || "" != tc.marker && (1 != len(actual) || actual[0] != tc.marker) {
				t.Fatalf("task markers = %q, want %q", actual, tc.marker)
			}
			dom := util.NewLute().Tree2BlockDOM(tree, util.NewLute().RenderOptions, util.NewLute().ParseOptions)
			if strings.Contains(dom, "siyuanshorthandprobe") {
				t.Fatal("temporary syntax marker persisted")
			}
		})
	}
	util.MarkdownSettings.CodeBlockMiddleDot = nil
	util.MarkdownSettings.BlockFullWidthTaskList = nil
	tree := parseShorthandMarkdown("···\ncode\n···\n\n【】task", time.Now(), util.NewLute())
	if 1 != len(shorthandSyntaxNodes(tree, ast.NodeCodeBlock)) || 1 != len(shorthandSyntaxNodes(tree, ast.NodeListItem)) {
		t.Fatal("missing default shortcut settings disabled conversion")
	}
}

func TestShorthandRejectedMarkersPreserveOriginalText(t *testing.T) {
	shorthandSyntaxTestSettings(t)
	for _, md := range []string{"    ···go\nbody", "text\n    ···go\nbody", "···go~x\nbody", "\\···go\nbody", "`code\n···\ncode`", "    【X】literal", "text\n2. 【X】literal"} {
		t.Run(md, func(t *testing.T) {
			actual, tasks := normalizeShorthandMarkdown(md, util.NewLute().ParseOptions)
			if actual != md || 0 != len(tasks) {
				t.Fatalf("invalid marker changed: got %q, want %q", actual, md)
			}
		})
	}
}

func TestShorthandBatchStopsAtEarlierContainer(t *testing.T) {
	shorthandSyntaxTestSettings(t)
	md := "> ···\n····\n\n···go\nx\n···\n\n···go\ny\n···"
	tree := parseShorthandMarkdown(md, time.Now(), util.NewLute())
	rootCodes := 0
	for _, code := range shorthandSyntaxNodes(tree, ast.NodeCodeBlock) {
		if code.Parent != tree.Root {
			continue
		}
		rootCodes++
		body := code.ChildByType(ast.NodeCodeBlockCode).TokensStr()
		if !strings.Contains(body, "···go\nx\n···") || !strings.Contains(body, "···go\ny\n···") {
			t.Fatalf("batch normalization changed an earlier unclosed fence body: %q", body)
		}
	}
	if 1 != rootCodes {
		t.Fatalf("root code blocks = %d, want one unclosed block", rootCodes)
	}
}

func TestShorthandBatchPreservesNewlyExposedLiteralContexts(t *testing.T) {
	shorthandSyntaxTestSettings(t)
	for _, tc := range []struct{ md, literalTail string }{
		{"  ···go\n····\n</pre>\n···\n  ···", "</pre>\n···\n  ···"},
		{"···go\n`text\n···\nend`\n···js\nbody\n···\ntail`", "end`\n···js\nbody\n···\ntail`"},
	} {
		actual, _ := normalizeShorthandMarkdown(tc.md, util.NewLute().ParseOptions)
		if !strings.HasSuffix(actual, tc.literalTail) {
			t.Fatalf("batch conversion changed a literal context exposed by an earlier fence: %q", actual)
		}
	}
}

func TestShorthandSyntaxKeepsOtherImportBehavior(t *testing.T) {
	shorthandSyntaxTestSettings(t)
	engine := util.NewStdLute()
	if engine.ParseOptions.Mark {
		t.Fatal("standard imports unexpectedly enabled marks")
	}
	tree := parseShorthandMarkdown("==mark==\n\n    code\n\n- [/] literal", time.Now(), engine)
	for _, item := range shorthandSyntaxNodes(tree, ast.NodeListItem) {
		if 3 == item.ListData.Typ {
			t.Fatal("full-width task support expanded ordinary task syntax")
		}
	}
	if 1 != len(shorthandSyntaxNodes(tree, ast.NodeCodeBlock)) || util.NewStdLute().ParseOptions.Mark {
		t.Fatal("shorthand parsing changed the standard import profile")
	}
	const literal = "siyuanshorthandprobe0z"
	tree = parseShorthandMarkdown("【】"+literal, time.Now(), util.NewLute())
	if tree.Root.Text() != literal {
		t.Fatalf("user text collided with temporary syntax markers: %q", tree.Root.Text())
	}
}

func BenchmarkShorthandMarkdownFences(b *testing.B) {
	shorthandSyntaxTestSettings(b)
	for _, count := range []int{100, 1000} {
		md := strings.Repeat("···go\nbody\n···\n\n", count)
		b.Run(strconv.Itoa(count), func(b *testing.B) {
			engine := util.NewLute()
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				parseShorthandMarkdown(md, time.Now(), engine)
			}
		})
	}
}

func BenchmarkShorthandMarkdownFalseClosings(b *testing.B) {
	shorthandSyntaxTestSettings(b)
	md := "····go\n" + strings.Repeat("···\n    ····\n", 1000) + "····"
	engine := util.NewLute()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		parseShorthandMarkdown(md, time.Now(), engine)
	}
}
