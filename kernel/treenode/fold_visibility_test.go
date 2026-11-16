// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"testing"

	"github.com/88250/lute/ast"
)

func TestIsHiddenByFoldContainers(t *testing.T) {
	for _, typ := range []ast.NodeType{ast.NodeListItem, ast.NodeBlockquote, ast.NodeCallout, ast.NodeTabs, ast.NodeSuperBlock, ast.NodeList} {
		t.Run(typ.String(), func(t *testing.T) {
			root := &ast.Node{Type: ast.NodeDocument}
			parent := &ast.Node{Type: typ}
			first := &ast.Node{Type: ast.NodeParagraph}
			second := &ast.Node{Type: ast.NodeParagraph}
			root.AppendChild(parent)
			parent.AppendChild(&ast.Node{Type: ast.NodeKramdownBlockIAL})
			parent.AppendChild(&ast.Node{Type: ast.NodeTaskListItemMarker})
			parent.AppendChild(first)
			parent.AppendChild(second)
			SetSelfFolded(parent, true)
			if IsHiddenByFold(parent) {
				t.Fatal("folded container itself must remain visible")
			}
			wantFirstHidden := typ != ast.NodeListItem && typ != ast.NodeBlockquote
			if IsHiddenByFold(first) != wantFirstHidden || !IsHiddenByFold(second) {
				t.Fatal("incorrect first or subsequent child visibility")
			}
			SetSelfFolded(parent, false)
			if IsHiddenByFold(first) || IsHiddenByFold(second) {
				t.Fatal("unfolded content must be visible")
			}
		})
	}
}

func TestIsHiddenByFoldAncestors(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	outer := &ast.Node{Type: ast.NodeListItem}
	first := &ast.Node{Type: ast.NodeParagraph}
	list := &ast.Node{Type: ast.NodeList}
	inner := &ast.Node{Type: ast.NodeListItem}
	target := &ast.Node{Type: ast.NodeParagraph}
	root.AppendChild(outer)
	outer.AppendChild(first)
	outer.AppendChild(list)
	list.AppendChild(inner)
	inner.AppendChild(target)
	SetSelfFolded(inner, true)
	if IsHiddenByFold(target) {
		t.Fatal("inner list item first paragraph is visible")
	}
	SetSelfFolded(outer, true)
	if !IsHiddenByFold(target) || IsHiddenByFold(first) {
		t.Fatal("a visible first paragraph does not bypass a hidden outer branch")
	}
	outer.SetIALAttr("heading-fold", "1")
	if IsHiddenByFold(target) {
		t.Fatal("legacy derived fold must not hide the container")
	}
}

func TestIsHiddenByFoldHeadings(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	h1 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1}
	h2 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2}
	container := &ast.Node{Type: ast.NodeListItem}
	target := &ast.Node{Type: ast.NodeParagraph}
	next := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1}
	root.AppendChild(h1)
	root.AppendChild(h2)
	root.AppendChild(container)
	container.AppendChild(target)
	root.AppendChild(next)
	SetSelfFolded(h1, true)
	SetSelfFolded(h2, true)
	SetSelfFolded(container, true)
	if IsHiddenByFold(h1) || IsHiddenByFold(next) || !IsHiddenByFold(h2) || !IsHiddenByFold(target) {
		t.Fatal("incorrect nested heading scope")
	}
	SetSelfFolded(h1, false)
	if IsHiddenByFold(h2) || !IsHiddenByFold(target) {
		t.Fatal("nested heading keeps its own folded content")
	}
	SetSelfFolded(h2, false)
	if IsHiddenByFold(target) || IsHiddenByFold(nil) || IsHiddenByFold(root) {
		t.Fatal("visible targets must remain in the document")
	}
}
