// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && sqlcipher

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupHistoryRecoveryTest(t *testing.T, encrypted bool, layout av.LayoutType) (fixture *fileOperationTestFixture, view *av.AttributeView, boxID, live, historical string, corrupt []byte) {
	t.Helper()
	fixture, view, _, _ = setupAttributeViewItemsTest(t, false)
	oldWorkspace, oldQueue, oldConf := util.WorkspaceDir, util.QueueDir, util.ConfDir
	util.WorkspaceDir, util.QueueDir, util.ConfDir = filepath.Dir(util.HistoryDir), t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.WorkspaceDir, util.QueueDir, util.ConfDir = oldWorkspace, oldQueue, oldConf })
	if encrypted {
		boxID = fixture.box.ID
		var trees []*parse.Tree
		for _, id := range []string{fixture.sourceID, fixture.targetID} {
			tree, err := LoadTreeByBlockID(id)
			if err != nil {
				t.Fatal(err)
			}
			trees = append(trees, tree)
			treenode.RemoveBlockTreesByRootID(boxID, id)
		}
		dek := bytes.Repeat([]byte{0x74}, 32)
		prepareUnlockedEncryptedBoxTest(t, boxID, dek)
		encryptDocumentTestSources(t, dek, trees...)
		boxConf := conf.NewBoxConf()
		boxConf.Encrypted, boxConf.BoxCrypt = true, &conf.BoxEncryption{Spec: boxEncryptionSpec}
		if err := encryptBoxMetadata(boxID, boxConf, dek); err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(boxConf)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), data, 0600); err != nil {
			t.Fatal(err)
		}
		mountedEncryptedBoxes.Store(boxID, true)
		if err = treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
			t.Fatal(err)
		}
		if err = sql.OpenEncryptedDB(boxID, dek); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			sql.CloseEncryptedDB(boxID)
			treenode.CloseEncryptedBlockTreeDB(boxID)
			mountedEncryptedBoxes.Delete(boxID)
		})
		for _, tree := range trees {
			treenode.UpsertBlockTree(tree)
		}
	}
	av.SetAVBoxID(view.ID, boxID)
	t.Cleanup(func() { av.SetAVBoxID(view.ID, "") })
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if encrypted {
		if err := os.Remove(boundAttributeViewHistoryPath(util.DataDir, "", view.ID)); err != nil {
			t.Fatal(err)
		}
	}
	live = boundAttributeViewHistoryPath(util.DataDir, boxID, view.ID)
	historical = boundAttributeViewHistoryPath(filepath.Join(util.HistoryDir, "2026-11-02-120000-update"), boxID, view.ID)
	data, err := os.ReadFile(live)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(historical), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(historical, data, 0600); err != nil {
		t.Fatal(err)
	}
	current, err := cloneAttributeViewForFieldMutation(view)
	if err != nil {
		t.Fatal(err)
	}
	current.Views[0].LayoutType = layout
	current.Views[0].Calendar, current.Views[0].List = nil, nil
	corrupt, err = json.Marshal(current)
	if err != nil {
		t.Fatal(err)
	}
	if encrypted {
		corrupt, err = av.EncryptAVData(boxID, view.ID, corrupt)
		if err != nil {
			t.Fatal(err)
		}
	}
	if err = os.WriteFile(live, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	return
}

func requireHistoryRecoveryBytes(t *testing.T, filename string, expected []byte) {
	t.Helper()
	actual, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(actual, expected) {
		t.Fatalf("source differs at %s: %v", filename, err)
	}
}

func TestHistoryRecoveryDocumentMissingLayout(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		for _, invalidHistory := range []bool{false, true} {
			t.Run(map[bool]string{false: "plain/", true: "encrypted/"}[encrypted]+map[bool]string{false: "success", true: "invalid second database"}[invalidHistory], func(t *testing.T) {
				fixture, view, boxID, live, historical, corrupt := setupHistoryRecoveryTest(t, encrypted, av.LayoutTypeCalendar)
				tree, err := LoadTreeByBlockID(fixture.sourceID)
				if err != nil {
					t.Fatal(err)
				}
				node := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: view.ID}
				node.SetIALAttr("id", node.ID)
				tree.Root.AppendChild(node)
				if invalidHistory {
					second := av.NewAttributeView(ast.NewNodeID())
					secondPath := filepath.Join(filepath.Dir(historical), second.ID+".json")
					if err = os.WriteFile(secondPath, []byte("invalid history"), 0600); err != nil {
						t.Fatal(err)
					}
					node := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: second.ID}
					node.SetIALAttr("id", node.ID)
					tree.Root.AppendChild(node)
				}
				tree.Root.SetIALAttr("title", "Historical document")
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				docPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
				snapshot, err := os.ReadFile(docPath)
				if err != nil {
					t.Fatal(err)
				}
				historyDoc := filepath.Join(util.HistoryDir, "2026-11-02-120000-update", tree.Box, tree.ID+".sy")
				if err = os.MkdirAll(filepath.Dir(historyDoc), 0700); err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(historyDoc, snapshot, 0600); err != nil {
					t.Fatal(err)
				}
				tree.Root.SetIALAttr("title", "Current document")
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				currentDoc, _ := os.ReadFile(docPath)
				relative, _ := filepath.Rel(util.WorkspaceDir, historyDoc)
				err = RollbackDocHistory(relative)
				if invalidHistory {
					if err == nil {
						t.Fatal("invalid second history accepted")
					}
					requireHistoryRecoveryBytes(t, live, corrupt)
					requireHistoryRecoveryBytes(t, docPath, currentDoc)
				} else {
					if err != nil {
						t.Fatal(err)
					}
					restored, readErr := av.ParseAttributeViewForIndexInBox(view.ID, boxID)
					if readErr != nil {
						t.Fatal(readErr)
					}
					assertAttributeViewFieldsTest(t, view, restored)
					restoredTree, readErr := LoadTreeByBlockID(tree.ID)
					if readErr != nil || restoredTree.Root.IALAttr("title") != "Historical document" {
						t.Fatalf("document was not restored: %v", readErr)
					}
				}
				requireHistoryRecoveryBytes(t, historyDoc, snapshot)
			})
		}
	}
}

