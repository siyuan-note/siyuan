// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupEncryptedCollectionRemovalTest(t *testing.T) (*fileOperationTestFixture, *av.AttributeView, string) {
	t.Helper()
	fixture, view, keyID := setupBlockCollectionTest(t)
	source, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	target, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	boxID := fixture.box.ID
	for _, tree := range []*parse.Tree{source, target} {
		treenode.RemoveBlockTreesByRootID(boxID, tree.ID)
	}
	key := bytes.Repeat([]byte{0x67}, 32)
	prepareUnlockedEncryptedBoxTest(t, boxID, key)
	encryptDocumentTestSources(t, key, source, target)
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted, boxConf.BoxCrypt = true, &conf.BoxEncryption{Spec: boxEncryptionSpec}
	if err = encryptBoxMetadata(boxID, boxConf, key); err != nil {
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
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	av.SetAVBoxID(view.ID, boxID)
	t.Cleanup(func() {
		treenode.CloseEncryptedBlockTreeDB(boxID)
		util.TempDir = oldTempDir
		mountedEncryptedBoxes.Delete(boxID)
		av.SetAVBoxID(view.ID, "")
	})
	for _, tree := range []*parse.Tree{source, target} {
		treenode.UpsertBlockTree(tree)
	}
	view.Automations.Spec = 8
	view.Automations.Rules[0].BlockSource = &av.AutomationBlockSource{
		DocumentIDs: []string{fixture.sourceID}, ReferenceID: fixture.targetID,
	}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	if err = PerformTxSync(collectionRemovalUpdate(t, fixture.childID, "Source "+collectionRemovalReference(fixture.targetID))); err != nil {
		t.Fatal(err)
	}
	view, err = av.ParseAttributeViewForIndexInBox(view.ID, boxID)
	if err != nil || view.GetBlockValueByBoundID(fixture.childID) == nil {
		t.Fatal("encrypted reference fixture was not collected", err)
	}
	return fixture, view, keyID
}

