// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCheckBlockRefInBoxRejectsMissingBlockTrees(t *testing.T) {
	previousBlockTreeDBPath := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(t.TempDir(), "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = previousBlockTreeDBPath
		if "" != previousBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	_, err := CheckBlockRefInBox([]string{"20260730000000-missing"}, nil, nil, "")
	if !errors.Is(err, ErrBlockNotFound) {
		t.Fatalf("expected a missing block tree to return ErrBlockNotFound, got %v", err)
	}
}

func TestHasSurvivingAttributeViewBlock(t *testing.T) {
	group := newBlockRefCheckGroup()
	group.deletedBlockIDs["20260804000000-deleted-db"] = struct{}{}
	group.deletedRootIDs["20260804000000-deleted-root"] = struct{}{}
	boundAVIDs := map[string][]string{
		"20260804000000-bound": {"20260804000000-av"},
	}
	avBlockRels := map[string][]string{
		"20260804000000-av": {
			"20260804000000-deleted-db",
			"20260804000000-deleted-root-db",
			"20260804000000-external-db",
		},
	}
	blockTrees := map[string]*treenode.BlockTree{
		"20260804000000-deleted-db": {
			ID: "20260804000000-deleted-db", RootID: "20260804000000-surviving-root",
		},
		"20260804000000-deleted-root-db": {
			ID: "20260804000000-deleted-root-db", RootID: "20260804000000-deleted-root",
		},
		"20260804000000-external-db": {
			ID: "20260804000000-external-db", RootID: "20260804000000-external-root",
		},
	}

	if !hasSurvivingAttributeViewBlock(group, boundAVIDs, avBlockRels, blockTrees) {
		t.Fatal("an external database mirror should require confirmation")
	}
	delete(blockTrees, "20260804000000-external-db")
	if hasSurvivingAttributeViewBlock(group, boundAVIDs, avBlockRels, blockTrees) {
		t.Fatal("database mirrors deleted with the bound block should not require confirmation")
	}
}

func TestExpandBlockRefCheckDescendantsIgnoresEmptyBlockTrees(t *testing.T) {
	group := newBlockRefCheckGroup()
	selected := map[string]struct{}{"selected": {}}
	deleted := map[string]struct{}{"selected": {}}
	rootTrees := []*treenode.BlockTree{
		{ID: "", ParentID: "selected"},
		{ID: "valid-child", ParentID: "selected"},
	}

	expandBlockRefCheckDescendants(group, selected, deleted, rootTrees)

	if _, exists := group.blockIDs[""]; exists {
		t.Fatal("an empty blocktree ID should not enter the reference check")
	}
	if _, exists := group.deletedBlockIDs[""]; exists {
		t.Fatal("an empty blocktree ID should not enter the deleted block set")
	}
	if _, exists := group.blockIDs["valid-child"]; !exists {
		t.Fatal("a valid descendant should enter the reference check")
	}
	if _, exists := group.deletedBlockIDs["valid-child"]; !exists {
		t.Fatal("a valid deleted descendant should enter the deleted block set")
	}
}
