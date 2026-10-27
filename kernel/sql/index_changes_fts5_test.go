// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package sql

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTreeIndexChangesMatchCompleteUpdates(t *testing.T) {
	for _, scoped := range []bool{false, true} {
		t.Run(fmt.Sprint(scoped), func(t *testing.T) {
			previousDB, previousDisabled, previousDir := db, cacheDisabled, util.DataDir
			previousCached, previousIgnore := IndexIgnoreCached, indexIgnore
			db, cacheDisabled, util.DataDir = newDeletePathTestDB(t, scoped), true, t.TempDir()
			IndexIgnoreCached, indexIgnore = true, nil
			t.Cleanup(func() {
				db, cacheDisabled, util.DataDir = previousDB, previousDisabled, previousDir
				IndexIgnoreCached, indexIgnore = previousCached, previousIgnore
				ClearCache()
			})
			database := db
			oracle := newDeletePathTestDB(t, scoped)
			tree := newUpsertTestTree(12)
			write := func(target *sql.DB, changes *TreeIndexChanges) error {
				tx, err := target.Begin()
				if err != nil {
					return err
				}
				defer tx.Rollback()
				defer closeTxPreparedStmts(tx)
				if err = upsertTreeWithChanges(tx, tree, nil, changes); err != nil {
					return err
				}
				return commitTx(tx)
			}
			compare := func(changes *TreeIndexChanges) {
				t.Helper()
				if err := write(database, changes); err != nil {
					t.Fatal(err)
				}
				if err := write(oracle, nil); err != nil {
					t.Fatal(err)
				}
				if got, want := upsertTableSnapshots(t, database, false), upsertTableSnapshots(t, oracle, false); !reflect.DeepEqual(got, want) {
					for table := range got {
						if !reflect.DeepEqual(got[table], want[table]) {
							t.Errorf("%s differs: got=%v want=%v", table, got[table], want[table])
						}
					}
					t.FailNow()
				}
				execDeletePathTestSQL(t, database, "INSERT INTO blocks_fts(blocks_fts, rank) VALUES('integrity-check', 1)")
			}
			// 缺少根记录时忽略局部提示，重建全部记录。
			compare(NewTreeIndexChanges([]string{tree.Root.FirstChild.ID}))
			target := tree.Root.FirstChild.Next
			target.FirstChild.Tokens = []byte("changed target text ")
			target.SetIALAttr("updated", "20261019100001")
			tree.Root.SetIALAttr("updated", "20261019100001")
			changes := NewTreeIndexChanges([]string{target.ID})
			tx, _ := database.Begin()
			usable, err := usableTreeIndexChanges(tx, tree, changes)
			tx.Rollback()
			if err != nil || usable == nil {
				t.Fatalf("ordinary edit did not use its change set: %v", err)
			}
			blocks, _, _, _ := fromTreeWithChanges(tree.Root, tree, usable)
			if len(blocks) != 2 {
				t.Fatalf("ordinary edit projected %d blocks, want 2", len(blocks))
			}
			compare(changes)
			// 旧数据库缺失根元数据时保留完整回退，不能使局部提示漏掉其他块。
			execDeletePathTestSQL(t, database, "UPDATE blocks SET hash = NULL WHERE id = ?", tree.ID)
			tx, _ = database.Begin()
			usable, err = usableTreeIndexChanges(tx, tree, changes)
			tx.Rollback()
			if err != nil || usable != nil {
				t.Fatalf("NULL root metadata did not fall back: %v", err)
			}
			compare(changes)
			removed := tree.Root.FirstChild
			removed.Unlink()
			added := treenode.NewParagraph("20261019110000-added01")
			added.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("new child")})
			quote := &ast.Node{Type: ast.NodeBlockquote, ID: "20261019110000-quote01"}
			quote.SetIALAttr("id", quote.ID)
			quote.AppendChild(added)
			tree.Root.AppendChild(quote)
			compare(NewTreeIndexChanges([]string{removed.ID, quote.ID, added.ID}))
			before := upsertTableSnapshots(t, database, true)
			compare(NewTreeIndexChanges([]string{quote.ID, added.ID}))
			if !reflect.DeepEqual(before, upsertTableSnapshots(t, database, true)) {
				t.Fatal("identical change-set replay rewrote stored records")
			}
			// 路径元数据变化时不能沿用局部主块集合。
			tree.Path, tree.HPath = "/changed.sy", "/Changed"
			compare(NewTreeIndexChanges([]string{target.ID}))
			before = upsertTableSnapshots(t, database, true)
			target.SetIALAttr("custom-note", "fail")
			target.FirstChild.Tokens = []byte("text before rollback")
			execDeletePathTestSQL(t, database, "CREATE TRIGGER failure BEFORE INSERT ON attributes WHEN new.value = 'fail' BEGIN SELECT RAISE(ABORT, 'injected index failure'); END")
			if err := write(database, NewTreeIndexChanges([]string{target.ID})); err == nil {
				t.Fatal("injected failure did not roll back")
			}
			if !reflect.DeepEqual(before, upsertTableSnapshots(t, database, true)) {
				t.Fatal("failed scoped write modified the committed snapshot")
			}
		})
	}
}

