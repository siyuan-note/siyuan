package model

import (
	"archive/zip"
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestImportSYEmojiConflictPreservesWorkspace(t *testing.T) {
	boxID, docPath := setupUnusedAssetWorkspace(t)
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := (&Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(util.DataDir, "emojis", "ok.png")
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{target, docPath} {
		if err := os.WriteFile(p, []byte("existing"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	archivePath := filepath.Join(t.TempDir(), "document.sy.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, data := range map[string]string{
		"Export/20260918000002-doc0002.sy": `{"Type":"NodeDocument","Spec":"5","ID":"20260918000002-doc0002"}`,
		"Export/emojis/ok.png":             "imported",
	} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	for i, importArchive := range []func() error{
		func() error { return ImportSY(archivePath, boxID, "/") },
		func() error { _, _, err := ImportSYAuto(archivePath, boxID, "/"); return err },
		func() error { _, err := ImportSYNotebook(archivePath); return err },
		func() error {
			_, err := importSY0(archivePath, boxID, "/", true, false, map[string]string{}, true)
			return err
		},
	} {
		if err := importArchive(); !errors.Is(err, os.ErrExist) {
			t.Fatalf("archive import %d did not report conflicting emoji: %v", i, err)
		}
		for _, p := range []string{target, docPath} {
			if data, err := os.ReadFile(p); err != nil || string(data) != "existing" {
				t.Fatalf("failed import changed %s: %q %v", p, data, err)
			}
		}
		if data, err := os.ReadFile(archivePath); err != nil || !bytes.Equal(data, original) {
			t.Fatalf("failed import changed source archive: %v", err)
		}
	}
}

func TestImportEmojiFilesPreservesConflictingContent(t *testing.T) {
	previousData := util.DataDir
	util.DataDir = filepath.Join(t.TempDir(), "data")
	t.Cleanup(func() { util.DataDir = previousData })
	root := t.TempDir()
	source := filepath.Join(root, "notebook", "emojis", "ok.png")
	target := filepath.Join(util.DataDir, "emojis", "ok.png")
	for _, p := range []string{source, target} {
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(source, []byte("imported"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("existing"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, checkOnly := range []bool{true, false} {
		if _, err := importEmojiFiles(root, checkOnly); !errors.Is(err, os.ErrExist) {
			t.Fatalf("different content was accepted: %v", err)
		}
		for p, want := range map[string]string{source: "imported", target: "existing"} {
			if data, err := os.ReadFile(p); err != nil || string(data) != want {
				t.Fatalf("conflict changed %s: %q %v", p, data, err)
			}
		}
	}
}

func TestImportEmojiFilesReusesAndCopies(t *testing.T) {
	previousData := util.DataDir
	util.DataDir = filepath.Join(t.TempDir(), "data")
	t.Cleanup(func() { util.DataDir = previousData })
	root := t.TempDir()
	sourceDir := filepath.Join(root, "emojis")
	targetDir := filepath.Join(util.DataDir, "emojis")
	for _, p := range []string{sourceDir, targetDir} {
		if err := os.MkdirAll(p, 0755); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{filepath.Join(sourceDir, "same.png"), filepath.Join(targetDir, "same.png")} {
		if err := os.WriteFile(p, []byte("same"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	target := filepath.Join(targetDir, "same.png")
	modified := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := os.Chtimes(target, modified, modified); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "new.png"), []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := importEmojiFiles(root, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(targetDir, "new.png")); !os.IsNotExist(err) {
		t.Fatalf("preflight copied a file: %v", err)
	}
	if _, err := importEmojiFiles(root, false); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(target); err != nil || !info.ModTime().Equal(modified) {
		t.Fatalf("identical emoji was rewritten: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(targetDir, "new.png")); err != nil || !bytes.Equal(data, []byte("new")) {
		t.Fatalf("new emoji was not copied: %q %v", data, err)
	}
}
