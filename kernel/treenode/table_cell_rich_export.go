package treenode

import (
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
)

// MaterializeTableCellRichExport 仅在导出副本中展开片段，让资源、引用和样式转换覆盖内部内容。
func MaterializeTableCellRichExport(root *ast.Node) (err error) {
	fragments := map[*ast.Node]*parse.Tree{}
	var tables []*ast.Node
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTable == node.Type {
			tables = append(tables, node)
		}
		if !entering || nil == node.TableCellRich {
			return ast.WalkContinue
		}
		var fragment *parse.Tree
		if fragment, err = av.ParseTableCellRich(node.TableCellRich); nil != err {
			return ast.WalkStop
		}
		fragments[node] = fragment
		return ast.WalkSkipChildren
	})
	if nil != err {
		return
	}
	for _, table := range tables {
		table.RemoveIALAttr(TableCellRichTableAttribute)
	}
	for cell, fragment := range fragments {
		var unlinks []*ast.Node
		ast.Walk(fragment.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering {
				node.ID = ""
				node.RemoveIALAttr("id")
				node.RemoveIALAttr("updated")
				if ast.NodeKramdownBlockIAL == node.Type {
					unlinks = append(unlinks, node)
				}
			}
			return ast.WalkContinue
		})
		for _, node := range unlinks {
			node.Unlink()
		}
		for nil != cell.FirstChild {
			cell.FirstChild.Unlink()
		}
		for nil != fragment.Root.FirstChild {
			cell.AppendChild(fragment.Root.FirstChild)
		}
		cell.TableCellRich = nil
	}
	return
}
