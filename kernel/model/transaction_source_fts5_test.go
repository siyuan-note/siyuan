// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTransactionSourceSecondWriteFailureRestoresBothDocuments(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	before := map[string][]byte{}
	for _, p := range []string{fixture.sourcePath, fixture.targetPath} {
		data, err := os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, p))
		if err != nil {
			t.Fatal(err)
		}
		before[p] = data
	}
	op := &Operation{Action: "move", ID: fixture.childID, ParentID: fixture.targetID}
	tx := &Transaction{DoOperations: []*Operation{op}, m: &sync.Mutex{}}
	if err := tx.begin(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if tx.state.Load() == 1 {
			tx.rollback()
		}
	}()
	if err := tx.doMove(op); err != nil {
		t.Fatal(err)
	}
	writes := 0
	injected := errors.New("injected second source write failure")
	tx.writeTransactionTree = func(tree *parse.Tree) error {
		writes++
		if writes == 2 {
			return injected
		}
		return writeTreeUpsertQueue(tree)
	}
	if err := tx.commit(); !errors.Is(err, injected) {
		t.Fatalf("unexpected commit result: %v", err)
	}
	tx.rollback()
	sql.FlushQueue()
	for p, original := range before {
		current, err := os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, p))
		if err != nil || !bytes.Equal(current, original) {
			t.Fatalf("failed transaction left partially committed source %s: %v", p, err)
		}
	}
	if block := treenode.GetBlockTreeInExactBox(fixture.childID, fixture.box.ID); block == nil || block.RootID != fixture.sourceID {
		t.Fatalf("failed move left pending block identity: %+v", block)
	}
}

func TestTransactionSourceExecutionFailureRestoresPendingIdentities(t *testing.T) {
	for _, action := range []string{"create", "insert", "update", "delete", "move"} {
		t.Run(action, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			before := map[string][]byte{}
			for _, p := range []string{fixture.sourcePath, fixture.targetPath} {
				data, err := os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, p))
				if err != nil {
					t.Fatal(err)
				}
				before[p] = data
				tree, _, err := filesys.ReadTreeSnapshot(fixture.box.ID, p)
				if err != nil {
					t.Fatal(err)
				}
				sql.UpsertTreeQueue(tree)
			}
			sql.FlushQueue()
			newID := ast.NewNodeID()
			op := &Operation{Action: action, ID: fixture.childID}
			switch action {
			case "create":
				op.Tree = treenode.NewTree(fixture.box.ID, "/"+newID+".sy", "/New", "New")
			case "insert":
				op.ID, op.PreviousID = newID, fixture.childID
				op.Data = `<div data-node-id="` + newID + `" data-type="NodeParagraph"><div contenteditable="true">New</div></div>`
			case "update":
				op.Data = `<div data-node-id="` + fixture.childID + `" data-type="NodeParagraph"><div contenteditable="true">Changed</div></div>`
			case "move":
				op.ParentID = fixture.targetID
			}
			tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op, {Action: "update", ID: ast.NewNodeID(), Data: "invalid"}}}
			if err := PerformTxSync(tx); err == nil {
				t.Fatal("expected execution failure")
			}
			sql.FlushQueue()
			for p, original := range before {
				current, err := os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, p))
				if err != nil || !bytes.Equal(current, original) {
					t.Fatal("execution failure changed source", p, err)
				}
				tree, _, err := filesys.ReadTreeSnapshot(fixture.box.ID, p)
				if err != nil {
					t.Fatal(err)
				}
				assertIndexRepairDocument(t, tree)
			}
			if treenode.GetBlockTreeInExactBox(newID, fixture.box.ID) != nil {
				t.Fatal("failed operation retained a new identity")
			}
			if _, err := os.Stat(filepath.Join(util.DataDir, fixture.box.ID, newID+".sy")); !os.IsNotExist(err) {
				t.Fatal("failed creation retained a source", err)
			}
		})
	}
}

