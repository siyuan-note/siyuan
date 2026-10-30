// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestCheckBlockRefParagraphDoesNotScaleWithDocument(t *testing.T) {
	f := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, f)
	tree, err := LoadTreeByBlockID(f.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	var targetID string
	allocations := func(size int) float64 {
		t.Helper()
		for range size {
			paragraph := treenode.NewParagraph(ast.NewNodeID())
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("ordinary paragraph")})
			tree.Root.AppendChild(paragraph)
			targetID = paragraph.ID
		}
		if err = indexWriteTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
		return testing.AllocsPerRun(3, func() {
			found, checkErr := CheckBlockRefInBox([]string{targetID}, nil, []string{targetID}, f.box.ID)
			if checkErr != nil || found {
				t.Fatalf("unreferenced paragraph: found=%t err=%v", found, checkErr)
			}
		})
	}
	small := allocations(64)
	large := allocations(4096)
	// Use allocations rather than a wall-clock deadline: unrelated siblings must
	// not be materialized just to check a paragraph that cannot contain blocks.
	if large > small*2+256 {
		t.Fatalf("paragraph check scales with unrelated siblings: small=%.0f large=%.0f allocations", small, large)
	}
}

func TestCheckBlockRefParagraphPreservesWarnings(t *testing.T) {
	f := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, f)
	tree, err := LoadTreeByBlockID(f.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	paragraph := treenode.NewParagraph(ast.NewNodeID())
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("checked paragraph")})
	tree.Root.AppendChild(paragraph)
	database := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID()}
	avID := ast.NewNodeID()
	database.SetIALAttr("av-id", avID)
	tree.Root.AppendChild(database)
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	check := func(ids, deletedIDs []string, want bool) {
		t.Helper()
		found, checkErr := CheckBlockRefInBox(ids, nil, deletedIDs, f.box.ID)
		if checkErr != nil || found != want {
			t.Fatalf("check: found=%t want=%t err=%v", found, want, checkErr)
		}
	}
	check([]string{paragraph.ID}, []string{paragraph.ID}, false)
	refID := ast.NewNodeID()
	if err = sql.Exec("INSERT INTO refs (id, def_block_id, block_id, root_id) VALUES (?, ?, ?, ?)",
		refID, paragraph.ID, database.ID, tree.ID); err != nil {
		t.Fatal(err)
	}
	check([]string{paragraph.ID}, []string{paragraph.ID}, true)
	check([]string{paragraph.ID, database.ID}, []string{paragraph.ID, database.ID}, false)
	if err = sql.Exec("DELETE FROM refs WHERE id = ?", refID); err != nil {
		t.Fatal(err)
	}
	paragraph.SetIALAttr(av.NodeAttrNameAvs, avID)
	av.UpsertBlockRel(avID, database.ID)
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	// The check itself must flush this pending binding update.
	check([]string{paragraph.ID}, []string{paragraph.ID}, true)
	check([]string{paragraph.ID}, nil, false)
	check([]string{paragraph.ID, database.ID}, []string{paragraph.ID, database.ID}, false)
}

func TestCheckBlockRefContainerIncludesDescendants(t *testing.T) {
	f := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, f)
	tree, err := LoadTreeByBlockID(f.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	container := &ast.Node{Type: ast.NodeBlockquote, ID: ast.NewNodeID()}
	paragraph := treenode.NewParagraph(ast.NewNodeID())
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("nested paragraph")})
	container.AppendChild(paragraph)
	tree.Root.AppendChild(container)
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	if err = sql.Exec("INSERT INTO refs (id, def_block_id, block_id, root_id) VALUES (?, ?, ?, ?)",
		ast.NewNodeID(), paragraph.ID, f.targetID, f.targetID); err != nil {
		t.Fatal(err)
	}
	for _, exact := range []bool{false, true} {
		var exactIDs []string
		if exact {
			exactIDs = []string{container.ID}
		}
		found, checkErr := CheckBlockRefInBox([]string{container.ID}, exactIDs, []string{container.ID}, f.box.ID)
		if checkErr != nil || found == exact {
			t.Fatalf("container exact=%t: found=%t err=%v", exact, found, checkErr)
		}
	}
}
