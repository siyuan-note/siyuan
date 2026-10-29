// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestClearTempFilesRemovesLegacyPandoc(t *testing.T) {
	originalTempDir := util.TempDir
	t.Cleanup(func() {
		util.TempDir = originalTempDir
	})

	util.TempDir = filepath.Join(t.TempDir(), "temp")
	pandocDir := filepath.Join(util.TempDir, "pandoc")
	pandocBin := filepath.Join(pandocDir, "bin", "pandoc")
	if err := os.MkdirAll(filepath.Dir(pandocBin), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pandocBin, []byte("pandoc"), 0644); err != nil {
		t.Fatal(err)
	}

	var count int
	var size int64
	clearTempFiles(&count, &size)

	if _, err := os.Stat(pandocDir); !os.IsNotExist(err) {
		t.Fatalf("legacy Pandoc temporary directory was not removed: %v", err)
	}
	if 1 != count || 6 != size {
		t.Fatalf("unexpected cleanup statistics: count=%d, size=%d", count, size)
	}
}

func TestClearWorkspaceTempRemovesLegacyPandoc(t *testing.T) {
	originalDataDir, originalTempDir, originalWorkspaceDir := util.DataDir, util.TempDir, util.WorkspaceDir
	t.Cleanup(func() {
		util.DataDir, util.TempDir, util.WorkspaceDir = originalDataDir, originalTempDir, originalWorkspaceDir
	})

	workspaceDir := t.TempDir()
	util.DataDir = filepath.Join(workspaceDir, "data")
	util.TempDir = filepath.Join(workspaceDir, "temp")
	util.WorkspaceDir = workspaceDir
	pandocDir := filepath.Join(util.TempDir, "pandoc")
	pandocBin := filepath.Join(pandocDir, "bin", "pandoc")
	if err := os.MkdirAll(filepath.Dir(pandocBin), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pandocBin, []byte("pandoc"), 0644); err != nil {
		t.Fatal(err)
	}

	clearWorkspaceTemp("")

	if _, err := os.Stat(pandocDir); !os.IsNotExist(err) {
		t.Fatalf("legacy Pandoc temporary directory was not removed on exit: %v", err)
	}
}
