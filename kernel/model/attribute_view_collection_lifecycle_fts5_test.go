// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockCollectionDatabaseDeletionAndUndo(t *testing.T) {
	for _, cold := range []bool{false, true} {
		t.Run(map[bool]string{false: "cached", true: "reloaded"}[cold], func(t *testing.T) {
			fixture, view, keyID := setupBlockCollectionTest(t)
			setupAutomationNotificationLanguage(t)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			node := tree.Root.LastChild
			undo := &Operation{Action: "insert", ID: node.ID, PreviousID: node.Previous.ID, Data: GetBlockDOM(node.ID)}
			if err = PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
				t.Fatal(err)
			}
			before := readAttributeViewItemsTest(t, view.ID)
			row := before.GetBlockValueByBoundID(fixture.sourceID)
			if row == nil {
				t.Fatal("initial collection failed")
			}
			before.GetValue(keyID, row.BlockID).Text.Content = "Edited"
			if err = av.SaveAttributeView(before); err != nil {
				t.Fatal(err)
			}
			if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "delete", ID: node.ID}}, UndoOperations: []*Operation{undo}}); err != nil {
				t.Fatal(err)
			}
			if cold {
				cache.ClearAVCache()
			}
			messages := []string{}
			tx := blockCollectionTags(t, fixture.sourceID, "todo,other")
			captureAutomationNotifications(t, tx, &messages)
			if err = PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			tree, err = LoadTreeByBlockID(fixture.sourceID)
			if err != nil || tree.Root.IALAttr(av.NodeAttrNameAvs) != "" || len(messages) != 0 {
				t.Fatal("deleted database restored bindings or announced collection", err, messages)
			}
			stored := readAttributeViewItemsTest(t, view.ID)
			if !stored.Automations.Rules[0].Enabled || stored.GetValue(keyID, row.BlockID).Text.Content != "Edited" {
				t.Fatal("deletion changed the rule or stored field")
			}
			stored.Automations.Rules[0].BlockSource.DocumentIDs = append(stored.Automations.Rules[0].BlockSource.DocumentIDs, fixture.targetID)
			if err = av.SaveAttributeView(stored); err != nil {
				t.Fatal(err)
			}
			if err = PerformTxSync(blockCollectionTags(t, fixture.targetID, "todo")); err != nil {
				t.Fatal(err)
			}
			if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.targetID) != nil {
				t.Fatal("deleted database collected a new item")
			}
			if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: []*Operation{undo}}); err != nil {
				t.Fatal(err)
			}
			if err = PerformTxSync(blockCollectionTags(t, fixture.targetID, "")); err != nil {
				t.Fatal(err)
			}
			if err = PerformTxSync(blockCollectionTags(t, fixture.targetID, "todo")); err != nil {
				t.Fatal(err)
			}
			if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.targetID) == nil {
				t.Fatal("undo did not resume collection")
			}
		})
	}
}

func TestBlockCollectionDatabaseFinalTransactionState(t *testing.T) {
	for _, mirror := range []bool{false, true} {
		t.Run(map[bool]string{false: "last-block", true: "remaining-mirror"}[mirror], func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			setupAutomationNotificationLanguage(t)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			id := tree.Root.LastChild.ID
			if mirror {
				addCollectionDatabaseBlock(t, view, fixture.targetID)
			}
			tx := blockCollectionTags(t, fixture.sourceID, "todo")
			tx.DoOperations = append(tx.DoOperations, &Operation{Action: "delete", ID: id})
			messages := []string{}
			captureAutomationNotifications(t, tx, &messages)
			if err = PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			stored := readAttributeViewItemsTest(t, view.ID)
			if (stored.GetBlockValueByBoundID(fixture.sourceID) != nil) != mirror || (len(messages) > 0) != mirror {
				t.Fatal("collection ignored final database block state", messages)
			}
		})
	}
}

func TestBlockCollectionDeletedDatabaseDocument(t *testing.T) {
	for _, parent := range []bool{false, true} {
		t.Run(map[bool]string{false: "document", true: "parent-document"}[parent], func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			view.Automations.Rules[0].BlockSource.DocumentIDs = []string{fixture.targetID}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			if parent {
				child, err := CreateDocByMdSync(fixture.box.ID, fixture.sourcePath[:len(fixture.sourcePath)-3]+"/"+ast.NewNodeID()+".sy", "Child", "Content", nil, nil)
				if err != nil {
					t.Fatal(err)
				}
				tree, err := LoadTreeByBlockID(fixture.sourceID)
				if err != nil {
					t.Fatal(err)
				}
				node := tree.Root.LastChild
				node.Unlink()
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				av.RemoveBlockRel(view.ID, node.ID, treenode.ExistBlockTree)
				addCollectionDatabaseBlock(t, view, child.ID)
			}
			if err := RemoveDoc(fixture.box.ID, fixture.sourcePath); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			if err := PerformTxSync(blockCollectionTags(t, fixture.targetID, "todo")); err != nil {
				t.Fatal(err)
			}
			if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.targetID) != nil {
				t.Fatal("database in deleted document collected a block")
			}
		})
	}
}

func TestBlockCollectionStaleDatabaseBlockAndReadFailure(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(map[bool]string{false: "stale-node", true: "unreadable-document"}[corrupt], func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			view.Automations.Rules[0].BlockSource.DocumentIDs = []string{fixture.targetID}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			if corrupt {
				err = os.WriteFile(filepath.Join(util.DataDir, tree.Box, tree.Path), []byte("invalid JSON"), 0600)
			} else {
				tree.Root.LastChild.AttributeViewID = ast.NewNodeID()
				_, err = filesys.WriteTree(tree)
			}
			if err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			err = PerformTxSync(blockCollectionTags(t, fixture.targetID, "todo"))
			if (err != nil) != corrupt {
				t.Fatal("read failure was hidden or stale mapping was accepted", err)
			}
			if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.targetID) != nil {
				t.Fatal("invalid database carrier collected an item")
			}
		})
	}
}
