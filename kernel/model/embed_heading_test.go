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
	"strings"
	"testing"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestEmbedHeadingLevels(t *testing.T) {
	for _, test := range []struct {
		name  string
		mode  int
		level int
		want  string
	}{
		{"with heading", 0, 1, "# A\n\n## B\n\n#### C"},
		{"heading only", 1, 5, "##### A"},
		{"visible children", 2, 2, "## B\n\n#### C"},
		{"overflow", 2, 5, "##### B\n\n**C**"},
		{"preserve original", 0, 0, "## A\n\n### B\n\n##### C"},
	} {
		t.Run(test.name, func(t *testing.T) {
			engine := lute.New()
			tree := parse.Parse("", []byte("## A\n\n### B\n\n##### C\n"), engine.ParseOptions)
			nodes := cleanRenderNodes(embeddedBlockNodes(tree.Root.FirstChild, test.mode), true)
			adjustEmbedHeadingLevels(nodes, test.level)
			var result strings.Builder
			for _, node := range nodes {
				md, _ := lute.FormatNodeSync(node, engine.ParseOptions, engine.RenderOptions)
				result.WriteString(md)
				result.WriteString("\n\n")
			}
			if got := strings.TrimSpace(result.String()); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
			if tree.Root.FirstChild.HeadingLevel != 2 || tree.Root.FirstChild.Next.HeadingLevel != 3 || tree.Root.LastChild.HeadingLevel != 5 {
				t.Fatal("source heading levels changed")
			}
		})
	}
}

func TestEmbedHeadingHighestVisibleLevel(t *testing.T) {
	engine := lute.New()
	tree := parse.Parse("", []byte("##### First\n\n### Highest\n\n###### Last\n"), engine.ParseOptions)
	var nodes []*ast.Node
	for node := tree.Root.FirstChild; node != nil; node = node.Next {
		nodes = append(nodes, node)
	}
	adjustEmbedHeadingLevels(nodes, 2)
	for index, expected := range []int{4, 2, 5} {
		if nodes[index].HeadingLevel != expected {
			t.Fatalf("heading %d: got %d, want %d", index, nodes[index].HeadingLevel, expected)
		}
	}
}

func TestEmbedHeadingOverflowPreservesInlineContent(t *testing.T) {
	engine := lute.New()
	tree := parse.Parse("", []byte("# A\n\n## [link](https://example.com) and `code`\n"), engine.ParseOptions)
	adjustEmbedHeadingLevels([]*ast.Node{tree.Root.FirstChild, tree.Root.LastChild}, 6)
	if tree.Root.LastChild.Type != ast.NodeParagraph {
		t.Fatal("overflow heading was not converted to paragraph")
	}
	md, _ := lute.FormatNodeSync(tree.Root, engine.ParseOptions, engine.RenderOptions)
	if !strings.Contains(md, "**[link](https://example.com) and `code`**") {
		t.Fatalf("inline content lost: %s", md)
	}
	if html := engine.MarkdownStr("", md); !strings.Contains(html, "<p><strong><a href=") || strings.Contains(html, "<h7") {
		t.Fatalf("unexpected HTML: %s", html)
	}
}

func TestExplicitEmbedHeadingLevel(t *testing.T) {
	const id = "20260914000000-abcdefg"
	embed := &ast.Node{Type: ast.NodeBlockQueryEmbed}
	embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte("select * from blocks where id='" + id + "'")})
	for _, value := range []string{"", "0", "7", "-1", "01", "invalid", "2"} {
		embed.SetIALAttr(embedHeadingLevelAttr, value)
		want := 0
		if value == "2" {
			want = 2
		}
		if got := explicitEmbedHeadingLevel(embed, id); got != want {
			t.Fatalf("%q: got %d, want %d", value, got, want)
		}
	}
	embed.FirstChild.Tokens = []byte("select * from blocks where type='h'")
	if explicitEmbedHeadingLevel(embed, id) != 0 {
		t.Fatal("query embed received explicit heading levels")
	}
}

func TestEmbedHeadingPreviewPreservesSourceLevel(t *testing.T) {
	engine := lute.New()
	for _, class := range []string{"h2", "protyle-embed-heading--paragraph"} {
		dom := `<div data-node-id="20260914000000-abcdefg" data-type="NodeHeading" data-subtype="h4" class="` + class + `"><div contenteditable="true">Title</div></div>`
		if md := strings.TrimSpace(engine.BlockDOM2StdMd(dom)); md != "#### Title" {
			t.Fatalf("preview class changed source level: %s", md)
		}
	}
}

func TestEmbedHeadingOverflowRichText(t *testing.T) {
	engine := lute.New()
	for _, content := range []string{"**bold** text", "*italic* text", "~~deleted~~ text"} {
		tree := parse.Parse("", []byte("# A\n\n## "+content+"\n"), engine.ParseOptions)
		adjustEmbedHeadingLevels([]*ast.Node{tree.Root.FirstChild, tree.Root.LastChild}, 6)
		md, _ := lute.FormatNodeSync(tree.Root, engine.ParseOptions, engine.RenderOptions)
		html := engine.MarkdownStr("", md)
		if strings.Contains(html, "**") || strings.Contains(html, "<h2") || !strings.Contains(html, "<strong>") {
			t.Fatalf("rich text did not survive overflow: %s", html)
		}
	}
}

func TestEmbedHeadingSetext(t *testing.T) {
	engine := lute.New()
	tree := parse.Parse("", []byte("Title\n=====\n"), engine.ParseOptions)
	nodes := cleanRenderNodes([]*ast.Node{tree.Root.FirstChild}, true)
	adjustEmbedHeadingLevels(nodes, 4)
	md, _ := lute.FormatNodeSync(nodes[0], engine.ParseOptions, engine.RenderOptions)
	if strings.TrimSpace(md) != "#### Title" || !tree.Root.FirstChild.HeadingSetext {
		t.Fatalf("unexpected Setext conversion: %s", md)
	}
}
