// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// Markdown 单元格使用单行 HTML 保存块结构，其他格式使用子块参与后续导出转换。
func appendAttributeViewRichTextExport(cell *ast.Node, value *av.ValueText, richTableCells bool) error {
	fragment, err := av.ParseValueTextRich(value.Rich)
	if err != nil {
		return err
	}
	var unlinks []*ast.Node
	ast.Walk(fragment.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			node.ID = ""
			node.RemoveIALAttr("id")
			node.RemoveIALAttr("updated")
			if node.Type == ast.NodeKramdownBlockIAL {
				unlinks = append(unlinks, node)
			}
		}
		return ast.WalkContinue
	})
	for _, node := range unlinks {
		node.Unlink()
	}
	if !richTableCells {
		options := render.NewOptions()
		options.Sanitize, options.SoftBreak2HardBreak, options.DataTask = true, true, true
		options.CodeSyntaxHighlight = false
		renderer := render.NewHtmlRenderer(fragment, options, fragment.Context.ParseOption)
		renderer.SetTextMarkStandardTag()
		content := renderer.Render()
		content = bytes.ReplaceAll(content, []byte("|"), []byte("&#124;"))
		content = bytes.ReplaceAll(content, []byte("\r"), []byte("&#13;"))
		content = bytes.ReplaceAll(content, []byte("\n"), []byte("&#10;"))
		cell.AppendChild(&ast.Node{Type: ast.NodeInlineHTML, Tokens: content})
		return nil
	}
	for fragment.Root.FirstChild != nil {
		cell.AppendChild(fragment.Root.FirstChild)
	}
	return nil
}

// normalizeExportPreviewTree 保留包含块级内容的单元格，避免 Markdown 往返将其拆到表格外。
func normalizeExportPreviewTree(tree *parse.Tree, luteEngine *lute.Lute) *parse.Tree {
	convertExportPreviewTabs(tree.Root)
	tables := map[*ast.Node]struct{}{}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || node.Type != ast.NodeTableCell {
			return ast.WalkContinue
		}
		for child := node.FirstChild; child != nil; child = child.Next {
			if child.IsBlock() {
				table := node.Parent
				for table != nil && table.Type != ast.NodeTable {
					table = table.Parent
				}
				if table != nil {
					tables[table] = struct{}{}
				}
				break
			}
		}
		return ast.WalkContinue
	})
	// 使用独立占位节点让其他导出内容继续经过原有格式化流程。
	replacements := map[string]*ast.Node{}
	for table := range tables {
		marker := "table-cell-preview-" + ast.NewNodeID()
		replacements[marker] = table
		placeholder := &ast.Node{Type: ast.NodeParagraph}
		placeholder.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(marker)})
		table.InsertBefore(placeholder)
		table.Unlink()
	}
	md := treenode.FormatNode(tree.Root, luteEngine)
	ret := parse.Parse("", []byte(md), luteEngine.ParseOptions)
	var placeholders []*ast.Node
	ast.Walk(ret.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeParagraph && replacements[node.Text()] != nil {
			placeholders = append(placeholders, node)
		}
		return ast.WalkContinue
	})
	for _, placeholder := range placeholders {
		placeholder.InsertBefore(replacements[placeholder.Text()])
		placeholder.Unlink()
	}
	return ret
}
