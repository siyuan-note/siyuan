// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
)

// MaterializeTableCellRich makes validated source fragments available to structural
// mutations. The returned function must run before rendering or saving the tree.
// Projection-only edits remain subject to SyncTableCellRichInlineChanges.
func MaterializeTableCellRich(root *ast.Node) (func() error, error) {
	type fragment struct {
		cell       *ast.Node
		tree       *parse.Tree
		before     string
		projection []*ast.Node
	}
	var fragments []*fragment
	var err error
	ast.Walk(root, func(cell *ast.Node, entering bool) ast.WalkStatus {
		if !entering || cell.TableCellRich == nil {
			return ast.WalkContinue
		}
		var tree *parse.Tree
		if tree, err = av.ParseTableCellRich(cell.TableCellRich); err != nil {
			return ast.WalkStop
		}
		before, renderErr := av.RenderTableCellRich(tree)
		if renderErr != nil {
			err = renderErr
			return ast.WalkStop
		}
		fragments = append(fragments, &fragment{cell: cell, tree: tree, before: before})
		return ast.WalkSkipChildren
	})
	if err != nil {
		return nil, err
	}
	for _, f := range fragments {
		for f.cell.FirstChild != nil {
			child := f.cell.FirstChild
			f.projection = append(f.projection, child)
			child.Unlink()
		}
		for f.tree.Root.FirstChild != nil {
			f.cell.AppendChild(f.tree.Root.FirstChild)
		}
	}
	finished := false
	var finishErr error
	return func() error {
		if finished {
			return finishErr
		}
		finished = true
		updates := map[*ast.Node]string{}
		for _, f := range fragments {
			for f.cell.FirstChild != nil {
				f.tree.Root.AppendChild(f.cell.FirstChild)
			}
			content, err := av.RenderTableCellRich(f.tree)
			if err != nil {
				finishErr = err
			} else if content != f.before {
				updates[f.cell] = content
			}
			for _, child := range f.projection {
				f.cell.AppendChild(child)
			}
		}
		// Validate every fragment before changing any source. Preserve original bytes on no-op.
		if finishErr != nil {
			return finishErr
		}
		for cell, content := range updates {
			rich := *cell.TableCellRich
			rich.Content = content
			cell.TableCellRich = &rich
			if err := RefreshTableCellRichProjection(cell); err != nil {
				return err
			}
		}
		return nil
	}, nil
}
