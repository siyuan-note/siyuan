// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

// indexHeadingParents 仅用于本次投影，不跨请求保留可变文档或父级信息。
type indexHeadingParents struct {
	parents map[*ast.Node]*ast.Node
	indexed map[*ast.Node]bool
}

func (index *indexHeadingParents) get(node *ast.Node) *ast.Node {
	parent := node.Parent
	if parent == nil {
		return nil
	}
	if index.parents == nil {
		index.parents = map[*ast.Node]*ast.Node{}
		index.indexed = map[*ast.Node]bool{}
	}
	if !index.indexed[parent] {
		var headings []*ast.Node
		for current := parent.FirstChild; current != nil; current = current.Next {
			level := 16
			if current.Type == ast.NodeHeading {
				level = current.HeadingLevel
				for len(headings) > 0 && headings[len(headings)-1].HeadingLevel >= level {
					headings = headings[:len(headings)-1]
				}
			}
			semanticParent := parent
			for i := len(headings) - 1; i >= 0; i-- {
				if headings[i].HeadingLevel < level {
					semanticParent = headings[i]
					break
				}
			}
			index.parents[current] = semanticParent
			if current.Type == ast.NodeHeading {
				headings = append(headings, current)
			}
		}
		index.indexed[parent] = true
	}
	if semanticParent, found := index.parents[node]; found {
		return semanticParent
	}
	return parent
}

type indexBlockBuilder func(*ast.Node, *parse.Tree) (*Block, []*Attribute)

func fromTreeWithChanges(node *ast.Node, tree *parse.Tree, changes *TreeIndexChanges) ([]*Block, []*Span, []*Asset, []*Attribute) {
	parents := &indexHeadingParents{}
	return projectTree(node, tree, func(current *ast.Node, source *parse.Tree) (*Block, []*Attribute) {
		if changes != nil && !changes.blockIDs[current.ID] {
			return nil, buildNodeAttributes(current, source)
		}
		return buildBlockFromNodeWithHeadingParent(current, source, parents.get(current))
	})
}
