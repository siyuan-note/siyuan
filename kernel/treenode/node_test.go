// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"strings"
	"testing"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportNodeStdMdListSpacing(t *testing.T) {
	for _, test := range []struct {
		name, source, expected string
	}{
		{"tight nested list", "- parent\n\n  - child\n- sibling\n", "- parent\n  - child\n- sibling"},
		{"multiple paragraphs", "- first\n\n  second\n- sibling\n", "- first\n\n  second\n\n- sibling"},
		{"thematic break", "- text\n\n  ---\n- sibling\n", "- text\n\n  ---\n\n- sibling"},
		{"non-one ordered sublist", "- parent\n\n  2. child\n- sibling\n", "- parent\n\n  2. child\n\n- sibling"},
	} {
		t.Run(test.name, func(t *testing.T) {
			engine := util.NewLute()
			tree := engine.BlockDOM2Tree(engine.Md2BlockDOM(test.source, true))
			// 标准 Markdown 导出使用文档树，但不输出块属性。
			engine.SetKramdownIAL(false)
			if got := ExportNodeStdMd(tree.Root, engine); got != test.expected {
				t.Fatalf("expected %q, got %q", test.expected, got)
			}
		})
	}
}

func TestCustomBlockTypeAbbr(t *testing.T) {
	if actual := TypeAbbr(ast.NodeCustomBlock.String()); "custom" != actual {
		t.Fatalf("expected custom block abbreviation %q, got %q", "custom", actual)
	}
	if actual := FromAbbrType("custom"); ast.NodeCustomBlock.String() != actual {
		t.Fatalf("expected custom block type %q, got %q", ast.NodeCustomBlock.String(), actual)
	}
}

func TestCustomBlockBlockDOMRoundTrip(t *testing.T) {
	const (
		id      = "20260830000000-custom1"
		info    = "example-plugin/chart"
		content = "((20260830000000-ref0001 \"reference\"))\n![image](assets/chart.png)\n{\"value\":\"A&B\"}"
	)
	node := &ast.Node{Type: ast.NodeCustomBlock, ID: id, CustomBlockInfo: info, Tokens: []byte(content)}
	node.SetIALAttr("id", id)
	node.SetIALAttr("updated", id[:14])

	luteEngine := lute.New()
	luteEngine.SetCustomBlock(true)
	dom := luteEngine.RenderNodeBlockDOM(node)
	if !strings.Contains(dom, `data-type="NodeCustomBlock"`) || !strings.Contains(dom, `data-info="`+info+`"`) {
		t.Fatalf("unexpected custom block DOM: %s", dom)
	}

	tree := luteEngine.BlockDOM2Tree(dom)
	if nil == tree || nil == tree.Root || nil == tree.Root.FirstChild {
		t.Fatalf("custom block DOM was not parsed: %s", dom)
	}
	actual := tree.Root.FirstChild
	if ast.NodeCustomBlock != actual.Type || info != actual.CustomBlockInfo || content != string(actual.Tokens) {
		t.Fatalf("unexpected custom block round trip: type=%s, info=%q, content=%q", actual.Type, actual.CustomBlockInfo, actual.Tokens)
	}

	markdown := luteEngine.BlockDOM2Md(dom)
	if !strings.Contains(markdown, ";;;"+info+"\n"+content+"\n;;;") {
		t.Fatalf("unexpected custom block Markdown: %q", markdown)
	}
}

func TestGetDocTitleImgPath(t *testing.T) {
	tests := []struct {
		name     string
		titleImg string
		expected string
	}{
		{
			name:     "image URL",
			titleImg: `background-image:url("assets/cover.png");object-position:center 20%;`,
			expected: "assets/cover.png",
		},
		{
			name:     "built-in gradient",
			titleImg: "background:linear-gradient(#fff 50%, transparent 0);background-size:20px 20px;",
		},
		{
			name:     "attribute injection",
			titleImg: `background:red;" onload="require('child_process')" x="`,
		},
		{
			name:     "missing closing parenthesis",
			titleImg: `background-image:url("assets/cover.png"`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := &ast.Node{KramdownIAL: [][]string{{"title-img", html.EscapeAttrVal(test.titleImg)}}}
			if actual := GetDocTitleImgPath(root); test.expected != actual {
				t.Fatalf("expected %q, got %q", test.expected, actual)
			}
		})
	}
}

func TestGetEmbedBlockRef(t *testing.T) {
	const blockID = "20060102150405-1a2b3c4"
	tests := []struct {
		name     string
		stmt     string
		expected string
	}{
		{name: "exact ID", stmt: "SELECT * FROM blocks WHERE id = '" + blockID + "'", expected: blockID},
		{name: "lowercase SELECT", stmt: "select * from blocks where id = '" + blockID + "'", expected: blockID},
		{name: "leading whitespace", stmt: "\n\t SELECT * FROM blocks WHERE id = '" + blockID + "'", expected: blockID},
		{name: "quoted ID column", stmt: "SELECT * FROM blocks WHERE `id` = '" + blockID + "'", expected: blockID},
		{name: "qualified ID column", stmt: "SELECT * FROM blocks WHERE blocks.id = '" + blockID + "'", expected: blockID},
		{name: "parenthesized condition", stmt: "SELECT * FROM blocks WHERE ((id = '" + blockID + "'))", expected: blockID},
		{name: "limited exact ID", stmt: "SELECT * FROM blocks WHERE id = '" + blockID + "' LIMIT 1", expected: blockID},
		{name: "not equal", stmt: "SELECT * FROM blocks WHERE id != '" + blockID + "'"},
		{name: "additional condition", stmt: "SELECT * FROM blocks WHERE id = '" + blockID + "' AND type = 'd'"},
		{name: "alternative condition", stmt: "SELECT * FROM blocks WHERE id = '" + blockID + "' OR type = 'd'"},
		{name: "ID list", stmt: "SELECT * FROM blocks WHERE id IN ('" + blockID + "')"},
		{name: "ID pattern", stmt: "SELECT * FROM blocks WHERE id LIKE '" + blockID + "'"},
		{name: "reversed comparison", stmt: "SELECT * FROM blocks WHERE '" + blockID + "' = id"},
		{name: "other column", stmt: "SELECT * FROM blocks WHERE parent_id = '" + blockID + "'"},
		{name: "numeric value", stmt: "SELECT * FROM blocks WHERE id = 20060102150405"},
		{name: "invalid ID", stmt: "SELECT * FROM blocks WHERE id = 'invalid'"},
		{name: "non-select statement", stmt: "DELETE FROM blocks WHERE id = '" + blockID + "'"},
		{name: "show tables", stmt: "SHOW TABLES"},
		{name: "show grants", stmt: "show grants"},
		{name: "empty statement"},
		{name: "invalid SQL", stmt: "SELECT FROM"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := GetEmbedBlockRefID(test.stmt); test.expected != actual {
				t.Fatalf("expected raw statement result %q, got %q", test.expected, actual)
			}

			embedNode := &ast.Node{Type: ast.NodeBlockQueryEmbed}
			embedNode.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte(test.stmt)})
			if actual := GetEmbedBlockRef(embedNode); test.expected != actual {
				t.Fatalf("expected %q, got %q", test.expected, actual)
			}
		})
	}
}
