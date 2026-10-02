package model

import (
	"html"
	"strconv"
	"strings"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
)

// convertMarkdownFootnotes 将脚注定义转换为列表项，引用转换为带上标的静态块引用。
func convertMarkdownFootnotes(tree *parse.Tree) {
	var blocks, definitions, refs []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			switch n.Type {
			case ast.NodeFootnotesDefBlock:
				blocks = append(blocks, n)
			case ast.NodeFootnotesDef:
				if n.ID == "" {
					n.ID = ast.NewNodeID()
				}
				n.SetIALAttr("id", n.ID)
				definitions = append(definitions, n)
			case ast.NodeFootnotesRef:
				refs = append(refs, n)
			}
		}
		return ast.WalkContinue
	})
	for _, ref := range refs {
		_, def := tree.FindFootnotesDef(ref.FootnotesRefLabel)
		if def == nil {
			continue
		}
		ref.InsertBefore(&ast.Node{
			Type: ast.NodeTextMark, TextMarkType: "block-ref sup",
			TextMarkBlockRefID: def.ID, TextMarkBlockRefSubtype: "s",
			TextMarkTextContent: html.EscapeString("[" + strings.TrimPrefix(string(ref.FootnotesRefLabel), "^") + "]"),
		})
		ref.Unlink()
	}
	for _, block := range blocks {
		block.Type = ast.NodeList
		block.ListData = &ast.ListData{Typ: 1, Num: 1, Delimiter: '.', Marker: []byte("1.")}
		number := 0
		for def := block.FirstChild; def != nil; def = def.Next {
			if def.Type != ast.NodeFootnotesDef {
				continue
			}
			number++
			def.ListData = &ast.ListData{Typ: 1, Num: number, Delimiter: '.', Marker: []byte(strconv.Itoa(number) + ".")}
		}
	}
	for _, def := range definitions {
		def.Type = ast.NodeListItem
		def.Tokens = nil
		def.FootnotesRefs = nil
		if def.FirstChild == nil || def.FirstChild.Type == ast.NodeList {
			def.PrependChild(&ast.Node{Type: ast.NodeParagraph})
		}
	}
}

// markdownWithFootnotes2BlockDOM 保留建文档时的编辑器语法选项，并转换标准脚注。
func markdownWithFootnotes2BlockDOM(engine *lute.Lute, markdown string) string {
	if !strings.Contains(markdown, "[^") {
		return engine.Md2BlockDOM(markdown, false)
	}
	footnotes := engine.ParseOptions.Footnotes
	engine.SetFootnotes(true)
	defer engine.SetFootnotes(footnotes)
	tree := parse.Parse("", []byte(markdown), engine.ParseOptions)
	convertMarkdownFootnotes(tree)
	parse.TextMarks2Inlines(tree)
	parse.NestedInlines2FlattedSpansHybrid(tree, false)
	return string(render.NewProtyleRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render())
}
