// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"errors"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func documentBoundaryUpdate(id, content string) *Transaction {
	return &Transaction{DoOperations: []*Operation{{Action: "update", ID: id,
		Data: fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">%s</div></div>`, id, content)}}}
}

func TestDocumentReadBoundaryWaitsForInFlightCommitAndOwnsItsSource(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	entered, resume := make(chan struct{}), make(chan struct{})
	var release sync.Once
	defer release.Do(func() { close(resume) })
	transaction := documentBoundaryUpdate(fixture.childID, "committed source")
	transaction.writeTransactionTree = func(tree *parse.Tree) error {
		close(entered)
		<-resume
		return writeTreeUpsertQueue(tree)
	}
	writeDone := make(chan error, 1)
	go func() { writeDone <- PerformTxSync(transaction) }()
	requireTransactionFinished(t, entered)
	readDone := make(chan struct{})
	var snapshot *parse.Tree
	var readErr error
	go func() {
		snapshot, readErr = loadDocumentAtTransactionBoundary(fixture.childID, "", nil)
		close(readDone)
	}()
	requireTransactionWaiting(t, readDone)
	release.Do(func() { close(resume) })
	requireTransactionFinished(t, readDone)
	if err := <-writeDone; err != nil {
		t.Fatal(err)
	}
	if readErr != nil || treenode.GetNodeInTree(snapshot, fixture.childID).Text() != "committed source" {
		t.Fatalf("read exposed block-tree metadata before source commit: %v", readErr)
	}
	if err := PerformTxSync(documentBoundaryUpdate(fixture.childID, "later source")); err != nil {
		t.Fatal(err)
	}
	if treenode.GetNodeInTree(snapshot, fixture.childID).Text() != "committed source" {
		t.Fatal("later edits mutated the previously captured document tree")
	}
}

func TestDocumentReadBoundaryParsesCachedSourceAfterReleasingWriteLock(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	if err := PerformTxSync(documentBoundaryUpdate(fixture.childID, "captured source")); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		if _, ok := cache.GetTreeDataInBox(fixture.sourceID, fixture.box.ID); ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("committed source was not cached")
		}
		time.Sleep(time.Millisecond)
	}
	source, err := captureDocumentSourceAtTransactionBoundary(fixture.childID, "", nil)
	if err != nil || source == nil {
		t.Fatalf("warm ordinary source did not use independent capture: %v", err)
	}
	done := make(chan struct{})
	var writeErr error
	go func() { writeErr = PerformTxSync(documentBoundaryUpdate(fixture.childID, "later source")); close(done) }()
	requireTransactionFinished(t, done)
	if writeErr != nil {
		t.Fatal(writeErr)
	}
	snapshot, err := source.Parse(util.NewLute())
	if err != nil || treenode.GetNodeInTree(snapshot, fixture.childID).Text() != "captured source" {
		t.Fatalf("later edit changed the captured bytes before parsing: %v", err)
	}
}

func TestDocumentReadBoundaryPreservesGetDocProjection(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search.Store(conf.NewSearch())
	Conf.Editor.Load().DynamicLoadBlocks = 2
	Conf.Editor.Load().HeadingNumber = true
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("source first")})
	heading := &ast.Node{Type: ast.NodeHeading, ID: "20261019000000-heading", HeadingLevel: 1}
	heading.SetIALAttr("id", heading.ID)
	heading.SetIALAttr("fold", "1")
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Source heading")})
	tree.Root.AppendChild(heading)
	for i := range 3 {
		paragraph := treenode.NewParagraph(fmt.Sprintf("20261019000000-%07d", i))
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(fmt.Sprintf("source paragraph %d", i))})
		tree.Root.AppendChild(paragraph)
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()
	for _, id := range []string{tree.ID, heading.ID, fixture.childID} {
		for mode := 0; mode <= 4; mode++ {
			for _, query := range []string{"", "source"} {
				load := func() []any {
					blockCount, content, parentID, parent2ID, rootID, typ, eof, scroll, box, path, backlink, keywords, numbers, info, loadErr := GetDoc(
						fixture.childID, heading.ID, id, 0, query, nil, nil, 0, mode, 2, false, map[string]string{}, true, true)
					if loadErr != nil {
						t.Fatal(loadErr)
					}
					return []any{blockCount, content, parentID, parent2ID, rootID, typ, eof, scroll, box, path, backlink, keywords, numbers, info}
				}
				cache.RemoveTreeDataInBox(tree.ID, tree.Box)
				want := load()
				deadline := time.Now().Add(time.Second)
				for {
					if _, ok := cache.GetTreeDataInBox(tree.ID, tree.Box); ok {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("document source was not cached")
					}
					time.Sleep(time.Millisecond)
				}
				if got := load(); !reflect.DeepEqual(got, want) {
					t.Fatalf("source snapshot changed document projection: id=%s mode=%d query=%q; got=%#v want=%#v", id, mode, query, got, want)
				}
			}
		}
	}
}

