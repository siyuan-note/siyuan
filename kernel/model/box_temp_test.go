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

	clearWorkspaceTemp(false)

	if _, err := os.Stat(pandocDir); !os.IsNotExist(err) {
		t.Fatalf("legacy Pandoc temporary directory was not removed on exit: %v", err)
	}
}
