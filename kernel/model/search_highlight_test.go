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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMarkReplaceSpanMatchesRawText(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	Conf.Search = conf.NewSearch()
	t.Cleanup(func() {
		Conf = previousConf
	})

	luteEngine := util.NewLute()
	t.Run("plain text", func(t *testing.T) {
		root := &ast.Node{Type: ast.NodeDocument}
		text := &ast.Node{Type: ast.NodeText, Tokens: []byte("1&2amp")}
		root.AppendChild(text)

		var unlinks []*ast.Node
		if !markReplaceSpan(text, &unlinks, []string{"amp"}, search.MarkDataType, luteEngine) {
			t.Fatal("真实的 amp 没有生成搜索高亮")
		}
		for _, unlink := range unlinks {
			unlink.Unlink()
		}
		assertSearchMarkContents(t, root, []string{"amp"})
	})

	t.Run("entity only", func(t *testing.T) {
		root := &ast.Node{Type: ast.NodeDocument}
		text := &ast.Node{Type: ast.NodeText, Tokens: []byte("A&B")}
		root.AppendChild(text)

		var unlinks []*ast.Node
		if markReplaceSpan(text, &unlinks, []string{"amp"}, search.MarkDataType, luteEngine) {
			t.Fatal("HTML 实体中的 amp 被误判为搜索命中")
		}
		if "A&B" != string(text.Tokens) {
			t.Fatalf("未命中的文本被修改为 %q", text.Tokens)
		}
	})

	for _, textMarkType := range []string{"code", "tag", "strong", "em", "a"} {
		t.Run(textMarkType, func(t *testing.T) {
			root := &ast.Node{Type: ast.NodeDocument}
			textMark := &ast.Node{
				Type:                ast.NodeTextMark,
				TextMarkType:        textMarkType,
				TextMarkTextContent: "1&amp;2amp",
			}
			if "a" == textMarkType {
				textMark.TextMarkAHref = "https://example.com"
			}
			root.AppendChild(textMark)

			var unlinks []*ast.Node
			keywords := []string{"amp"}
			if !markReplaceSpan(textMark, &unlinks, keywords, search.MarkDataType, luteEngine) {
				t.Fatalf("%s 中真实的 amp 没有生成搜索高亮", textMarkType)
			}
			if "amp" != keywords[0] {
				t.Fatalf("关键字被修改为 %q", keywords[0])
			}
			for _, unlink := range unlinks {
				unlink.Unlink()
			}
			assertSearchMarkContents(t, root, []string{"amp"})
		})
	}

	t.Run("code entity only", func(t *testing.T) {
		root := &ast.Node{Type: ast.NodeDocument}
		textMark := &ast.Node{
			Type:                ast.NodeTextMark,
			TextMarkType:        "code",
			TextMarkTextContent: "A&amp;B",
		}
		root.AppendChild(textMark)

		var unlinks []*ast.Node
		if markReplaceSpan(textMark, &unlinks, []string{"amp"}, search.MarkDataType, luteEngine) {
			t.Fatal("行级代码实体中的 amp 被误判为搜索命中")
		}
		if "A&amp;B" != textMark.TextMarkTextContent {
			t.Fatalf("未命中的行级代码被修改为 %q", textMark.TextMarkTextContent)
		}
	})
}

func TestExtractedMarkContentsMatchRawText(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	Conf.Search = conf.NewSearch()
	t.Cleanup(func() {
		Conf = previousConf
	})

	start := search.GetMarkSpanStart(search.MarkDataType)
	end := search.GetMarkSpanEnd()
	tests := []string{"&", "a&b", "R&D", "<foo>", "\"quoted\"", "'quoted'", "&amp;"}
	for _, content := range tests {
		t.Run(content, func(t *testing.T) {
			marked, matched := markReplaceSpanWithSplit(content, []string{content}, start, end)
			if !matched {
				t.Fatalf("%q 未生成高亮", content)
			}

			keywords := getMarkedTextContents(marked, start, end)
			if 1 != len(keywords) || content != keywords[0] {
				t.Fatalf("提取的关键字为 %q，期望 [%q]", keywords, content)
			}

			root := &ast.Node{Type: ast.NodeDocument}
			text := &ast.Node{Type: ast.NodeText, Tokens: []byte(content)}
			root.AppendChild(text)
			var unlinks []*ast.Node
			if !markReplaceSpan(text, &unlinks, keywords, search.MarkDataType, util.NewLute()) {
				t.Fatalf("提取的关键字 %q 未匹配原始文本", keywords)
			}
			for _, unlink := range unlinks {
				unlink.Unlink()
			}
			assertSearchMarkContents(t, root, []string{content})
		})
	}
}

func assertSearchMarkContents(t *testing.T, root *ast.Node, want []string) {
	t.Helper()
	var got []string
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTextMark == n.Type && n.IsTextMarkType(search.MarkDataType) {
			got = append(got, html.UnescapeString(n.TextMarkTextContent))
		}
		return ast.WalkContinue
	})
	if len(want) != len(got) {
		t.Fatalf("搜索高亮内容为 %q，期望 %q", got, want)
	}
	for i := range want {
		if want[i] != got[i] {
			t.Fatalf("搜索高亮内容为 %q，期望 %q", got, want)
		}
	}
}