func TestTreeIndexChangesQueueMergesAndPreservesBoundaries(t *testing.T) {
	prepareIndexQueueTest(t)
	previousQueue, previousData := operationQueue, util.DataDir
	operationQueue, util.DataDir = nil, t.TempDir()
	t.Cleanup(func() { operationQueue, util.DataDir = previousQueue, previousData; clearIndexQueueEntries() })
	tree := newUpsertTestTree(2)
	firstID, secondID := tree.Root.FirstChild.ID, tree.Root.LastChild.ID
	first := NewTreeIndexChanges([]string{firstID})
	UpsertTreeQueueWithChanges(tree, first)
	delete(first.blockIDs, firstID)
	UpsertTreeQueueWithChanges(tree, NewTreeIndexChanges([]string{secondID}))
	if len(operationQueue) != 1 || !operationQueue[0].indexChanges.blockIDs[firstID] || !operationQueue[0].indexChanges.blockIDs[secondID] {
		t.Fatal("coalesced snapshot lost an earlier affected block or retained the caller's mutable set")
	}
	UpsertTreeQueue(tree)
	UpsertTreeQueueWithChanges(tree, NewTreeIndexChanges([]string{firstID}))
	if len(operationQueue) != 1 || operationQueue[0].indexChanges != nil {
		t.Fatal("unknown full update was narrowed by a subsequent hint")
	}
	for _, action := range []string{"delete_id", "move", "rename_doc", "delete_ids", "update_refs"} {
		operationQueue = nil
		UpsertTreeQueueWithChanges(tree, NewTreeIndexChanges([]string{firstID}))
		operationQueue = append(operationQueue, &dbQueueOperation{action: action, removeTreeID: tree.ID, removeTreeBox: tree.Box, indexTree: tree, upsertTree: tree})
		UpsertTreeQueueWithChanges(tree, NewTreeIndexChanges([]string{secondID}))
		if len(operationQueue) != 3 {
			t.Fatalf("%s boundary was removed", action)
		}
	}
	operationQueue = nil
	other := *tree
	other.Box = "other-box"
	UpsertTreeQueueWithChanges(tree, NewTreeIndexChanges([]string{firstID}))
	UpsertTreeQueueWithChanges(&other, NewTreeIndexChanges([]string{secondID}))
	if len(operationQueue) != 2 {
		t.Fatal("documents in different notebooks shared an affected set")
	}
	// 以最终快照执行合并提示，覆盖先删后建和多次编辑。
	operationQueue = nil
	final := *tree
	final.Path = "/new.sy"
	UpsertTreeQueueWithChanges(tree, NewTreeIndexChanges([]string{firstID}))
	UpsertTreeQueueWithChanges(&final, NewTreeIndexChanges([]string{secondID}))
	if len(operationQueue) != 2 {
		t.Fatal("path transition was coalesced")
	}
}

func TestTreeIndexChangesNilAndEmptyRequireCompleteProjection(t *testing.T) {
	if NewTreeIndexChanges(nil) != nil || NewTreeIndexChanges([]string{""}) != nil ||
		mergeTreeIndexChanges(NewTreeIndexChanges([]string{"id"}), nil) != nil {
		t.Fatal("missing information was treated as an empty change")
	}
}

func TestTreeIndexChangesAreNotRecoveredAsPartialHints(t *testing.T) {
	prepareIndexQueueTest(t)
	previousDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previousDir })
	tree := newUpsertTestTree(3)
	if err := os.MkdirAll(filepath.Join(util.DataDir, tree.Box), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	op := &dbQueueOperation{action: "upsert", upsertTree: tree, indexChanges: NewTreeIndexChanges([]string{tree.Root.FirstChild.ID})}
	entry := dbOpToIndexEntry(op)
	recovered, err := indexEntryToOp(*entry, util.NewLute(), "change set recovery test")
	if err != nil || recovered == nil || recovered.indexChanges != nil || recovered.upsertTree.Root.LastChild == nil {
		t.Fatalf("recovery must load a complete source without a partial hint: %+v, %v", recovered, err)
	}
}
