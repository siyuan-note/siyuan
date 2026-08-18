// SiYuan - From thought to insight, with agents
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
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGenerateDocHistorySkipsRemovedSource(t *testing.T) {
	fixture := setupFileOperationTest(t)
	sourceFile := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	if err := os.Remove(sourceFile); err != nil {
		t.Fatalf("remove source document failed: %v", err)
	}

	if err := generateDocHistoryFile(fixture.box.ID, sourceFile, t.TempDir(), util.NewLute()); err != nil {
		t.Fatalf("generate history for removed source failed: %v", err)
	}
}

func TestGenerateDocHistoryFromDataDoesNotReopenRemovedSource(t *testing.T) {
	fixture := setupFileOperationTest(t)
	sourceFile := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	data, err := filelock.ReadFile(sourceFile)
	if err != nil {
		t.Fatalf("read source document failed: %v", err)
	}
	if err = os.Remove(sourceFile); err != nil {
		t.Fatalf("remove source document failed: %v", err)
	}

	historyDir := t.TempDir()
	if err = generateDocHistoryFromData(fixture.box.ID, sourceFile, historyDir, data, util.NewLute()); err != nil {
		t.Fatalf("generate history from captured data failed: %v", err)
	}
	historyPath := filepath.Join(historyDir, fixture.box.ID, strings.TrimPrefix(sourceFile,
		filepath.Join(util.DataDir, fixture.box.ID)))
	historyData, err := filelock.ReadFile(historyPath)
	if err != nil {
		t.Fatalf("read generated history failed: %v", err)
	}
	if !bytes.Equal(historyData, data) {
		t.Fatal("generated history differs from captured source data")
	}
}

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

func TestRollbackNotebookHistoryKeepsNotebookClosed(t *testing.T) {
	historyPath, boxID := setupNotebookHistoryRollbackTest(t)
	if err := RollbackNotebookHistory(historyPath); err != nil {
		t.Fatalf("rollback notebook history failed: %v", err)
	}

	restoredConf := (&Box{ID: boxID}).GetConf()
	if !restoredConf.Closed {
		t.Fatal("restored notebook should remain closed")
	}
	if !filelock.IsExist(filepath.Join(util.DataDir, boxID, "20260807000001-abcdefg.sy")) {
		t.Fatal("restored notebook document does not exist")
	}
}

func TestRollbackNotebookHistoryRejectsExistingNotebook(t *testing.T) {
	historyPath, boxID := setupNotebookHistoryRollbackTest(t)
	destination := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(destination, 0755); err != nil {
		t.Fatalf("create existing notebook failed: %v", err)
	}
	markerPath := filepath.Join(destination, "marker")
	if err := os.WriteFile(markerPath, []byte("existing"), 0644); err != nil {
		t.Fatalf("write existing notebook marker failed: %v", err)
	}

	if err := RollbackNotebookHistory(historyPath); err == nil {
		t.Fatal("rollback should reject an existing notebook")
	}
	data, err := os.ReadFile(markerPath)
	if err != nil {
		t.Fatalf("read existing notebook marker failed: %v", err)
	}
	if string(data) != "existing" {
		t.Fatalf("existing notebook was modified: %q", data)
	}
}

func setupNotebookHistoryRollbackTest(t *testing.T) (historyPath, boxID string) {
	originalConf := Conf
	originalWorkspaceDir := util.WorkspaceDir
	originalDataDir := util.DataDir
	originalHistoryDir := util.HistoryDir
	tempDir := t.TempDir()
	util.WorkspaceDir = tempDir
	util.DataDir = filepath.Join(tempDir, "data")
	util.HistoryDir = filepath.Join(tempDir, "history")
	Conf = NewAppConf()
	Conf.Sync = conf.NewSync()
	t.Cleanup(func() {
		Conf = originalConf
		util.WorkspaceDir = originalWorkspaceDir
		util.DataDir = originalDataDir
		util.HistoryDir = originalHistoryDir
	})

	boxID = "20260807000000-abcdefg"
	relHistoryPath := filepath.Join("history", "2026-08-07-120000-delete", boxID)
	historyPath = filepath.Join(util.WorkspaceDir, relHistoryPath)
	if err := os.MkdirAll(filepath.Join(historyPath, ".siyuan"), 0755); err != nil {
		t.Fatalf("create notebook history failed: %v", err)
	}
	boxConf := []byte(`{"name":"Rollback test","closed":true}`)
	if err := os.WriteFile(filepath.Join(historyPath, ".siyuan", "conf.json"), boxConf, 0644); err != nil {
		t.Fatalf("write notebook history configuration failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(historyPath, "20260807000001-abcdefg.sy"), []byte("{}"), 0644); err != nil {
		t.Fatalf("write notebook history document failed: %v", err)
	}
	return filepath.ToSlash(strings.TrimPrefix(historyPath, util.WorkspaceDir)), boxID
}
