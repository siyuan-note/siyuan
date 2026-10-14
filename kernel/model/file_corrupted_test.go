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
