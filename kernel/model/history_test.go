// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCreateAssetsHistorySkipsRemovedSource(t *testing.T) {
	originalDataDir, originalHistoryDir := util.DataDir, util.HistoryDir
	util.DataDir, util.HistoryDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() {
		util.DataDir, util.HistoryDir = originalDataDir, originalHistoryDir
	})

	missing := filepath.Join(util.DataDir, "assets", "removed.png")
	if err := createAssetsHistory([]string{missing}); err != nil {
		t.Fatalf("generate history for removed asset failed: %v", err)
	}
	if err := CreateAssetHistory("assets/removed.png"); !os.IsNotExist(err) {
		t.Fatalf("explicit history request should report missing source, got %v", err)
	}
}

func TestRollbackAssetsHistoryPreservesRelativePaths(t *testing.T) {
	_, boxID := setupNotebookHistoryRollbackTest(t)
	boxDir := filepath.Join(util.DataDir, boxID, ".siyuan")
	if err := os.MkdirAll(boxDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(boxDir, "conf.json"), []byte(`{"name":"Assets"}`), 0644); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"assets/report.pdf", "assets/projects/2026/report.pdf",
		boxID + "/assets/report.pdf", boxID + "/20261026000000-parent1/assets/sub/report.pdf"} {
		t.Run(rel, func(t *testing.T) {
			rootAsset := filepath.Join(util.DataDir, "assets", "report.pdf")
			if err := os.MkdirAll(filepath.Dir(rootAsset), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(rootAsset, []byte("unrelated global asset"), 0644); err != nil {
				t.Fatal(err)
			}
			historyRel := filepath.Join("history", "2026-10-26-120000-clean", filepath.FromSlash(rel))
			historyFile := filepath.Join(util.WorkspaceDir, historyRel)
			if err := os.MkdirAll(filepath.Dir(historyFile), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(historyFile, []byte("restored version"), 0644); err != nil {
				t.Fatal(err)
			}
			if err := RollbackAssetsHistory(filepath.ToSlash(historyRel)); err != nil {
				t.Fatal(err)
			}
			destination := filepath.Join(util.DataDir, filepath.FromSlash(rel))
			if data, err := os.ReadFile(destination); err != nil || string(data) != "restored version" {
				t.Fatalf("asset restored to wrong location: %q, %v", data, err)
			}
			if destination != rootAsset {
				if data, err := os.ReadFile(rootAsset); err != nil || string(data) != "unrelated global asset" {
					t.Fatalf("unrelated asset overwritten: %q, %v", data, err)
				}
			}
		})
	}
	for _, parts := range [][]string{{"snapshot", "storage", "av/view.json"},
		{"snapshot", "assets", "../outside"}, {"snapshot", boxID, "file.sy"},
		{"snapshot", "20261026000000-absent1", "assets/file.pdf"}} {
		if _, err := ordinaryAssetHistoryDestination(parts); err == nil {
			t.Fatalf("accepted invalid or unavailable asset location: %v", parts)
		}
	}
}

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

func TestRollbackNotebookHistoryCopyFailureAllowsRetry(t *testing.T) {
	historyPath, boxID := setupNotebookHistoryRollbackTest(t)
	destination := filepath.Join(util.DataDir, boxID)
	failure := errors.New("injected partial notebook copy failure")
	err := rollbackNotebookHistory(historyPath, func(from, staging string) error {
		if err := os.WriteFile(filepath.Join(staging, "partial.sy"), []byte("partial copy"), 0600); err != nil {
			t.Fatal(err)
		}
		return failure
	})
	if !errors.Is(err, failure) {
		t.Fatalf("copy failure was not returned: %v", err)
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatalf("failed restore published an incomplete notebook: %v", err)
	}
	if paths, err := filepath.Glob(filepath.Join(util.DataDir, ".notebook-history-*")); err != nil || len(paths) != 0 {
		t.Fatalf("failed restore left staging directories: %v, %v", paths, err)
	}
	if err := RollbackNotebookHistory(historyPath); err != nil {
		t.Fatalf("restoration could not be retried: %v", err)
	}
	if _, err := os.Stat(filepath.Join(destination, "20260807000001-abcdefg.sy")); err != nil {
		t.Fatal(err)
	}
}

func TestRollbackNotebookHistoryPreservesNewDestination(t *testing.T) {
	historyPath, boxID := setupNotebookHistoryRollbackTest(t)
	destination := filepath.Join(util.DataDir, boxID)
	marker := filepath.Join(destination, "preserved.txt")
	err := rollbackNotebookHistory(historyPath, func(from, staging string) error {
		if err := filelock.CopyNewtimes(from, staging); err != nil {
			return err
		}
		if err := os.MkdirAll(destination, 0755); err != nil {
			return err
		}
		return os.WriteFile(marker, []byte("concurrent destination"), 0600)
	})
	if err == nil {
		t.Fatal("restore replaced a destination created during copying")
	}
	if data, err := os.ReadFile(marker); err != nil || string(data) != "concurrent destination" {
		t.Fatal("restore modified an existing destination")
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
	Conf.Sync.Store(conf.NewSync())
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
