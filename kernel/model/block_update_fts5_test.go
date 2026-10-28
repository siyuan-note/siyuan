// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestContainerDOMReorderKeepsPersistedContentIdentity(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	quote := &ast.Node{Type: ast.NodeBlockquote, ID: ast.NewNodeID()}
	quote.SetIALAttr("id", quote.ID)
	want := map[string]string{}
	for _, text := range []string{"A", "B"} {
		p := treenode.NewParagraph(ast.NewNodeID())
		p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
		quote.AppendChild(p)
		want[p.ID] = text
	}
	tree.Root.AppendChild(quote)
	if err := indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	engine := util.NewLute()
	domTree := engine.BlockDOM2Tree(GetBlockDOM(quote.ID))
	updated := firstContentBlock(domTree.Root)
	children := blockChildrenOf(updated)
	children[1].Unlink()
	updated.PrependChild(children[1])
	dom := engine.Tree2BlockDOM(domTree, engine.RenderOptions, engine.ParseOptions)
	if _, _, err = PerformBlockUpdates([]BlockUpdateInput{{ID: quote.ID, DataType: "dom", Data: dom}}); err != nil {
		t.Fatal(err)
	}
	actual, err := filesys.LoadTree(tree.Box, tree.Path, engine)
	if err != nil {
		t.Fatal(err)
	}
	for id, text := range want {
		p := treenode.GetNodeInTree(actual, id)
		if p == nil || p.FirstChild == nil || string(p.FirstChild.Tokens) != text {
			t.Fatalf("persisted identity %s no longer contains %s", id, text)
		}
	}
}
