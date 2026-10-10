package model

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportSYClearsStaleTempFiles(t *testing.T) {
	const boxID = "20261010000000-box0001"
	const docID = "20261010000001-doc0001"
	setupExportRelatedTest(t, boxID)
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Notes", "Notes")
	writeExportRelatedTestTree(t, tree)
	exportDir := filepath.Join(util.TempDir, "export", "Notes")
	for _, stale := range []string{
		"20261010000002-old0001.sy", "assets/deleted.txt", "storage/av/deleted.json",
		"storage/riff/deleted.json", ".siyuan/sort.json",
	} {
		stalePath := filepath.Join(exportDir, stale)
		if err := os.MkdirAll(filepath.Dir(stalePath), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(stalePath, []byte("stale"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	archivePath := exportSYZip(boxID, "/", "Notes", []string{tree.Path}, false)
	if archivePath != "/export/Notes.sy.zip" {
		t.Fatalf("download filename changed: %q", archivePath)
	}
	archive := openExportArchive(t, archivePath)
	if findArchiveFile(archive.File, "Notes/"+docID+".sy") == nil {
		t.Fatal("current document missing from export")
	}
	for _, entry := range archive.File {
		if entry.Name != "Notes/" && entry.Name != "Notes/"+docID+".sy" {
			t.Fatalf("stale entry included in archive: %s", entry.Name)
		}
	}
	if _, err := os.Stat(exportDir); !os.IsNotExist(err) {
		t.Fatalf("successful export retained temp files: %v", err)
	}
}

func TestExportSYConcurrentSameName(t *testing.T) {
	const boxID = "20261010000000-box0001"
	const docID = "20261010000001-doc0001"
	setupExportRelatedTest(t, boxID)
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Notes", "Notes")
	writeExportRelatedTestTree(t, tree)
	results := make(chan string, 4)
	for i := 0; i < cap(results); i++ {
		go func() {
			results <- exportSYZip(boxID, "/", "Notes", []string{tree.Path}, false)
		}()
	}
	for i := 0; i < cap(results); i++ {
		select {
		case archivePath := <-results:
			if archivePath != "/export/Notes.sy.zip" {
				t.Errorf("concurrent export failed: %q", archivePath)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("concurrent exports did not complete")
		}
	}
	archive := openExportArchive(t, "/export/Notes.sy.zip")
	if findArchiveFile(archive.File, "Notes/"+docID+".sy") == nil {
		t.Fatal("concurrent export archive is incomplete")
	}
}

func TestExportSYFailureCleansTempFilesAndAllowsRetry(t *testing.T) {
	const boxID = "20261010000000-box0001"
	const docID = "20261010000001-doc0001"
	setupExportRelatedTest(t, boxID)
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Notes", "Notes")
	writeExportRelatedTestTree(t, tree)
	exportDir := filepath.Join(util.TempDir, "export", "Notes")
	partialPath := exportDir + ".sy.zip.partial"
	if err := os.MkdirAll(partialPath, 0755); err != nil {
		t.Fatal(err)
	}
	if archivePath := exportSYZip(boxID, "/", "Notes", []string{tree.Path}, false); archivePath != "" {
		t.Fatalf("expected zip creation failure, got %q", archivePath)
	}
	if _, err := os.Stat(exportDir); !os.IsNotExist(err) {
		t.Fatalf("failed export retained temp files: %v", err)
	}
	if archivePath := exportSYZip(boxID, "/", "Notes", []string{tree.Path}, false); archivePath == "" {
		t.Fatal("export did not recover after failure")
	}
}
