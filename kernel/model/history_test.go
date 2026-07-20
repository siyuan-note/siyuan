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
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetRollbackDocPathTreatsBoxDocAsRoot(t *testing.T) {
	fixture := setupFileOperationTest(t)
	boxDocTree := treenode.NewTree(fixture.box.ID, boxDocPath(fixture.box.ID), "/", "Box document")
	treenode.UpsertBlockTree(boxDocTree)
	t.Cleanup(func() {
		treenode.RemoveBlockTreesByRootID(fixture.box.ID, boxDocTree.ID)
	})

	documentID := "20260720000003-abcdefg"
	historyPath := filepath.Join(t.TempDir(), "2026-07-20-120000-delete", fixture.box.ID, documentID+".sy")
	destPath, parentHPath, err := getRollbackDockPath(fixture.box.ID, historyPath, nil)
	if err != nil {
		t.Fatalf("get rollback document path failed: %v", err)
	}
	expectedPath := filepath.Join(util.DataDir, fixture.box.ID, documentID+".sy")
	if destPath != expectedPath {
		t.Fatalf("unexpected rollback document path: got %q, want %q", destPath, expectedPath)
	}
	if parentHPath != "" {
		t.Fatalf("unexpected rollback parent human-readable path: %q", parentHPath)
	}
}

func TestGetRollbackDocPathPreservesOrdinaryParent(t *testing.T) {
	fixture := setupFileOperationTest(t)

	documentID := "20260720000004-abcdefg"
	parentID := strings.TrimSuffix(filepath.Base(fixture.targetPath), ".sy")
	historyPath := filepath.Join(t.TempDir(), "2026-07-20-120000-delete", fixture.box.ID, parentID, documentID+".sy")
	destPath, parentHPath, err := getRollbackDockPath(fixture.box.ID, historyPath, nil)
	if err != nil {
		t.Fatalf("get rollback document path failed: %v", err)
	}
	expectedPath := filepath.Join(util.DataDir, fixture.box.ID, strings.TrimSuffix(fixture.targetPath, ".sy"), documentID+".sy")
	if destPath != expectedPath {
		t.Fatalf("unexpected rollback document path: got %q, want %q", destPath, expectedPath)
	}
	if parentHPath != "/Target" {
		t.Fatalf("unexpected rollback parent human-readable path: got %q, want %q", parentHPath, "/Target")
	}
}
