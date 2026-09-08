package model

import (
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// normalizeExportPreviewTree 保留包含块级内容的单元格，避免 Markdown 往返将其拆到表格外。
func normalizeExportPreviewTree(tree *parse.Tree, luteEngine *lute.Lute) *parse.Tree {
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