func TestCollectionRemovalEncryptedPreviewAndReplay(t *testing.T) {
	fixture, view, keyID := setupEncryptedCollectionRemovalTest(t)
	itemID := view.GetBlockValueByBoundID(fixture.childID).BlockID
	view.GetValue(keyID, itemID).Text.Content = "Encrypted edited field"
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	docPath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	viewPath, _ := view.StoragePath()
	beforeDoc, beforeView := collectionRemovalFile(t, docPath), collectionRemovalFile(t, viewPath)
	if !util.IsCiphertext(beforeDoc) || !util.IsCiphertext(beforeView) {
		t.Fatal("fixture is not encrypted")
	}
	tx := collectionRemovalUpdate(t, fixture.childID, "Source")
	groups, err := collectionRemovalPreviewTransaction(tx, nil)
	if err != nil || len(groups) != 1 || groups[0].AvID != view.ID || len(groups[0].Cleanup.Items) != 1 || groups[0].Cleanup.Items[0].ItemID != itemID {
		t.Fatalf("encrypted preview: %+v, %v", groups, err)
	}
	if tx.CollectionRemovalSourceVersions[fixture.sourceID] != collectionSourceVersion(beforeDoc) {
		t.Fatal("encrypted confirmation is not bound to its authenticated ciphertext")
	}
	if !bytes.Equal(beforeDoc, collectionRemovalFile(t, docPath)) || !bytes.Equal(beforeView, collectionRemovalFile(t, viewPath)) {
		t.Fatal("preview rewrote encrypted source or database bytes")
	}
	appendCollectionRemovalCleanup(tx, groups)
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	view, err = av.ParseAttributeViewForIndexInBox(view.ID, fixture.box.ID)
	if err != nil || view.GetBlockValue(itemID) != nil {
		t.Fatal("encrypted cleanup retained the confirmed row", err)
	}
	undo := &Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations), UndoOperations: cloneOperations(tx.DoOperations)}
	if err = PerformTxSync(undo); err != nil {
		t.Fatal(err)
	}
	view, err = av.ParseAttributeViewForIndexInBox(view.ID, fixture.box.ID)
	if err != nil || view.GetBlockValue(itemID) == nil || view.GetValue(keyID, itemID).Text.Content != "Encrypted edited field" {
		t.Fatal("encrypted undo lost row identity or fields", err)
	}
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil || !collectionBlockReferences(tree)[fixture.childID][fixture.targetID] {
		t.Fatal("encrypted undo lost the reference", err)
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(undo.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	view, err = av.ParseAttributeViewForIndexInBox(view.ID, fixture.box.ID)
	if err != nil || view.GetBlockValue(itemID) != nil {
		t.Fatal("encrypted redo retained the row", err)
	}
	for _, filename := range []string{docPath, viewPath} {
		if !util.IsCiphertext(collectionRemovalFile(t, filename)) {
			t.Fatal("cleanup or replay wrote plaintext", filename)
		}
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); !os.IsNotExist(err) {
		t.Fatal("cleanup recreated a plaintext database", err)
	}
}

func TestCollectionRemovalEncryptedFailurePreservesCiphertext(t *testing.T) {
	for _, mode := range []string{"locked", "corruptSource", "corruptView", "staleSource"} {
		t.Run(mode, func(t *testing.T) {
			fixture, view, _ := setupEncryptedCollectionRemovalTest(t)
			docPath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
			viewPath, _ := view.StoragePath()
			tx := collectionRemovalUpdate(t, fixture.childID, "Source")
			groups, err := collectionRemovalPreviewTransaction(tx, nil)
			if err != nil || len(groups) != 1 {
				t.Fatalf("encrypted preview: %+v, %v", groups, err)
			}
			appendCollectionRemovalCleanup(tx, groups)
			switch mode {
			case "locked":
				cachedDEKsLock.Lock()
				delete(cachedDEKs, fixture.box.ID)
				cachedDEKsLock.Unlock()
				setEncryptedBoxState(fixture.box.ID, EncryptedBoxStateLocked)
			case "corruptSource", "corruptView":
				filename := docPath
				if mode == "corruptView" {
					filename = viewPath
				}
				data := collectionRemovalFile(t, filename)
				data[len(data)-1] ^= 1
				if err = os.WriteFile(filename, data, 0600); err != nil {
					t.Fatal(err)
				}
			case "staleSource":
				tree, readErr := LoadTreeByBlockID(fixture.sourceID)
				if readErr != nil {
					t.Fatal(readErr)
				}
				tree.Root.SetIALAttr("custom-latest", "Preserve encrypted update")
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
			}
			cache.ClearAVCache()
			cache.RemoveTreeDataInBox(fixture.sourceID, fixture.box.ID)
			beforeDoc, beforeView := collectionRemovalFile(t, docPath), collectionRemovalFile(t, viewPath)
			if mode != "staleSource" {
				preview, previewErr := collectionRemovalGroups(tx.DoOperations[:1], nil)
				if previewErr == nil || len(preview) != 0 {
					t.Fatalf("unavailable encrypted data appeared in preview: %+v, %v", preview, previewErr)
				}
			}
			if err = PerformTxSync(tx); err == nil {
				t.Fatal("cleanup accepted unavailable or stale encrypted data")
			}
			if !bytes.Equal(beforeDoc, collectionRemovalFile(t, docPath)) || !bytes.Equal(beforeView, collectionRemovalFile(t, viewPath)) {
				t.Fatal("failed encrypted cleanup changed recovery material")
			}
		})
	}
}

func TestCollectionRemovalEncryptedBoundaryIsolation(t *testing.T) {
	fixture, view, _ := setupEncryptedCollectionRemovalTest(t)
	otherBox := &Box{ID: ast.NewNodeID()}
	if err := otherBox.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	foreign := treenode.NewTree(otherBox.ID, "/"+ast.NewNodeID()+".sy", "/Foreign private target", "Foreign private target")
	if _, err := filesys.WriteTree(foreign); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(foreign)
	source, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	paragraph := treenode.GetNodeInTree(source, fixture.childID)
	ast.Walk(paragraph, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeTextMark && node.TextMarkType == "block-ref" {
			node.TextMarkBlockRefID = foreign.ID
			node.TextMarkTextContent = "Foreign private target"
		}
		return ast.WalkContinue
	})
	if _, err = filesys.WriteTree(source); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(source)
	view.Automations.Rules[0].BlockSource.ReferenceID = foreign.ID
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	docPath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	viewPath, _ := view.StoragePath()
	beforeDoc, beforeView := collectionRemovalFile(t, docPath), collectionRemovalFile(t, viewPath)
	tx := collectionRemovalUpdate(t, fixture.childID, "Source")
	groups, err := collectionRemovalPreviewTransaction(tx, nil)
	if len(groups) != 0 {
		t.Fatalf("cross-boundary rule exposed cleanup rows: %+v, %v", groups, err)
	}
	if !bytes.Equal(beforeDoc, collectionRemovalFile(t, docPath)) || !bytes.Equal(beforeView, collectionRemovalFile(t, viewPath)) {
		t.Fatal("cross-boundary preview changed ciphertext")
	}
}
