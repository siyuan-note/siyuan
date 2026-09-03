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
	"os"
	"path/filepath"
	"testing"

	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRemoveEmptyPackageDirs(t *testing.T) {
	basePath := t.TempDir()
	emptyPath := filepath.Join(basePath, "empty", "i18n")
	nonEmptyPath := filepath.Join(basePath, "non-empty", "i18n")
	if err := os.MkdirAll(emptyPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(nonEmptyPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nonEmptyPath, "en_US.json"), nil, 0644); err != nil {
		t.Fatal(err)
	}

	removeEmptyPackageDirs(basePath, hashset.New("empty", "non-empty", "missing"))

	if _, err := os.Stat(filepath.Join(basePath, "empty")); !os.IsNotExist(err) {
		t.Fatalf("expected empty package directory to be removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(nonEmptyPath, "en_US.json")); err != nil {
		t.Fatalf("expected non-empty package directory to be preserved: %s", err)
	}
}

func TestCleanupSyncedBoxResidualsBacksUpFilesBeforeRemoval(t *testing.T) {
	oldDataDir, oldHistoryDir := util.DataDir, util.HistoryDir
	workspaceDir := t.TempDir()
	util.DataDir = filepath.Join(workspaceDir, "data")
	util.HistoryDir = filepath.Join(workspaceDir, "history")
	t.Cleanup(func() {
		util.DataDir, util.HistoryDir = oldDataDir, oldHistoryDir
	})

	boxID := "20260903120700-xyzabcd"
	boxDirPath := filepath.Join(util.DataDir, boxID)
	docPath := filepath.Join(boxDirPath, "20260903120800-efghijk.sy")
	if err := os.MkdirAll(filepath.Dir(docPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(docPath, []byte("residual document"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(boxDirPath, ".DS_Store"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	documentlessBoxID := "20260903120900-lmnopqr"
	documentlessBoxPath := filepath.Join(util.DataDir, documentlessBoxID)
	if err := os.MkdirAll(filepath.Join(documentlessBoxPath, "20260903121000-stuvwxy"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(documentlessBoxPath, ".DS_Store"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	unconfirmedBoxID := "20260903121100-zabcdef"
	unconfirmedDocPath := filepath.Join(util.DataDir, unconfirmedBoxID, "20260903121200-ghijklm.sy")
	if err := os.MkdirAll(filepath.Dir(unconfirmedDocPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(unconfirmedDocPath, []byte("unconfirmed document"), 0644); err != nil {
		t.Fatal(err)
	}

	cleanupSyncedBoxResiduals(map[string]bool{boxID: true})

	if _, err := os.Stat(boxDirPath); !os.IsNotExist(err) {
		t.Fatalf("expected synced box residual to be removed: %v", err)
	}
	historyDocs, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-delete", boxID, filepath.Base(docPath)))
	if err != nil {
		t.Fatal(err)
	}
	if 1 != len(historyDocs) {
		t.Fatalf("expected one residual document backup, got %v", historyDocs)
	}
	data, err := os.ReadFile(historyDocs[0])
	if err != nil {
		t.Fatal(err)
	}
	if "residual document" != string(data) {
		t.Fatalf("unexpected residual document backup: %q", data)
	}
	if _, err = os.Stat(documentlessBoxPath); !os.IsNotExist(err) {
		t.Fatalf("expected documentless synced box residual to be removed: %v", err)
	}
	if _, err = os.Stat(unconfirmedDocPath); err != nil {
		t.Fatalf("expected unconfirmed notebook documents to be preserved: %v", err)
	}
}
