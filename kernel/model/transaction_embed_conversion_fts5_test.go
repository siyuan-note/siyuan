// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEmbedConversionFoldedHeadingOrderAndReplay(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	lute := util.NewLute()
	embed := lute.BlockDOM2Tree(lute.Md2BlockDOM("{{select * from blocks}}", false)).Root.FirstChild
	outside := treenode.NewParagraph(ast.NewNodeID())
	outside.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("existing following content")})
	writeFoldMoveTestTree(t, fixture.sourceID, embed, outside)
	oldDOM := GetBlockDOM(embed.ID)
	heading := newFoldMoveTestHeading(embed.ID, 2)
	child := treenode.NewParagraph(ast.NewNodeID())
	child.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("copied hidden child")})
	second := treenode.NewParagraph(ast.NewNodeID())
	second.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("second copied child")})
	// The frontend inserts in reverse order while the anchor is still an embed.
	// Updating it first would make doInsert0 skip the existing heading children.
	forward := []*Operation{
		{Action: "insert", ID: second.ID, PreviousID: embed.ID, Data: lute.RenderNodeBlockDOM(second)},
		{Action: "insert", ID: child.ID, PreviousID: embed.ID, Data: lute.RenderNodeBlockDOM(child)},
		{Action: "update", ID: embed.ID, Data: lute.RenderNodeBlockDOM(heading)},
	}
	backward := []*Operation{
		{Action: "delete", ID: second.ID},
		{Action: "delete", ID: child.ID},
		{Action: "update", ID: embed.ID, Data: oldDOM},
	}
	for step, operations := range [][]*Operation{forward, backward, forward} {
		tx := &Transaction{DoOperations: cloneOperations(operations)}
		if step > 0 {
			tx.MarkReplay()
		}
		if err := PerformTxSync(tx); err != nil {
			t.Fatalf("step %d: %v", step, err)
		}
		tree, err := LoadTreeByBlockID(fixture.sourceID)
		if err != nil {
			t.Fatal(err)
		}
		// Read the persisted tree as well as the in-memory transaction result.
		tree, err = filesys.LoadTree(tree.Box, tree.Path, lute)
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for node := tree.Root.FirstChild; node != nil; node = node.Next {
			if node.IsBlock() && node.Type != ast.NodeKramdownBlockIAL {
				got = append(got, node.ID)
			}
		}
		want := []string{embed.ID, child.ID, second.ID, outside.ID}
		if step == 1 {
			want = []string{embed.ID, outside.ID}
			if tree.Root.FirstChild.Type != ast.NodeBlockQueryEmbed {
				t.Fatal("undo did not restore the embed")
			}
		} else if tree.Root.FirstChild.Type != ast.NodeHeading || !treenode.IsSelfFolded(tree.Root.FirstChild) {
			t.Fatal("conversion did not preserve the folded heading")
		}
		if !slices.Equal(got, want) {
			t.Fatalf("step %d: got order %v, want %v", step, got, want)
		}
		if node := treenode.GetNodeInTree(tree, outside.ID); node == nil || string(node.FirstChild.Tokens) != "existing following content" {
			t.Fatal("conversion modified existing following content")
		}
	}
}
