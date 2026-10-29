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
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIndexFixRootRecreationCompensatesEveryStage(t *testing.T) {
	for _, failure := range []string{"prepared", "created", "children-moved", "source-removed", "success"} {
		t.Run(failure, func(t *testing.T) {
			fixture, view, _, _ := setupAttributeViewItemsTest(t, false)
			isolateIndexRepairPaths(t)
			source, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			node := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeAttributeView, AttributeViewID: view.ID, AttributeViewType: "table"}
			node.SetIALAttr("id", node.ID)
			source.Root.AppendChild(node)
			if err = indexWriteTreeUpsertQueue(source); err != nil {
				t.Fatal(err)
			}
			av.UpsertBlockRel(view.ID, node.ID)
			child := addDocumentCollectionChild(t, source)
			childBytes, err := os.ReadFile(filepath.Join(util.DataDir, child.Box, child.Path))
			if err != nil {
				t.Fatal(err)
			}
			oldID, oldPath := source.ID, source.Path
			abs := filepath.Join(util.DataDir, source.Box, source.Path)
			original, err := os.ReadFile(abs)
			if err != nil {
				t.Fatal(err)
			}
			injected := errors.New("injected root recreation failure")
			err = recreateTreeWithSteps(source, abs, original, func(stage string) error {
				if stage == failure {
					return injected
				}
				return nil
			})
			if failure != "success" {
				if !errors.Is(err, injected) {
					t.Fatalf("unexpected failure: %v", err)
				}
				if source.ID != oldID || source.Path != oldPath {
					t.Fatal("failed recreation published new identity")
				}
				if got, readErr := os.ReadFile(abs); readErr != nil || !bytes.Equal(got, original) {
					t.Fatal("failed recreation lost original source", readErr)
				}
				if got, readErr := os.ReadFile(filepath.Join(util.DataDir, child.Box, child.Path)); readErr != nil || !bytes.Equal(got, childBytes) {
					t.Fatal("failed recreation lost original child directory", readErr)
				}
				if len(av.GetBlockRels()[view.ID]) != 1 {
					t.Fatal("failed preparation published mirror relations")
				}
			} else {
				if err != nil || source.ID == oldID {
					t.Fatalf("root recreation failed: %v", err)
				}
				if _, statErr := os.Stat(abs); !os.IsNotExist(statErr) {
					t.Fatal("committed recreation retained old source", statErr)
				}
				childPath := filepath.Join(filepath.Dir(source.Path), source.ID, child.ID+".sy")
				if got, readErr := os.ReadFile(filepath.Join(util.DataDir, child.Box, childPath)); readErr != nil || !bytes.Equal(got, childBytes) {
					t.Fatal("committed recreation changed child source", readErr)
				}
				sql.FlushQueue()
				assertIndexRepairDocument(t, source)
				if current := treenode.GetBlockTreeInExactBox(child.ID, child.Box); current == nil || filepath.Clean(current.Path) != filepath.Clean(childPath) {
					t.Fatal("child index did not follow recreated parent")
				}
			}
			journals, readErr := readDocumentSourceJournals()
			if readErr != nil || len(journals) != 0 {
				t.Fatalf("completed compensation retained pending recovery: %v, %v", journals, readErr)
			}
		})
	}
}

func TestDocumentSourceRecoveryResumesInterruptedRecreation(t *testing.T) {
	for _, stage := range []string{"created", "children-moved", "source-removed", "committed"} {
		t.Run(stage, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			isolateIndexRepairPaths(t)
			source, original, err := filesys.LoadTreeSnapshot(fixture.box.ID, fixture.sourcePath, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			child := addDocumentCollectionChild(t, source)
			oldPath := source.Path
			resetTreeData(source, "", true)
			j := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending", Files: []*documentSourceFile{
				{Box: source.Box, Path: oldPath, Before: original}, {Box: source.Box, Path: source.Path},
			}, Move: &documentSourceMove{Box: source.Box, From: oldPath[:len(oldPath)-3], To: source.Path[:len(source.Path)-3]}}
			if err = filesys.CreateTreeWithJournal(source, func(data []byte) error { j.Files[1].After = data; return j.save() }); err != nil {
				t.Fatal(err)
			}
			from, _ := documentSourcePath(j.Move.Box, j.Move.From, true)
			to, _ := documentSourcePath(j.Move.Box, j.Move.To, true)
			if stage != "created" {
				if err = os.Rename(from, to); err != nil {
					t.Fatal(err)
				}
			}
			oldAbs := filepath.Join(util.DataDir, source.Box, oldPath)
			if stage == "source-removed" || stage == "committed" {
				if err = os.Remove(oldAbs); err != nil {
					t.Fatal(err)
				}
			}
			if stage == "committed" {
				j.State = "committed"
				if err = j.save(); err != nil {
					t.Fatal(err)
				}
			}
			if err = recoverDocumentSources(); err != nil {
				t.Fatal(err)
			}
			if !hasDocumentSourceRecovery(source.Box) {
				t.Fatal("recovery did not retain the authenticated reindex requirement")
			}
			if stage != "committed" {
				if got, readErr := os.ReadFile(oldAbs); readErr != nil || !bytes.Equal(got, original) {
					t.Fatal("startup recovery lost original bytes", readErr)
				}
				if _, statErr := os.Stat(filepath.Join(from, child.ID+".sy")); statErr != nil {
					t.Fatal("startup recovery lost child document", statErr)
				}
				if _, statErr := os.Stat(filepath.Join(util.DataDir, source.Box, source.Path)); !os.IsNotExist(statErr) {
					t.Fatal("startup recovery left the uncommitted source", statErr)
				}
			} else if _, statErr := os.Stat(filepath.Join(to, child.ID+".sy")); statErr != nil {
				t.Fatal("startup recovery undid a committed move", statErr)
			}
			// Mount-time indexing must finish before the recovery record can be discarded.
			indexBox(source.Box)
			sql.FlushQueue()
			if hasDocumentSourceRecovery(source.Box) {
				t.Fatal("authenticated indexing did not complete source recovery")
			}
		})
	}
}

func TestIndexFixDuplicateRootPreservesCanonicalDocument(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	isolateIndexRepairPaths(t)
	source, original, err := filesys.LoadTreeSnapshot(fixture.box.ID, fixture.sourcePath, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	duplicatePath := "/" + fixture.targetID + "/" + source.ID + ".sy"
	duplicateAbs := filepath.Join(util.DataDir, source.Box, duplicatePath)
	if err = os.MkdirAll(filepath.Dir(duplicateAbs), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(duplicateAbs, original, 0600); err != nil {
		t.Fatal(err)
	}
	if err = fixIndexPipeline(); err != nil {
		t.Fatal(err)
	}
	canonical, _, err := filesys.ReadTreeSnapshot(source.Box, source.Path)
	if err != nil || canonical.ID != source.ID {
		t.Fatal("duplicate root repair changed canonical identity", err)
	}
	current, err := os.ReadFile(filepath.Join(util.DataDir, source.Box, source.Path))
	if err != nil || !bytes.Equal(current, original) {
		t.Fatal("duplicate root repair rewrote canonical source", err)
	}
	assertIndexRepairDocument(t, canonical)
	if _, statErr := os.Stat(duplicateAbs); !os.IsNotExist(statErr) {
		t.Fatal("duplicate root source was not replaced", statErr)
	}
}