func TestDocumentReadBoundaryPreservesMoveFailureAndReadErrors(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	move := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "move", ID: fixture.childID, ParentID: fixture.targetID}}}
	queued := []*Transaction{move}
	PerformTransactions(&queued)
	tree, err := loadDocumentAtTransactionBoundary(fixture.childID, "", nil)
	if err != nil || tree.ID != fixture.targetID || tree.Path != fixture.targetPath || treenode.GetNodeInTree(tree, fixture.childID) == nil {
		t.Fatalf("cross-document move produced a mixed source snapshot: %v", err)
	}
	requireTransactionFinished(t, waitForTransactionInTest(move))
	failure := documentBoundaryUpdate(fixture.childID, "failed source")
	failure.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected source failure") }
	if err = PerformTxSync(failure); err == nil {
		t.Fatal("injected source failure was accepted")
	}
	tree, err = loadDocumentAtTransactionBoundary(fixture.childID, "", nil)
	if err != nil || treenode.GetNodeInTree(tree, fixture.childID).Text() == "failed source" {
		t.Fatalf("failed commit changed the captured source: %v", err)
	}
	if _, err = loadDocumentAtTransactionBoundary("invalid", "", nil); !errors.Is(err, ErrTreeNotFound) {
		t.Fatalf("invalid block ID changed its read error: %v", err)
	}
	done := make(chan struct{})
	go func() { _ = PerformTxSync(&Transaction{}); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("read error retained the transaction boundary")
	}
}

func TestDocumentReadBoundaryReturnsBeforeLaterWriteAndKeepsUndoCompletion(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	if err := PerformTxSync(documentBoundaryUpdate(fixture.childID, "captured source")); err != nil {
		t.Fatal(err)
	}
	entered, resume := make(chan struct{}), make(chan struct{})
	var release sync.Once
	defer release.Do(func() { close(resume) })
	later := documentBoundaryUpdate(fixture.childID, "subsequent source")
	later.writeTransactionTree = func(tree *parse.Tree) error {
		close(entered)
		<-resume
		return writeTreeUpsertQueue(tree)
	}
	var snapshot *parse.Tree
	var err error
	readAtTransactionBoundary(func() {
		queued := []*Transaction{later}
		PerformTransactions(&queued)
		snapshot, err = loadTreeByBlockIDInBox0(fixture.childID, "", false)
	}, nil)
	if err != nil || treenode.GetNodeInTree(snapshot, fixture.childID).Text() != "captured source" {
		t.Fatalf("read did not retain the source at its boundary: %v", err)
	}
	requireTransactionFinished(t, entered)
	completion := waitForTransactionInTest(later)
	globalFlush := make(chan struct{})
	go func() { FlushTxQueue(); close(globalFlush) }()
	requireTransactionWaiting(t, completion)
	requireTransactionWaiting(t, globalFlush)
	release.Do(func() { close(resume) })
	requireTransactionFinished(t, completion)
	requireTransactionFinished(t, globalFlush)
	if treenode.GetNodeInTree(snapshot, fixture.childID).Text() != "captured source" {
		t.Fatal("completion of a subsequent write changed the captured source")
	}
	undo := documentBoundaryUpdate(fixture.childID, "captured source")
	undo.isReplay = true
	if err = PerformTxSync(undo); err != nil {
		t.Fatal(err)
	}
	requireTransactionFinished(t, waitForTransactionInTest(undo))
	tree, err := loadDocumentAtTransactionBoundary(fixture.childID, "", nil)
	if err != nil || treenode.GetNodeInTree(tree, fixture.childID).Text() != "captured source" {
		t.Fatalf("undo replay was not fully committed at the next read boundary: %v", err)
	}
}
