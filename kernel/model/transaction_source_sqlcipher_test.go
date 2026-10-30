// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTransactionSourceEncryptedMirrorRollback(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	oldQueue := util.QueueDir
	util.QueueDir = t.TempDir()
	t.Cleanup(func() { util.QueueDir = oldQueue })
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "table": "Table", "select": "Select"}}
	box := newStructuredTitlesEncryptedBox(t)
	source := createStructuredTitlesEncryptedDoc(t, box, nil, "Private database")
	target := createStructuredTitlesEncryptedDoc(t, box, nil, "Private bound source")
	view := av.NewAttributeView(ast.NewNodeID())
	av.SetAVBoxID(view.ID, box)
	primary := view.GetBlockKeyValues()
	primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: ast.NewNodeID(), Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: target.ID}})
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	bound, _, err := filesys.ReadTreeSnapshot(box, target.Path)
	if err != nil {
		t.Fatal(err)
	}
	bound.Root.SetIALAttr(av.NodeAttrNameAvs, view.ID)
	if err = indexWriteTreeUpsertQueue(bound); err != nil {
		t.Fatal(err)
	}
	carrierTree, _, err := filesys.ReadTreeSnapshot(box, source.Path)
	if err != nil {
		t.Fatal(err)
	}
	carrier := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: view.ID, AttributeViewType: "table"}
	carrier.SetIALAttr("id", carrier.ID)
	carrierTree.Root.AppendChild(carrier)
	if err = indexWriteTreeUpsertQueue(carrierTree); err != nil {
		t.Fatal(err)
	}
	av.UpsertBlockRel(view.ID, carrier.ID)
	sourceBefore, targetBefore := structuredTitlesCiphertext(t, source), structuredTitlesCiphertext(t, target)
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "delete", ID: carrier.ID}}}
	tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected encrypted mirror save failure") }
	if err = PerformTxSync(tx); err == nil || tx.sourceRollbackErr != nil {
		t.Fatal("encrypted mirror rollback failed", err, tx.sourceRollbackErr)
	}
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, source.Path), sourceBefore)
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, target.Path), targetBefore)
	rels, err := av.GetBlockRelsByAVIDs([]string{view.ID})
	if err != nil || !slices.Contains(rels[view.ID], carrier.ID) {
		t.Fatal("private mirror was not restored", err)
	}
	if treenode.GetBlockTreeInExactBox(carrier.ID, box) == nil || sql.GetBlock(carrier.ID) != nil {
		t.Fatal("private mirror recovery lost scope")
	}
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "delete", ID: carrier.ID}}}); err != nil {
		t.Fatal(err)
	}
	bound, _, err = filesys.ReadTreeSnapshot(box, target.Path)
	if err != nil || bound.Root.IALAttr(av.NodeAttrNameAvs) != "" {
		t.Fatal("private binding was not removed", err)
	}
}

func TestTransactionSourceEncryptedConflictArchive(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	oldQueue := util.QueueDir
	util.QueueDir = t.TempDir()
	t.Cleanup(func() { util.QueueDir = oldQueue })
	box := newStructuredTitlesEncryptedBox(t)
	source := createStructuredTitlesEncryptedDoc(t, box, nil, "Archived private source")
	before := structuredTitlesCiphertext(t, source)
	tree, _, err := filesys.ReadTreeSnapshot(box, source.Path)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("title", "Pending private source")
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	after := structuredTitlesCiphertext(t, source)
	tree.Root.SetIALAttr("title", "Current private source")
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	current := structuredTitlesCiphertext(t, source)
	j := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending", Files: []*documentSourceFile{{Box: box, Path: source.Path, Before: before, After: after}}}
	if err = j.save(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(j.filename())
	if err != nil {
		t.Fatal(err)
	}
	if err = recoverDocumentSources(); err != nil {
		t.Fatal(err)
	}
	archived, err := os.ReadFile(documentSourceArchivePath(j.ID))
	if err != nil || !bytes.Equal(archived, raw) || bytes.Contains(archived, []byte("private source")) {
		t.Fatal("archive lost ciphertext or leaked plaintext", err)
	}
	keyBackup, err := os.ReadFile(filepath.Join(filepath.Dir(documentSourceArchivePath(j.ID)), "keys", "backup.json"))
	if err != nil {
		t.Fatal(err)
	}
	originalKeys, err := os.ReadFile(dataCryptoBackupPath())
	if err != nil || !bytes.Equal(originalKeys, keyBackup) {
		t.Fatal("archive lost matching recovery keys", err)
	}
	indexBox(box)
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, source.Path), current)
	if hasDocumentSourceRecovery(box) {
		t.Fatal("authenticated encrypted index did not complete recovery")
	}
	if _, err = os.Stat(documentSourceArchivePath(j.ID)); err != nil {
		t.Fatal("index removed ciphertext archive", err)
	}

	// 认证失败保留当前密文和待索引记录，不以日志快照替换损坏源。
	j.ID, j.State = ast.NewNodeID(), "pending"
	j.Recovered = nil
	if err = j.save(); err != nil {
		t.Fatal(err)
	}
	corrupt := append([]byte{}, current...)
	corrupt[len(corrupt)-1] ^= 1
	if err = os.WriteFile(filepath.Join(util.DataDir, box, source.Path), corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if err = recoverDocumentSources(); err != nil {
		t.Fatal(err)
	}
	indexBox(box)
	if !hasDocumentSourceRecovery(box) {
		t.Fatal("authentication failure completed index recovery")
	}
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, source.Path), corrupt)
}

