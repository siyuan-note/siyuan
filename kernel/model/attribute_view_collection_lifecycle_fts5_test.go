// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockCollectionNotebookValidationPreservesUnrelatedConfig(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	view.Automations.Rules[0].BlockSource.NotebookIDs = []string{fixture.box.ID}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	tx := blockCollectionTags(t, fixture.sourceID, "todo")
	tx.DoOperations = append(tx.DoOperations, &Operation{Action: "update", ID: fixture.childID, Data: fmt.Sprintf(
		`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">Saved edit</div></div>`, fixture.childID)})

	badPath := filepath.Join(util.DataDir, ast.NewNodeID(), ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(badPath), 0755); err != nil {
		t.Fatal(err)
	}
	badConfig := []byte(`{"name":`)
	if err := os.WriteFile(badPath, badConfig, 0600); err != nil {
		t.Fatal(err)
	}

	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(badPath); err != nil || !bytes.Equal(got, badConfig) {
		t.Fatal("edit modified an unrelated notebook configuration", err)
	}
	tree, _, err := filesys.LoadTreeSnapshot(fixture.box.ID, fixture.sourcePath, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	if block := treenode.GetNodeInTree(tree, fixture.childID); block == nil || block.Text() != "Saved edit" {
		t.Fatal("edit did not save")
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.sourceID) == nil {
		t.Fatal("valid rule did not collect the edited document")
	}
}

func TestBlockCollectionNotebookValidationRejectsInvalidSources(t *testing.T) {
	previousDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previousDir })
	for _, scenario := range []struct{ name, config string }{
		{"missing config", ""},
		{"malformed config", `{"name":`},
		{"encrypted config with cached normal identity", `{"encrypted":true}`},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			id := ast.NewNodeID()
			path := filepath.Join(util.DataDir, id, ".siyuan", "conf.json")
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				t.Fatal(err)
			}
			if scenario.config != "" {
				if err := os.WriteFile(path, []byte(scenario.config), 0600); err != nil {
					t.Fatal(err)
				}
			}
			markRuntimeNormalBox(id)
			t.Cleanup(func() { forgetRuntimeNormalBox(id) })
			err := validateBlockCollectionNotebooks([]string{id}, "")
			var unavailable *automationUnavailableReference
			if err == nil || errors.As(err, &unavailable) {
				t.Fatalf("existing invalid scope must be rejected without pausing the rule: %v", err)
			}
		})
	}
}

func TestBlockCollectionNotebookScopeLifecycle(t *testing.T) {
	for _, deleted := range []bool{true, false} {
		t.Run(map[bool]string{true: "deleted", false: "closed"}[deleted], func(t *testing.T) {
			fixture, view, keyID := setupBlockCollectionTest(t)
			setupAutomationNotificationLanguage(t)
			notebook := &Box{ID: ast.NewNodeID()}
			boxConf := notebook.GetConf()
			boxConf.Closed = false
			if err := notebook.SaveConf(boxConf); err != nil {
				t.Fatal(err)
			}
			rule := view.Automations.Rules[0]
			rule.BlockSource.NotebookIDs = []string{notebook.ID}
			rule.BlockSource.DocumentIDs = append(rule.BlockSource.DocumentIDs, fixture.targetID)
			if err := PerformAttributeViewOperations([]*Operation{{Action: "setAttrViewAutomations", AvID: view.ID, Data: view.Automations}}); err != nil {
				t.Fatal(err)
			}
			if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
				t.Fatal(err)
			}
			stored := readAttributeViewItemsTest(t, view.ID)
			row := stored.GetBlockValueByBoundID(fixture.sourceID)
			if row == nil {
				t.Fatal("initial collection failed")
			}
			stored.GetValue(keyID, row.BlockID).Text.Content = "Edited"
			if err := av.SaveAttributeView(stored); err != nil {
				t.Fatal(err)
			}
			if deleted {
				if err := os.Rename(filepath.Join(util.DataDir, notebook.ID), filepath.Join(t.TempDir(), notebook.ID)); err != nil {
					t.Fatal(err)
				}
			} else {
				boxConf.Closed = true
				if err := notebook.SaveConf(boxConf); err != nil {
					t.Fatal(err)
				}
			}
			target, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			blockID := target.Root.FirstChild.ID
			edit := func(content string) *Transaction {
				tx := blockCollectionTags(t, target.ID, "todo")
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "update", ID: blockID, Data: fmt.Sprintf(
					`<div data-node-id="%s" data-type="NodeParagraph" class="p"><div contenteditable="true">%s</div></div>`, blockID, content)})
				return tx
			}
			messages := []string{}
			if deleted {
				failed := edit("Rolled back")
				failure := errors.New("injected tree write failure")
				failed.writeTransactionTree = func(*parse.Tree) error { return failure }
				captureAutomationNotifications(t, failed, &messages)
				if err = PerformTxSync(failed); !errors.Is(err, failure) {
					t.Fatalf("edit did not reach the tree write: %v", err)
				}
				if !readAttributeViewItemsTest(t, view.ID).Automations.Rules[0].Enabled || len(messages) != 0 {
					t.Fatal("failed edit persisted the rule pause or announced collection", messages)
				}
			}
			tx := edit("Saved text")
			captureAutomationNotifications(t, tx, &messages)
			if err = PerformTxSync(tx); err != nil {
				t.Fatal("ordinary edit did not save", err)
			}
			disk, _, err := filesys.LoadTreeSnapshot(target.Box, target.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			if block := treenode.GetNodeInTree(disk, blockID); block == nil || block.Text() != "Saved text" {
				t.Fatal("edited text was not written to disk")
			}
			stored = readAttributeViewItemsTest(t, view.ID)
			current := stored.Automations.Rules[0]
			if current.Enabled == deleted || len(current.BlockSource.NotebookIDs) != 1 || current.BlockSource.NotebookIDs[0] != notebook.ID {
				t.Fatalf("unexpected saved rule: %+v", current)
			}
			if stored.GetValue(keyID, row.BlockID).Text.Content != "Edited" || (stored.GetBlockValueByBoundID(target.ID) != nil) == deleted {
				t.Fatal("existing fields changed or collection did not respect the notebook state")
			}
			wantMessages := 1
			if deleted {
				wantMessages = 0
			}
			if len(messages) != wantMessages {
				t.Fatal("unexpected collection success notifications", messages)
			}
		})
	}
}

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
