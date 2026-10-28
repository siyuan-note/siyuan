// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentCollectionImportsRequireExplicitBackfill(t *testing.T) {
	for _, sy := range []bool{false, true} {
		t.Run(map[bool]string{false: "markdown", true: "sy"}[sy], func(t *testing.T) {
			fixture, view, keyID := setupBlockCollectionTest(t)
			rule := view.Automations.Rules[0]
			rule.BlockSource.DocumentIDs = nil
			rule.BlockSource.NotebookIDs = []string{fixture.box.ID}
			rule.BlockSource.Types = []string{"p"}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			if sy {
				id := ast.NewNodeID()
				tree := treenode.NewTree(fixture.box.ID, "/"+id+".sy", "/Imported", "Imported")
				tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "todo"})
				var archive bytes.Buffer
				writer := zip.NewWriter(&archive)
				entry, err := writer.Create("Imported/" + id + ".sy")
				if err != nil {
					t.Fatal(err)
				}
				if _, err = entry.Write(treeToSYJSON(tree)); err != nil {
					t.Fatal(err)
				}
				if err = writer.Close(); err != nil {
					t.Fatal(err)
				}
				filename := filepath.Join(t.TempDir(), "Imported.sy.zip")
				if err = os.WriteFile(filename, archive.Bytes(), 0600); err != nil {
					t.Fatal(err)
				}
				if err = ImportSY(filename, fixture.box.ID, "/"); err != nil {
					t.Fatal(err)
				}
			} else {
				filename := filepath.Join(t.TempDir(), "Imported.md")
				if err := os.WriteFile(filename, []byte("Imported #todo#"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := ImportFromLocalPath(fixture.box.ID, filename, "/"); err != nil {
					t.Fatal(err)
				}
			}
			preview, err := PreviewAttributeViewCollection(view.ID, rule.ID, 1)
			if err != nil || len(preview.Blocks) != 1 || preview.Blocks[0].Collected {
				t.Fatalf("imported matching block missing from preview: %+v, %v", preview, err)
			}
			if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 0 {
				t.Fatal("import or preview executed collection")
			}
			id := preview.Blocks[0].ID
			op := &Operation{Action: "collectAttrViewBlocks", AvID: view.ID, Data: map[string]any{"ruleID": rule.ID, "blockIDs": []string{id}}}
			if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{op}}); err != nil {
				t.Fatal(err)
			}
			stored := readAttributeViewItemsTest(t, view.ID)
			row := stored.GetBlockValueByBoundID(id)
			if row == nil || stored.GetValue(keyID, row.BlockID).Text.Content != "New" {
				t.Fatal("explicit collection did not initialize the imported block")
			}
		})
	}
}

func TestDocumentCollectionRecoveryAndReplayDoNotTrigger(t *testing.T) {
	for _, origin := range []string{"repository-conflict", "history", "replay"} {
		t.Run(origin, func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			rule := view.Automations.Rules[0]
			rule.BlockSource.DocumentIDs = nil
			rule.BlockSource.NotebookIDs = []string{fixture.box.ID}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			id := fixture.sourceID
			switch origin {
			case "repository-conflict":
				id = ast.NewNodeID()
				tree := treenode.NewTree(fixture.box.ID, "/"+id+".sy", "/Recovered", "Recovered")
				tree.Root.SetIALAttr("tags", "todo")
				createTreeTx(tree)
				FlushTxQueue()
			case "history":
				tree, err := LoadTreeByBlockID(id)
				if err != nil {
					t.Fatal(err)
				}
				tree.Root.SetIALAttr("tags", "todo")
				oldWorkspace := util.WorkspaceDir
				util.WorkspaceDir = filepath.Dir(util.HistoryDir)
				t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
				filename := filepath.Join(util.HistoryDir, "2026-10-26-100000-update", tree.Box, id+".sy")
				if err = os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filename, treeToSYJSON(tree), 0600); err != nil {
					t.Fatal(err)
				}
				relative, err := filepath.Rel(util.WorkspaceDir, filename)
				if err != nil {
					t.Fatal(err)
				}
				if err = RollbackDocHistory(relative); err != nil {
					t.Fatal(err)
				}
			case "replay":
				tx := blockCollectionTags(t, id, "todo")
				tx.isReplay = true
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
			}
			tree, err := LoadTreeByBlockID(id)
			if err != nil || !collectionMatches(rule.BlockSource, tree)[id] {
				t.Fatalf("recovered content does not match the active rule: %v", err)
			}
			if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 0 {
				t.Fatal("recovery or replay executed a new collection")
			}
		})
	}
}