func TestTransactionSourceRestoresCollectionDatabaseAndBindings(t *testing.T) {
	for _, crash := range []bool{false, true} {
		t.Run(map[bool]string{false: "write-failure", true: "interrupted"}[crash], func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			viewPath := av.GetAttributeViewDataPath(view.ID)
			viewBefore, err := os.ReadFile(viewPath)
			if err != nil {
				t.Fatal(err)
			}
			before := map[string][]byte{}
			for _, p := range []string{fixture.sourcePath, fixture.targetPath} {
				before[p], err = os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, p))
				if err != nil {
					t.Fatal(err)
				}
			}
			tx := blockCollectionTags(t, fixture.sourceID, "todo")
			tx.m = &sync.Mutex{}
			if err = tx.begin(); err != nil {
				t.Fatal(err)
			}
			defer func() {
				if tx.state.Load() == 1 {
					tx.rollback()
				}
			}()
			if txErr := tx.doSetAttrs(tx.DoOperations[0]); txErr != nil {
				t.Fatal(txErr)
			}
			target, err := tx.loadTree(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			target.Root.AppendChild(treenode.NewParagraph(""))
			tx.writeTree(target)
			if err = tx.runAttributeViewCollections(); err != nil {
				t.Fatal(err)
			}
			if err = tx.runAttributeViewAutomations(); err != nil {
				t.Fatal(err)
			}
			if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 1 || tx.sourceDatabase(view.ID, "") == nil {
				t.Fatal("fixture did not persist a journaled collection side effect")
			}
			if crash {
				source := tx.trees[fixture.sourceID]
				if err = tx.recordDocumentWrite(source, func() error { return writeTreeUpsertQueue(source) }); err != nil {
					t.Fatal(err)
				}
				// Simulate loss of volatile transaction state before the second source write.
				tx.releaseDocumentSources(false)
				tx.finishAttributeViewMutation(false)
				tx.state.Store(3)
				tx.m.Unlock()
				if err = recoverDocumentSources(); err != nil {
					t.Fatal(err)
				}
				indexBox(fixture.box.ID)
			} else {
				writes := 0
				tx.writeTransactionTree = func(tree *parse.Tree) error {
					writes++
					if writes == 2 {
						return errors.New("injected second source failure")
					}
					return writeTreeUpsertQueue(tree)
				}
				if err = tx.commit(); err == nil {
					t.Fatal("expected commit failure")
				}
				tx.rollback()
				if tx.sourceRollbackErr != nil {
					t.Fatal(tx.sourceRollbackErr)
				}
			}
			sql.FlushQueue()
			for p, original := range before {
				current, err := os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, p))
				if err != nil || !bytes.Equal(current, original) {
					t.Fatal("collection rollback changed source", p, err)
				}
				tree, _, err := filesys.ReadTreeSnapshot(fixture.box.ID, p)
				if err != nil {
					t.Fatal(err)
				}
				assertIndexRepairDocument(t, tree)
			}
			current, err := os.ReadFile(viewPath)
			if err != nil || !bytes.Equal(current, viewBefore) || len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 0 {
				t.Fatal("rollback did not restore exact database bytes and rows", err)
			}
			if attrs := cache.GetBlockIALInBox(fixture.sourceID, fixture.box.ID); attrs["tags"] == "todo" || attrs[av.NodeAttrNameAvs] != "" {
				t.Fatal("rollback retained pending attribute or binding cache", attrs)
			}
		})
	}
}

func TestTransactionSourceSingleDocumentCrashRecoversAtomicReplacement(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tx := blockCollectionTags(t, fixture.sourceID, "saved")
	tx.m = &sync.Mutex{}
	if err := tx.begin(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if tx.state.Load() == 1 {
			tx.rollback()
		}
	}()
	if txErr := tx.doSetAttrs(tx.DoOperations[0]); txErr != nil {
		t.Fatal(txErr)
	}
	source := tx.trees[fixture.sourceID]
	if err := tx.recordDocumentWrite(source, func() error { return writeTreeUpsertQueue(source) }); err != nil {
		t.Fatal(err)
	}
	journals, err := readDocumentSourceJournals()
	if err != nil || len(journals) != 1 || !journals[0].Forward || journals[0].Files[0].Before != nil || journals[0].Files[0].After != nil {
		t.Fatalf("single atomic document save stored unnecessary source copies: %+v %v", journals, err)
	}
	tx.releaseDocumentSources(false)
	tx.state.Store(3)
	tx.m.Unlock()
	if err = recoverDocumentSources(); err != nil {
		t.Fatal(err)
	}
	indexBox(fixture.box.ID)
	sql.FlushQueue()
	actual, _, err := filesys.ReadTreeSnapshot(source.Box, source.Path)
	if err != nil || actual.Root.IALAttr("tags") != "saved" {
		t.Fatal("single-source recovery lost an atomic replacement", err)
	}
	assertIndexRepairDocument(t, actual)
}

func TestTransactionSourcePreservesNewerConcurrentFile(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tx := blockCollectionTags(t, fixture.sourceID, "pending")
	tx.m = &sync.Mutex{}
	if err := tx.begin(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if tx.state.Load() == 1 {
			tx.rollback()
		}
	}()
	if txErr := tx.doSetAttrs(tx.DoOperations[0]); txErr != nil {
		t.Fatal(txErr)
	}
	newer, _, err := filesys.ReadTreeSnapshot(fixture.box.ID, fixture.sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	newer.Root.SetIALAttr("title", "Newer edit")
	if _, err = filesys.WriteTree(newer); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	want, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.commit(); !errors.Is(err, util.ErrFileChanged) {
		t.Fatalf("stale transaction was not rejected: %v", err)
	}
	tx.rollback()
	if !errors.Is(tx.sourceRollbackErr, util.ErrFileChanged) {
		t.Fatal("rollback did not report its preserved conflict", tx.sourceRollbackErr)
	}
	actual, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(actual, want) {
		t.Fatal("transaction or rollback overwrote the newer edit", err)
	}
	if err = recoverDocumentSources(); err != nil {
		t.Fatal(err)
	}
	indexBox(fixture.box.ID)
	sql.FlushQueue()
	current, _, err := filesys.ReadTreeSnapshot(fixture.box.ID, fixture.sourcePath)
	if err != nil || current.Root.IALAttr("title") != "Newer edit" {
		t.Fatal("recovery lost the newer edit", err)
	}
	assertIndexRepairDocument(t, current)
}
