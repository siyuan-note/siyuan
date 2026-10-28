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

	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentAddressingWholeNotebookDeletionRetainsRecoveryData(t *testing.T) {
	fixture := setupFileOperationTest(t)
	oldTemp, oldHistory, oldWorkspace := util.TempDir, util.HistoryDir, util.WorkspaceDir
	util.TempDir, util.HistoryDir = t.TempDir(), t.TempDir()
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	t.Cleanup(func() { util.TempDir, util.HistoryDir, util.WorkspaceDir = oldTemp, oldHistory, oldWorkspace })
	setupNotebookDocumentImportDatabase(t)
	boxID := fixture.box.ID
	source := []byte(`{"Spec":"999","Properties":{"title":"Future"}}`)
	config := []byte(`{"name":"future","closed":true,"documentAddressingVersion":3}`)
	if err := os.WriteFile(filepath.Join(util.DataDir, boxID, documentaddressing.ConfigPath), config, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.DataDir, boxID, fixture.sourcePath), source, 0644); err != nil {
		t.Fatal(err)
	}
	sharedDir := filepath.Join(util.DataDir, "storage", "av")
	if err := os.MkdirAll(sharedDir, 0755); err != nil {
		t.Fatal(err)
	}
	shared := []byte("unparsed shared database")
	if err := os.WriteFile(filepath.Join(sharedDir, "20261022000200-abcdefg.json"), shared, 0644); err != nil {
		t.Fatal(err)
	}
	if err := RemoveBox(boxID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, boxID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("notebook was not deleted")
	}
	paths, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-delete", boxID))
	if err != nil || len(paths) != 1 {
		t.Fatalf("missing recovery data: %v, %v", paths, err)
	}
	for name, want := range map[string][]byte{documentaddressing.ConfigPath: config, fixture.sourcePath: source} {
		actual, readErr := os.ReadFile(filepath.Join(paths[0], name))
		if readErr != nil || !bytes.Equal(actual, want) {
			t.Fatalf("history changed %s: %q, %v", name, actual, readErr)
		}
	}
	sharedHistory := filepath.Join(filepath.Dir(paths[0]), "storage", "av", "20261022000200-abcdefg.json")
	if data, readErr := os.ReadFile(sharedHistory); readErr != nil || !bytes.Equal(data, shared) {
		t.Fatalf("shared database recovery data missing: %v", readErr)
	}
	if err = filesys.CheckDocumentAddressing(boxID); err != nil {
		t.Fatalf("retired mode blocked missing notebook: %v", err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, boxID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("floor check recreated deleted notebook")
	}
}
