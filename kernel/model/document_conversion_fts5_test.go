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
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentToHeadingCommitsContentAndIdentity(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	target, _, err := loadBatchMutationTree(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	box, p, err := Doc2Heading(fixture.sourceID, target.Root.FirstChild.ID, true)
	if err != nil || box != fixture.box.ID || p != fixture.sourcePath {
		t.Fatalf("convert document: %s %s %v", box, p, err)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, box, p)); !os.IsNotExist(err) {
		t.Fatal("old document source retained", err)
	}
	actual, err := filesys.LoadTree(box, target.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	if heading := treenode.GetNodeInTree(actual, fixture.sourceID); heading == nil || heading.Type != ast.NodeHeading {
		t.Fatal("document identity was not converted to a heading")
	}
	if treenode.GetNodeInTree(actual, fixture.childID) == nil {
		t.Fatal("document content lost")
	}
	if bt := treenode.GetBlockTree(fixture.childID); bt == nil || bt.RootID != target.ID {
		t.Fatalf("converted identity points to old document: %+v", bt)
	}
}

func TestDocumentConversionInterruptedRemovalRecovery(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	source, original, err := loadBatchMutationTree(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	target, targetOriginal, err := loadBatchMutationTree(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	j := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending", Files: []*documentSourceFile{
		{Box: source.Box, Path: source.Path, Before: original, After: nil},
		{Box: target.Box, Path: target.Path, Before: targetOriginal, After: targetOriginal},
	}}
	if err = j.save(); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(util.DataDir, source.Box, source.Path)
	if err = os.Remove(filename); err != nil {
		t.Fatal(err)
	}
	if err = recoverDocumentSources(); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(got, original) {
		t.Fatal("interrupted conversion source not recovered", err)
	}
}

func TestDocumentConversionTargetFailureRestoresSources(t *testing.T) {
	for _, remove := range []bool{false, true} {
		t.Run(map[bool]string{false: "split", true: "documentToHeading"}[remove], func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			source, sourceBefore, err := loadBatchMutationTree(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			target, targetBefore, err := loadBatchMutationTree(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			child := treenode.GetNodeInTree(source, fixture.childID)
			target.Root.AppendChild(child)
			injected := errors.New("destination write failed")
			write := func(tree *parse.Tree) error {
				if tree == target {
					return injected
				}
				return indexWriteTreeUpsertQueue(tree)
			}
			flushLock.Lock()
			err = commitDocumentConversion(source, target, sourceBefore, targetBefore, remove, write)
			flushLock.Unlock()
			if !errors.Is(err, injected) {
				t.Fatalf("conversion result: %v", err)
			}
			sql.FlushQueue()
			for p, want := range map[string][]byte{source.Path: sourceBefore, target.Path: targetBefore} {
				got, err := os.ReadFile(filepath.Join(util.DataDir, source.Box, p))
				if err != nil || !bytes.Equal(got, want) {
					t.Fatalf("source not restored: %s, %v", p, err)
				}
			}
			if bt := treenode.GetBlockTree(fixture.childID); bt == nil || bt.RootID != fixture.sourceID {
				t.Fatalf("block identity not restored: %+v", bt)
			}
			if journals, err := readDocumentSourceJournals(); err != nil || len(journals) != 0 {
				t.Fatalf("successful compensation retained journal: %v, %v", journals, err)
			}
		})
	}
}

func TestDocumentConversionRejectsOccupiedDestinationBeforeSourceWrite(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	source, original, err := loadBatchMutationTree(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	target, _, err := loadBatchMutationTree(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	if err = commitDocumentConversion(source, target, original, nil, false, indexWriteTreeUpsertQueue); !errors.Is(err, util.ErrFileChanged) {
		t.Fatalf("occupied destination accepted: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(util.DataDir, source.Box, source.Path))
	if err != nil || !bytes.Equal(got, original) {
		t.Fatal("source changed before destination validation", err)
	}
	if _, err = filesys.LoadTree(source.Box, source.Path, util.NewLute()); err != nil {
		t.Fatal(err)
	}
}