func TestHistoryRecoveryMissingLayout(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		for _, layout := range []av.LayoutType{av.LayoutTypeCalendar, av.LayoutTypeList} {
			t.Run(map[bool]string{false: "plain/", true: "encrypted/"}[encrypted]+string(layout), func(t *testing.T) {
				_, view, boxID, live, historical, corrupt := setupHistoryRecoveryTest(t, encrypted, layout)
				snapshot, _ := os.ReadFile(historical)
				relative, _ := filepath.Rel(util.WorkspaceDir, historical)
				if err := RollbackAttributeViewHistory(relative); err != nil {
					t.Fatal(err)
				}
				cache.ClearAVCache()
				restored, err := av.ParseAttributeViewForIndexInBox(view.ID, boxID)
				if err != nil {
					t.Fatal(err)
				}
				assertAttributeViewFieldsTest(t, view, restored)
				requireHistoryRecoveryBytes(t, historical, snapshot)
				backups, err := filepath.Glob(filepath.Join(util.ConfDir, "document-source-recovery", "*", "record.json"))
				if err != nil || len(backups) != 1 {
					t.Fatalf("missing original backup: %v %v", backups, err)
				}
				data, _ := os.ReadFile(backups[0])
				backup, err := parseDocumentSourceJournal(data, filepath.Base(filepath.Dir(backups[0]))+".json")
				if err != nil || len(backup.Files) != 1 || !bytes.Equal(backup.Files[0].Before, corrupt) {
					t.Fatalf("original backup differs: %v", err)
				}
				actual, _ := os.ReadFile(live)
				if util.IsCiphertext(actual) != encrypted {
					t.Fatal("encryption boundary changed")
				}
				pending, err := readDocumentSourceJournals()
				if err != nil || len(pending) != 0 {
					t.Fatalf("unfinished recovery: %v %v", pending, err)
				}
			})
		}
	}
}

func TestHistoryRecoveryFailureAndRestart(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		for _, scenario := range []string{"failure", "restart", "conflict"} {
			t.Run(map[bool]string{false: "plain/", true: "encrypted/"}[encrypted]+scenario, func(t *testing.T) {
				_, view, boxID, live, historical, corrupt := setupHistoryRecoveryTest(t, encrypted, av.LayoutTypeCalendar)
				tx := &Transaction{trees: map[string]*parse.Tree{}, historyRecovery: newAttributeViewHistoryRecovery()}
				if err := tx.restoreEmbeddedAttributeViewHistory(historical, boxID, view.ID); err != nil {
					t.Fatal(err)
				}
				if scenario == "conflict" {
					changed := append(bytes.Clone(corrupt), '\n')
					if err := os.WriteFile(live, changed, 0600); err != nil {
						t.Fatal(err)
					}
					result := errors.New("later document failure")
					tx.finishHistoryRecovery(&result)
					if !errors.Is(result, util.ErrFileChanged) {
						t.Fatalf("conflict not reported: %v", result)
					}
					requireHistoryRecoveryBytes(t, live, changed)
					return
				}
				if scenario == "restart" {
					for _, release := range tx.historyRecovery.releases {
						release()
					}
					if err := recoverDocumentSources(); err != nil {
						t.Fatal(err)
					}
					tx.historyRecovery.written = false
				}
				result := errors.New("later document failure")
				tx.finishHistoryRecovery(&result)
				requireHistoryRecoveryBytes(t, live, corrupt)
				if result.Error() != "later document failure" {
					t.Fatalf("unexpected compensation error: %v", result)
				}
			})
		}
	}
}

func TestHistoryRecoveryRejectsOtherCorruption(t *testing.T) {
	for _, scenario := range []string{"current version", "current JSON", "history layout", "authentication"} {
		t.Run(scenario, func(t *testing.T) {
			encrypted := scenario == "authentication"
			_, view, _, live, historical, corrupt := setupHistoryRecoveryTest(t, encrypted, av.LayoutTypeCalendar)
			switch scenario {
			case "current version":
				view.Spec = av.CurrentSpec + 1
				corrupt, _ = json.Marshal(view)
			case "current JSON":
				corrupt = []byte("invalid JSON")
			case "history layout":
				if err := os.WriteFile(historical, corrupt, 0600); err != nil {
					t.Fatal(err)
				}
			case "authentication":
				corrupt[len(corrupt)-1] ^= 1
			}
			if err := os.WriteFile(live, corrupt, 0600); err != nil {
				t.Fatal(err)
			}
			snapshot, _ := os.ReadFile(historical)
			relative, _ := filepath.Rel(util.WorkspaceDir, historical)
			if err := RollbackAttributeViewHistory(relative); err == nil {
				t.Fatal("invalid recovery accepted")
			}
			requireHistoryRecoveryBytes(t, live, corrupt)
			requireHistoryRecoveryBytes(t, historical, snapshot)
			if strings.Contains(scenario, "current") {
				backups, _ := filepath.Glob(filepath.Join(util.ConfDir, "document-source-recovery", "*"))
				if len(backups) > 0 {
					t.Fatal("unsupported source entered recovery")
				}
			}
		})
	}
}
