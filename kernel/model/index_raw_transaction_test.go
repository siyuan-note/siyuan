// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRawDocumentIndexBatchRefreshesUnchangedDescendants(t *testing.T) {
	const (
		boxID    = "20260101000000-abcdefg"
		parentID = "20260101000001-abcdefg"
		childID  = "20260101000002-abcdefg"
	)
	previousDataDir := util.DataDir
	previousLookupRoots := lookupIndexedRootLocations
	previousLookupBlocks := lookupIndexedBlockLocations
	previousPathBlocks := getIndexedPathBlocks
	util.DataDir = filepath.Join(t.TempDir(), "data")
	defer func() {
		util.DataDir = previousDataDir
		lookupIndexedRootLocations = previousLookupRoots
		lookupIndexedBlockLocations = previousLookupBlocks
		getIndexedPathBlocks = previousPathBlocks
	}()
	parentPath := "/" + parentID + ".sy"
	childPath := "/" + parentID + "/" + childID + ".sy"
	if err := os.MkdirAll(filepath.Join(util.DataDir, boxID, parentID), 0755); err != nil {
		t.Fatal(err)
	}
	luteEngine := util.NewLute()
	parent := treenode.NewTree(boxID, parentPath, "/New Parent", "New Parent")
	diskParent := treenode.NewTree(boxID, parentPath, "/Old Parent", "Old Parent")
	child := treenode.NewTree(boxID, childPath, "/Old Parent/Child", "Child")
	parentData := render.NewJSONRenderer(diskParent, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	childData := render.NewJSONRenderer(child, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	if err := os.WriteFile(filepath.Join(util.DataDir, boxID, parentID+".sy"), parentData, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, boxID, parentID, childID+".sy"), childData, 0644); err != nil {
		t.Fatal(err)
	}
	lookupIndexedRootLocations = func(rootID string) ([]*treenode.BlockTree, error) {
		switch rootID {
		case parentID:
			return []*treenode.BlockTree{{ID: parentID, RootID: parentID, BoxID: boxID, Path: parentPath, HPath: "/Old Parent"}}, nil
		case childID:
			return []*treenode.BlockTree{{ID: childID, RootID: childID, BoxID: boxID, Path: childPath, HPath: "/Old Parent/Child"}}, nil
		default:
			return nil, nil
		}
	}
	lookupIndexedBlockLocations = func(ids []string) ([]*treenode.BlockTree, error) {
		for _, id := range ids {
			if id == parentID {
				return []*treenode.BlockTree{{ID: parentID, RootID: parentID, BoxID: boxID, Path: parentPath, HPath: "/Old Parent"}}, nil
			}
		}
		return []*treenode.BlockTree{{ID: childID, RootID: childID, BoxID: boxID, Path: childPath, HPath: "/Old Parent/Child"}}, nil
	}
	getIndexedPathBlocks = func(actualBoxID, prefix string) []*treenode.BlockTree {
		if actualBoxID != boxID || prefix != "/"+parentID+"/" {
			t.Fatalf("unexpected descendant lookup: %s %s", actualBoxID, prefix)
		}
		return []*treenode.BlockTree{{ID: childID, RootID: childID, BoxID: boxID, Path: childPath, HPath: "/Old Parent/Child"}}
	}
	key := rawDocumentLocationKey(boxID, parentPath)
	batch := &RawDocumentIndexBatch{
		identityGuard: treenode.LockDocumentIdentitySet(),
		rootIDs:       map[string]struct{}{parentID: {}},
		locations:     map[string]string{key: parentID},
		identities:    map[string]string{},
		prepared: map[string]*PreparedRawDocumentIndexMutation{
			key: {tree: parent, blockIDs: parent.Root.BlockIDs()},
		},
		derived: map[string]*parse.Tree{},
	}
	batch.active.Store(true)
	defer batch.Unlock()
	titles := map[string]string{filesys.DocumentTitleOverlayKey(boxID, parentPath): "New Parent"}
	if err := batch.PrepareHPathProjection(titles); err != nil {
		t.Fatal(err)
	}
	derived := batch.derived[rawDocumentLocationKey(boxID, childPath)]
	if derived == nil || derived.HPath != "/New Parent/Child" {
		t.Fatalf("unchanged descendant was not refreshed: %+v", derived)
	}
}

func TestRawDocumentIndexBatchInvalidatesRemovedAndInsertedBlockIALs(t *testing.T) {
	const (
		boxID   = "20260101000000-abcdefg"
		rootID  = "20260101000001-abcdefg"
		docPath = "/20260101000001-abcdefg.sy"
		oldID   = "20260101000002-abcdefg"
		newID   = "20260101000003-abcdefg"
	)
	previousApply := applyRawDocumentIndexBatch
	previousQueue := queueIndexedTree
	previousGetBlocks := getIndexedRootBlocks
	previousRemoveIAL := removeCachedBlockIAL
	defer func() {
		applyRawDocumentIndexBatch = previousApply
		queueIndexedTree = previousQueue
		getIndexedRootBlocks = previousGetBlocks
		removeCachedBlockIAL = previousRemoveIAL
	}()

	applied := false
	applyRawDocumentIndexBatch = func(guard treenode.DocumentIdentitySetGuard, mutations []treenode.RawDocumentIndexMutation) error {
		if err := treenode.ValidateDocumentIdentitySetGuard(guard); err != nil {
			return err
		}
		if len(mutations) != 1 || mutations[0].Tree == nil {
			t.Fatalf("unexpected mutations: %+v", mutations)
		}
		applied = true
		return nil
	}
	queueIndexedTree = func(*parse.Tree) {}
	getIndexedRootBlocks = func(string, string) []*treenode.BlockTree {
		blockID := oldID
		if applied {
			blockID = newID
		}
		return []*treenode.BlockTree{{ID: blockID, RootID: rootID, BoxID: boxID, Path: docPath}}
	}
	invalidated := map[string]bool{}
	removeCachedBlockIAL = func(blockID string) { invalidated[blockID] = true }
	tree := treenode.NewTree(boxID, docPath, "/Test", "Test")
	guard := treenode.LockDocumentIdentitySet()
	batch := &RawDocumentIndexBatch{
		identityGuard: guard,
		rootIDs:       map[string]struct{}{rootID: {}},
		locations:     map[string]string{rawDocumentLocationKey(boxID, docPath): rootID},
		prepared: map[string]*PreparedRawDocumentIndexMutation{
			rawDocumentLocationKey(boxID, docPath): {tree: tree},
		},
	}
	batch.active.Store(true)
	defer batch.Unlock()
	deltas, err := batch.Commit()
	if err != nil {
		t.Fatal(err)
	}
	if len(deltas) != 1 || deltas[0].Revision == 0 || len(deltas[0].BeforeIDs) != 1 ||
		len(deltas[0].AfterIDs) != 1 || deltas[0].BeforeIDs[0] != oldID || deltas[0].AfterIDs[0] != newID {
		t.Fatalf("unexpected index delta: %+v", deltas)
	}
	if !invalidated[oldID] || !invalidated[newID] {
		t.Fatalf("cache projection was not fully invalidated: %+v", invalidated)
	}
}
