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

func TestHistoryDocumentRelocationFailureRollsBack(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			fixture, historicalAV, _ := setupAttributeViewDeletedBlockTest(t, "container")
			boxID, avBoxID := fixture.box.ID, ""
			if encrypted {
				var trees []*parse.Tree
				for _, id := range []string{fixture.sourceID, fixture.targetID} {
					tree, err := LoadTreeByBlockID(id)
					if err != nil {
						t.Fatal(err)
					}
					trees = append(trees, tree)
					treenode.RemoveBlockTreesByRootID(boxID, id)
				}
				dek := bytes.Repeat([]byte{0x75}, 32)
				prepareUnlockedEncryptedBoxTest(t, boxID, dek)
				encryptDocumentTestSources(t, dek, trees...)
				boxConf := conf.NewBoxConf()
				boxConf.Encrypted = true
				boxConf.BoxCrypt = &conf.BoxEncryption{Spec: boxEncryptionSpec}
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
					av.SetAVBoxID(historicalAV.ID, "")
				})
				for _, tree := range trees {
					treenode.UpsertBlockTree(tree)
				}
				avBoxID = boxID
				av.SetAVBoxID(historicalAV.ID, boxID)
				if err = av.SaveAttributeView(historicalAV); err != nil {
					t.Fatal(err)
				}
				if err = os.Remove(boundAttributeViewHistoryPath(util.DataDir, "", historicalAV.ID)); err != nil {
					t.Fatal(err)
				}
			}
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			originalPath := filepath.Join(util.DataDir, boxID, tree.Path)
			if err = os.Remove(originalPath); err != nil {
				t.Fatal(err)
			}
			// A missing parent index is an existing supported root-level recovery path.
			parentID := ast.NewNodeID()
			parent := treenode.NewTree(boxID, "/"+parentID+".sy", "/Parent", "Parent")
			if _, err = filesys.WriteTree(parent); err != nil {
				t.Fatal(err)
			}
			treenode.RemoveBlockTreesByRootID(boxID, parentID)
			tree.Path = "/" + parentID + "/" + tree.ID + ".sy"
			node := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: historicalAV.ID}
			node.SetIALAttr("id", node.ID)
			tree.Root.AppendChild(node)
			cache.RemoveTreeDataInBox(tree.ID, boxID)
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			oldPath := filepath.Join(util.DataDir, boxID, tree.Path)
			snapshot, err := os.ReadFile(oldPath)
			if err != nil {
				t.Fatal(err)
			}
			originalWorkspace := util.WorkspaceDir
			util.WorkspaceDir = filepath.Dir(util.HistoryDir)
			t.Cleanup(func() { util.WorkspaceDir = originalWorkspace })
			historyRoot := filepath.Join(util.HistoryDir, "2026-10-26-120000-update")
			historyPath := filepath.Join(historyRoot, boxID, tree.ID+".sy")
			for filename, source := range map[string]string{historyPath: oldPath, boundAttributeViewHistoryPath(historyRoot, avBoxID, historicalAV.ID): boundAttributeViewHistoryPath(util.DataDir, avBoxID, historicalAV.ID)} {
				data, err := os.ReadFile(source)
				if err != nil {
					t.Fatal(err)
				}
				if err = os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filename, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			tree.Root.SetIALAttr("title", "Current document")
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			currentSource, err := os.ReadFile(oldPath)
			if err != nil {
				t.Fatal(err)
			}
			currentAV, err := cloneAttributeViewForFieldMutation(historicalAV)
			if err != nil {
				t.Fatal(err)
			}
			currentAV.Name = "Current database"
			if err = av.SaveAttributeView(currentAV); err != nil {
				t.Fatal(err)
			}
			readAV := func() *av.AttributeView {
				view, err := av.ParseAttributeViewForIndexInBox(historicalAV.ID, avBoxID)
				if err != nil {
					t.Fatal(err)
				}
				return view
			}
			seedDocumentHistory(t, fixture.sourceID, fixture.targetID)
			relative, err := filepath.Rel(util.WorkspaceDir, historyPath)
			if err != nil {
				t.Fatal(err)
			}
			failure := errors.New("injected old document removal failure")
			observed := false
			err = rollbackDocHistory(relative, func(filename string, original []byte) error {
				observed = true
				if filename != oldPath || !bytes.Equal(original, currentSource) {
					t.Fatal("wrong cleanup source")
				}
				if _, err := os.Stat(originalPath); err != nil {
					t.Fatal("restore did not publish the new document before cleanup")
				}
				assertAttributeViewFieldsTest(t, historicalAV, readAV())
				return failure
			})
			if !observed || !errors.Is(err, failure) {
				t.Fatalf("restore did not reach the injected failure: %v", err)
			}
			if _, err = os.Stat(originalPath); !os.IsNotExist(err) {
				t.Fatal("failed restoration retained the newly written document")
			}
			if data, err := os.ReadFile(oldPath); err != nil || !bytes.Equal(data, currentSource) {
				t.Fatal("failed restoration changed the original document")
			}
			if bt := treenode.GetBlockTreeInBox(tree.ID, boxID); bt == nil || bt.Path != tree.Path {
				t.Fatal("failed restoration retained the new metadata path")
			}
			assertAttributeViewFieldsTest(t, currentAV, readAV())
			if undo, redo, _ := GlobalUndoLog.State(tree.ID); !undo || !redo {
				t.Fatal("failed restoration discarded current undo history")
			}
			if data, err := os.ReadFile(historyPath); err != nil || !bytes.Equal(data, snapshot) {
				t.Fatal("failed restoration changed history")
			}
			if err = RollbackDocHistory(relative); err != nil {
				t.Fatalf("restoration could not be retried: %v", err)
			}
			sql.FlushQueue()
			if _, err = os.Stat(oldPath); !os.IsNotExist(err) {
				t.Fatal("successful retry retained the old path")
			}
			assertAttributeViewFieldsTest(t, historicalAV, readAV())
			requireDocumentHistoryCleared(t, fixture.sourceID, fixture.targetID)
			if data, err := os.ReadFile(originalPath); err != nil || encrypted && !util.IsCiphertext(data) {
				t.Fatal("restored document is missing or exposed as plaintext")
			}
		})
	}
}

func TestHistoryDocumentRestoresExistingDestination(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(util.DataDir, tree.Box, tree.Path)
	before, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	parentID := ast.NewNodeID()
	parent := treenode.NewTree(tree.Box, "/"+parentID+".sy", "/Parent", "Parent")
	if _, err = filesys.WriteTree(parent); err != nil {
		t.Fatal(err)
	}
	oldPath := "/" + parentID + "/" + tree.ID + ".sy"
	tree.Path = oldPath
	tree.Root.SetIALAttr("title", "Current source")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	workingDoc := treenode.GetBlockTree(tree.ID)
	tree.Path = fixture.sourcePath
	tree.Root.SetIALAttr("title", "Historical source")
	failure := errors.New("injected relocation cleanup failure")
	if err = writeHistoryDocument(tree, workingDoc, func(string, []byte) error { return failure }); !errors.Is(err, failure) {
		t.Fatalf("cleanup error was not returned: %v", err)
	}
	if data, err := os.ReadFile(destination); err != nil || !bytes.Equal(data, before) {
		t.Fatal("rollback did not preserve the previous destination")
	}
	if bt := treenode.GetBlockTree(tree.ID); bt == nil || bt.Path != oldPath {
		t.Fatal("rollback did not restore the original source index")
	}
}
