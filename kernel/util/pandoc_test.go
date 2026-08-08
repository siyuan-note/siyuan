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

package util

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInitPandocDoesNotUseWorkspaceTemp(t *testing.T) {
	originalContainer, originalTempDir, originalWorkingDir := Container, TempDir, WorkingDir
	originalRuntime := GetPandocRuntime()
	t.Cleanup(func() {
		Container, TempDir, WorkingDir = originalContainer, originalTempDir, originalWorkingDir
		pandocInitMutex.Lock()
		activePandocRuntime = originalRuntime
		pandocInitMutex.Unlock()
	})

	root := t.TempDir()
	Container = ContainerStd
	TempDir = filepath.Join(root, "temp")
	WorkingDir = filepath.Join(root, "resources")
	legacyPandocDir := filepath.Join(TempDir, "pandoc")
	legacyPandocBin := pandocBinPath(legacyPandocDir)
	if "" == legacyPandocBin {
		t.Skip("Pandoc is not supported on this platform")
	}
	if err := os.MkdirAll(filepath.Dir(legacyPandocBin), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyPandocBin, []byte("legacy"), 0755); err != nil {
		t.Fatal(err)
	}

	InitPandoc("")

	if runtimeState := GetPandocRuntime(); "" != runtimeState.BinPath {
		t.Fatalf("workspace temporary Pandoc was selected: %q", runtimeState.BinPath)
	}
	if _, err := os.Stat(legacyPandocDir); !os.IsNotExist(err) {
		t.Fatalf("legacy Pandoc temporary directory was not removed: %v", err)
	}
}
