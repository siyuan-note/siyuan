// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package cmd

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMaterializeExportArtifact(t *testing.T) {
	tempDir := t.TempDir()
	originalTempDir := util.TempDir
	util.TempDir = tempDir
	defer func() {
		util.TempDir = originalTempDir
	}()

	exportDir := filepath.Join(tempDir, "export")
	if err := os.MkdirAll(exportDir, 0755); err != nil {
		t.Fatal(err)
	}
	name := "artifact with spaces.zip"
	source := filepath.Join(exportDir, name)
	content := []byte("export content")
	if err := os.WriteFile(source, content, 0644); err != nil {
		t.Fatal(err)
	}
	exportPath := "/export/" + url.PathEscape(name)

	actualPath, err := materializeExportArtifact(exportPath, "")
	if err != nil {
		t.Fatal(err)
	}
	if actualPath != source {
		t.Fatalf("unexpected artifact path: got %q, want %q", actualPath, source)
	}

	target := filepath.Join(tempDir, "target.zip")
	resultPath, err := materializeExportArtifact(exportPath, target)
	if err != nil {
		t.Fatal(err)
	}
	if resultPath != target {
		t.Fatalf("unexpected result path: got %q, want %q", resultPath, target)
	}
	copied, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(copied) != string(content) {
		t.Fatalf("unexpected copied content: got %q, want %q", copied, content)
	}
}

func TestMaterializeExportArtifactRejectsEmptyPath(t *testing.T) {
	if _, err := materializeExportArtifact("", ""); err == nil {
		t.Fatal("expected empty export path to fail")
	}
}
