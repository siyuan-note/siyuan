// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestCommitPreparedDocumentIndexRequiresLiveIdentityGuard(t *testing.T) {
	const (
		boxID = "20260101000000-abcdefg"
		path  = "/20260101000001-abcdefg.sy"
	)
	previousReplace := replaceIndexedTree
	previousQueue := queueIndexedTree
	previousGetBlocks := getIndexedRootBlocks
	defer func() {
		replaceIndexedTree = previousReplace
		queueIndexedTree = previousQueue
		getIndexedRootBlocks = previousGetBlocks
	}()

	replaced := 0
	replaceIndexedTree = func(guard treenode.DocumentIdentitySetGuard, tree *parse.Tree) error {
		if err := treenode.ValidateDocumentIdentitySetGuard(guard); err != nil {
			return err
		}
		replaced++
		return nil
	}
	queueIndexedTree = func(*parse.Tree) {}
	getIndexedRootBlocks = func(string, string) []*treenode.BlockTree { return nil }
	prepared := &PreparedDocumentIndex{tree: treenode.NewTree(boxID, path, "/Test", "Test")}

	guard := treenode.LockDocumentIdentitySet()
	if err := CommitPreparedDocumentIndexIdentityLocked(guard, prepared); err != nil {
		guard.Unlock()
		t.Fatalf("commit prepared index: %v", err)
	}
	guard.Unlock()
	if replaced != 1 {
		t.Fatalf("expected one index replacement, got %d", replaced)
	}
	if err := CommitPreparedDocumentIndexIdentityLocked(guard, prepared); err == nil {
		t.Fatal("released identity guard must not authorize a second commit")
	}
}

func TestPrepareDocumentIndexRemovalExactConflictAndIdempotency(t *testing.T) {
	const (
		boxID   = "20260101000000-abcdefg"
		rootID  = "20260101000001-abcdefg"
		docPath = "/20260101000001-abcdefg.sy"
	)
	previousLookup := lookupIndexedRootLocations
	previousRemove := removeIndexedRootLocation
	defer func() {
		lookupIndexedRootLocations = previousLookup
		removeIndexedRootLocation = previousRemove
	}()

	guard := treenode.LockDocumentIdentitySet()
	defer guard.Unlock()
	lookupIndexedRootLocations = func(string) ([]*treenode.BlockTree, error) {
		return []*treenode.BlockTree{{RootID: rootID, BoxID: boxID, Path: docPath}}, nil
	}
	removed := 0
	removeIndexedRootLocation = func(candidate treenode.DocumentIdentitySetGuard, actualBoxID, actualRootID, actualPath string) error {
		if err := treenode.ValidateDocumentIdentitySetGuard(candidate); err != nil {
			return err
		}
		if actualBoxID != boxID || actualRootID != rootID || actualPath != docPath {
			t.Fatalf("unexpected removal location: %s %s %s", actualBoxID, actualRootID, actualPath)
		}
		removed++
		return nil
	}
	prepared, err := PrepareDocumentIndexRemovalIdentityLocked(guard, boxID, rootID, docPath)
	if err != nil {
		t.Fatalf("prepare exact removal: %v", err)
	}
	if err = CommitPreparedDocumentIndexRemovalIdentityLocked(guard, prepared); err != nil {
		t.Fatalf("commit exact removal: %v", err)
	}
	if removed != 1 {
		t.Fatalf("expected exact index removal, got %d", removed)
	}

	lookupIndexedRootLocations = func(string) ([]*treenode.BlockTree, error) { return nil, nil }
	prepared, err = PrepareDocumentIndexRemovalIdentityLocked(guard, boxID, rootID, docPath)
	if err != nil {
		t.Fatalf("prepare idempotent removal: %v", err)
	}
	if err = CommitPreparedDocumentIndexRemovalIdentityLocked(guard, prepared); err != nil {
		t.Fatalf("commit idempotent removal: %v", err)
	}
	if removed != 1 {
		t.Fatalf("idempotent removal mutated the index: %d", removed)
	}

	lookupIndexedRootLocations = func(string) ([]*treenode.BlockTree, error) {
		return []*treenode.BlockTree{{RootID: rootID, BoxID: "20260101000002-abcdefg", Path: docPath}}, nil
	}
	_, err = PrepareDocumentIndexRemovalIdentityLocked(guard, boxID, rootID, docPath)
	if !errors.Is(err, ErrIndexPathConflict) {
		t.Fatalf("expected path conflict, got %v", err)
	}
}
