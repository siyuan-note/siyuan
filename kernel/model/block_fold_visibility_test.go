// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockFoldVisibilityFromDocument(t *testing.T) {
	fixture := setupFileOperationTest(t)
	tree := addFileOperationTestDoc(t, fixture, "20261112000001-fold001", "Fold visibility", false)
	list := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeList, ListData: &ast.ListData{}}
	item := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeListItem, ListData: &ast.ListData{}}
	first := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeParagraph}
	second := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeParagraph}
	tree.Root.AppendChild(list)
	list.AppendChild(item)
	item.AppendChild(first)
	item.AppendChild(second)
	treenode.SetSelfFolded(item, true)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	normalized, _, err := filesys.LoadTreeWithFix(tree.Box, tree.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = filesys.WriteTree(normalized); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	cache.RemoveTreeData(tree.ID)
	for _, test := range []struct {
		id                   string
		folded, root, hidden bool
	}{
		{tree.ID, false, true, false},
		{item.ID, true, false, false},
		{first.ID, true, false, false},
		{second.ID, true, false, true},
		{ast.NewNodeID(), false, false, false},
	} {
		folded, root, hidden := IsBlockFolded(test.id)
		if folded != test.folded || root != test.root || hidden != test.hidden {
			t.Errorf("%s: got %v/%v/%v, want %v/%v/%v", test.id, folded, root, hidden, test.folded, test.root, test.hidden)
		}
	}
}
