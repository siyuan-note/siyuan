// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestTransactionIndexChangesCoverReplacementAndContainers(t *testing.T) {
	const removedID, addedID = "20261019120000-removed", "20261019120000-added01"
	tree := treenode.NewTree("20261019000000-box0001", "/20261019000000-root001.sy", "/Document", "Document")
	before := &ast.Node{ID: "quote", Type: ast.NodeBlockquote}
	before.AppendChild(treenode.NewParagraph(removedID))
	tree.Root.AppendChild(before)
	after := &ast.Node{ID: "quote", Type: ast.NodeBlockquote}
	after.AppendChild(treenode.NewParagraph(addedID))
	tx := &Transaction{DoOperations: []*Operation{{Action: "update"}}}
	tx.captureIndexReplacement(tree, before, after)
	change := tx.indexChanges[tree.ID]
	if tx.treeIndexChanges(tree) == nil || !change.blockIDs[tree.ID] || !change.blockIDs["quote"] ||
		!change.blockIDs[removedID] || !change.blockIDs[addedID] {
		t.Fatalf("replacement lost deleted blocks or container projections: %+v", change)
	}
	tx.DoOperations = append(tx.DoOperations, &Operation{Action: "setAttrs"})
	if tx.treeIndexChanges(tree) != nil {
		t.Fatal("untracked transaction finalization retained a partial hint")
	}
	tx.DoOperations = tx.DoOperations[:1]
	after.AppendChild(&ast.Node{ID: "heading", Type: ast.NodeHeading, HeadingLevel: 1})
	tx.captureIndexReplacement(tree, before, after)
	if tx.treeIndexChanges(tree) != nil {
		t.Fatal("heading structure changes must retain complete projection")
	}
}

func TestTransactionIndexChangesPersistCoalescedUpdatesAndReleaseHints(t *testing.T) {
	for _, withHeading := range []bool{false, true} {
		t.Run(fmt.Sprintf("heading_parent_%t", withHeading), func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			tree, err := LoadTreeByBlockID(fixture.childID)
			if err != nil {
				t.Fatal(err)
			}
			heading := &ast.Node{Type: ast.NodeHeading, ID: "20260801000000-heading", HeadingLevel: 1}
			if withHeading {
				heading.SetIALAttr("id", heading.ID)
				heading.SetIALAttr("updated", "20260801000000")
				heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Parent heading")})
				tree.Root.PrependChild(heading)
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
			}
			sql.UpsertTreeQueue(tree)
			sql.FlushQueue()
			for step := range 3 {
				transaction := &Transaction{DoOperations: []*Operation{{Action: "update", ID: fixture.childID,
					Data: fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">incremental edit %d</div></div>`, fixture.childID, step)}}}
				observed := false
				transaction.writeTransactionTree = func(source *parse.Tree) error {
					change := transaction.indexChanges[source.ID]
					if change == nil || change.full || !change.blockIDs[fixture.childID] || !change.blockIDs[source.ID] || transaction.treeIndexChanges(source) == nil {
						t.Fatalf("ordinary transaction did not collect its complete affected set: %+v", change)
					}
					if withHeading && !change.blockIDs[heading.ID] {
						t.Fatal("heading ancestor timestamp was omitted from the affected set")
					}
					observed = true
					return writeTreeUpsertQueueWithChanges(source, transaction.treeIndexChanges(source))
				}
				if err = PerformTxSync(transaction); err != nil {
					t.Fatal(err)
				}
				if !observed || transaction.indexChanges != nil {
					t.Fatal("transaction did not release its completed hint")
				}
			}
			sql.FlushQueue()
			query := "SELECT id,parent_id,root_id,hash,box,path,hpath,content,markdown,ial FROM blocks ORDER BY id"
			snapshot := func() string {
				t.Helper()
				rows, err := sql.QueryNoLimit(query)
				if err != nil {
					t.Fatal(err)
				}
				data, err := json.Marshal(rows)
				if err != nil {
					t.Fatal(err)
				}
				return string(data)
			}
			before := snapshot()
			tree, err = LoadTreeByBlockID(fixture.childID)
			if err != nil || treenode.GetNodeInTree(tree, fixture.childID).Text() != "incremental edit 2" {
				t.Fatalf("coalesced transaction did not persist the final text: %v", err)
			}
			sql.UpsertTreeQueue(tree)
			sql.FlushQueue()
			if before != snapshot() {
				t.Fatal("transaction-scoped index differs from a complete update")
			}
			failing := &Transaction{DoOperations: []*Operation{{Action: "update", ID: fixture.childID,
				Data: fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">failed edit</div></div>`, fixture.childID)}},
				writeTransactionTree: func(*parse.Tree) error { return errors.New("injected source write failure") }}
			if err = PerformTxSync(failing); err == nil || failing.indexChanges != nil {
				t.Fatal("failed transaction retained its partial hint")
			}
			if snapshot() != before {
				t.Fatal("failed source write changed the committed index")
			}
		})
	}
}
