// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