func TestTransactionSourceEncryptedPartialFailure(t *testing.T) {
	if !prepareStructuredTitlesCryptoTest(t) {
		return
	}
	box := newStructuredTitlesEncryptedBox(t)
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "table": "Table", "select": "Select"}}
	source := createStructuredTitlesEncryptedDoc(t, box, nil, "Source")
	target := createStructuredTitlesEncryptedDoc(t, box, nil, "Target")
	sourceTree, _, err := filesys.ReadTreeSnapshot(box, source.Path)
	if err != nil {
		t.Fatal(err)
	}
	sourceTree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "todo"})
	if err = indexWriteTreeUpsertQueue(sourceTree); err != nil {
		t.Fatal(err)
	}
	sourceBefore, targetBefore := structuredTitlesCiphertext(t, source), structuredTitlesCiphertext(t, target)
	view := av.NewAttributeView(ast.NewNodeID())
	view.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{
		ID: ast.NewNodeID(), Name: "Collect", Trigger: "block", Enabled: true,
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{target.ID}, Types: []string{"p"}, Tags: []string{"todo"}},
		Actions:     []*av.AutomationAction{{Type: "collect", Target: "current"}},
	}}}
	av.SetAVBoxID(view.ID, box)
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	viewPath := filepath.Join(util.DataDir, box, "storage", "av", view.ID+".json")
	viewBefore, err := os.ReadFile(viewPath)
	if err != nil {
		t.Fatal(err)
	}
	movedID := sourceTree.Root.FirstChild.ID
	op := &Operation{Action: "move", ID: movedID, ParentID: target.ID}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, m: &sync.Mutex{}}
	if err = tx.begin(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if tx.state.Load() == 1 {
			tx.rollback()
		}
	}()
	if txErr := tx.doMove(op); txErr != nil {
		t.Fatal(txErr)
	}
	if err = tx.runAttributeViewCollections(); err != nil {
		t.Fatal(err)
	}
	if err = tx.runAttributeViewAutomations(); err != nil {
		t.Fatal(err)
	}
	if tx.sourceDatabase(view.ID, box) == nil {
		t.Fatal("private collection side effect was not journaled")
	}
	injected, writes := errors.New("injected second encrypted source failure"), 0
	tx.writeTransactionTree = func(tree *parse.Tree) error {
		writes++
		if writes == 2 {
			return injected
		}
		if err := writeTreeUpsertQueue(tree); err != nil {
			return err
		}
		journals, err := readDocumentSourceJournals()
		if err != nil || len(journals) != 1 || journals[0].Forward {
			t.Fatalf("missing multi-source recovery: %v", err)
		}
		for _, file := range journals[0].Files {
			if (file.Before != nil && !util.IsCiphertext(file.Before)) || (file.After != nil && !util.IsCiphertext(file.After)) {
				t.Fatal("private recovery record contains plaintext")
			}
		}
		return nil
	}
	if err = tx.commit(); !errors.Is(err, injected) {
		t.Fatal(err)
	}
	tx.rollback()
	if tx.sourceRollbackErr != nil {
		t.Fatal(tx.sourceRollbackErr)
	}
	sql.FlushQueue()
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, source.Path), sourceBefore)
	assertEncryptedFileBytes(t, filepath.Join(util.DataDir, box, target.Path), targetBefore)
	assertEncryptedFileBytes(t, viewPath, viewBefore)
	stored, err := av.ParseAttributeViewForIndexInBox(view.ID, box)
	if err != nil || len(stored.GetBlockKeyValues().Values) != 0 {
		t.Fatal("private database rows did not roll back", err)
	}
	if block := sql.GetBlockInBox(movedID, box); block == nil || block.RootID != source.ID {
		t.Fatal("encrypted source index was not restored")
	}
	if sql.GetBlock(movedID) != nil {
		t.Fatal("private rollback entered the global SQL index")
	}
}
