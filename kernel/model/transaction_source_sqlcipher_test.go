// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
