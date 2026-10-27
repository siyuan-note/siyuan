// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocIALMissingFileIsNotCorruption(t *testing.T) {
	const child = "SIYUAN_TEST_MISSING_DOC_IAL"
	if os.Getenv(child) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestDocIALMissingFileIsNotCorruption$", "-test.v")
		cmd.Env = append(os.Environ(), child+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("missing document subprocess failed: %v\n%s", err, output)
		}
		if bytes.Contains(output, []byte("properties not found")) || bytes.Contains(output, []byte("copy corrupted data file")) {
			t.Fatalf("deleted document was treated as corrupted:\n%s", output)
		}
		return
	}
	fixture := setupFileOperationTest(t)
	util.WorkspaceDir = t.TempDir()
	const missing = "/20260718000009-abcdefg.sy"
	if attrs := fixture.box.docIAL(missing); attrs != nil {
		t.Fatalf("missing document returned attributes: %v", attrs)
	}
	fixture.box.moveCorruptedData(filepath.Join(util.DataDir, fixture.box.ID, missing))
}

func TestDocIALCorruptedFileRemainsRecoverable(t *testing.T) {
	fixture := setupFileOperationTest(t)
	originalWorkspace := util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	t.Cleanup(func() { util.WorkspaceDir = originalWorkspace })
	const document = "/20260718000009-abcdefg.sy"
	filePath := filepath.Join(util.DataDir, fixture.box.ID, document)
	raw := []byte(`{"Type":"NodeDocument","broken":`)
	if err := os.WriteFile(filePath, raw, 0644); err != nil {
		t.Fatal(err)
	}
	if attrs := fixture.box.docIAL(document); attrs != nil {
		t.Fatalf("corrupted document returned attributes: %v", attrs)
	}
	backups, err := filepath.Glob(filepath.Join(util.WorkspaceDir, "corrupted", "*", fixture.box.ID, filepath.Base(document)))
	if err != nil || len(backups) != 1 {
		t.Fatalf("expected one recoverable backup, got %v, %v", backups, err)
	}
	backup, err := os.ReadFile(backups[0])
	if err != nil || !bytes.Equal(backup, raw) {
		t.Fatalf("original corrupted bytes were not preserved: %q, %v", backup, err)
	}
}

func TestDocIALReadFailureDoesNotMoveData(t *testing.T) {
	fixture := setupFileOperationTest(t)
	originalWorkspace := util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	t.Cleanup(func() { util.WorkspaceDir = originalWorkspace })
	const document = "/20260718000009-abcdefg.sy"
	filePath := filepath.Join(util.DataDir, fixture.box.ID, document)
	if err := os.Mkdir(filePath, 0755); err != nil {
		t.Fatal(err)
	}
	payload := filepath.Join(filePath, "original")
	if err := os.WriteFile(payload, []byte("preserved"), 0644); err != nil {
		t.Fatal(err)
	}
	if attrs := fixture.box.docIAL(document); attrs != nil {
		t.Fatalf("unreadable document returned attributes: %v", attrs)
	}
	if raw, err := os.ReadFile(payload); err != nil || string(raw) != "preserved" {
		t.Fatalf("unreadable data was moved: %q, %v", raw, err)
	}
	if _, err := os.Stat(filepath.Join(util.WorkspaceDir, "corrupted")); !os.IsNotExist(err) {
		t.Fatalf("read failure created a corruption backup: %v", err)
	}
}

func TestCorruptedBackupsPreserveSameNamedFiles(t *testing.T) {
	previousWorkspace := util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	t.Cleanup(func() { util.WorkspaceDir = previousWorkspace })
	box := &Box{ID: "20261026000000-box0001"}
	sources := t.TempDir()
	want := map[string]bool{"first original": true, "second original": true, "recreated original": true}
	for i, content := range []string{"first original", "second original", "recreated original"} {
		dir := filepath.Join(sources, "a")
		if i == 1 {
			dir = filepath.Join(sources, "b")
		}
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		source := filepath.Join(dir, "invalid.sy")
		if err := os.WriteFile(source, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		box.moveCorruptedData(source)
		if _, err := os.Stat(source); !os.IsNotExist(err) {
			t.Fatalf("backed-up source was not removed: %v", err)
		}
	}
	backups, err := filepath.Glob(filepath.Join(util.WorkspaceDir, "corrupted", "*", box.ID, "invalid.sy"))
	if err != nil || len(backups) != len(want) {
		t.Fatalf("expected independent backups: %v, %v", backups, err)
	}
	for _, backup := range backups {
		data, err := os.ReadFile(backup)
		if err != nil || !want[string(data)] {
			t.Fatalf("lost or overwritten recovery bytes: %q, %v", data, err)
		}
		delete(want, string(data))
	}
}

func TestCorruptedBackupFailureKeepsSource(t *testing.T) {
	previousWorkspace := util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	t.Cleanup(func() { util.WorkspaceDir = previousWorkspace })
	if err := os.WriteFile(filepath.Join(util.WorkspaceDir, "corrupted"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "invalid.sy")
	const original = "original bytes"
	if err := os.WriteFile(source, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	(&Box{ID: "20261026000000-box0001"}).moveCorruptedData(source)
	if data, err := os.ReadFile(source); err != nil || string(data) != original {
		t.Fatalf("failed quarantine changed its source: %q, %v", data, err)
	}
}
