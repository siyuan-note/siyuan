// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/88250/lute/ast"
)

func TestTabItemFocusedLoadPreservesContainer(t *testing.T) {
	doc := &ast.Node{Type: ast.NodeDocument}
	tabs := &ast.Node{Type: ast.NodeTabs, ID: "20260906120000-tabs001"}
	doc.AppendChild(tabs)
	first := &ast.Node{Type: ast.NodeTabItem, ID: "20260906120000-item001"}
	second := &ast.Node{Type: ast.NodeTabItem, ID: "20260906120000-item002"}
	tabs.AppendChild(first)
	tabs.AppendChild(second)
	body := &ast.Node{Type: ast.NodeParagraph, ID: "20260906120000-body001"}
	second.AppendChild(body)
	for _, target := range []*ast.Node{first, second} {
		nodes, _ := loadNodesByMode(target, 0, 0, 1024, false, false)
		if len(nodes) != 1 || nodes[0] != tabs || second.FirstChild != body {
			t.Fatalf("tab item preview must retain its container and body: %v", nodes)
		}
	}
	nodes, _ := loadNodesByMode(body, 0, 0, 1024, false, false)
	if len(nodes) != 1 || nodes[0] != body {
		t.Fatal("ordinary block preview must retain its scope")
	}
	inner := &ast.Node{Type: ast.NodeTabs, ID: "20260906120000-tabs002"}
	second.AppendChild(inner)
	item := &ast.Node{Type: ast.NodeTabItem, ID: "20260906120000-item003"}
	inner.AppendChild(item)
	nodes, _ = loadNodesByMode(item, 0, 0, 1024, false, false)
	if len(nodes) != 1 || nodes[0] != inner {
		t.Fatal("nested tab preview must load its immediate container")
	}
}
