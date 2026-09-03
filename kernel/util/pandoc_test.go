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
	"archive/zip"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestPandocZipPath(t *testing.T) {
	pandocDir := filepath.Join("resources", "pandoc")
	tests := []struct {
		name   string
		goos   string
		goarch string
		want   string
	}{
		{name: "Windows AMD64", goos: "windows", goarch: "amd64", want: "pandoc-windows-amd64.zip"},
		{name: "Windows ARM64", goos: "windows", goarch: "arm64"},
		{name: "Darwin AMD64", goos: "darwin", goarch: "amd64", want: "pandoc-darwin-amd64.zip"},
		{name: "Darwin ARM64", goos: "darwin", goarch: "arm64", want: "pandoc-darwin-arm64.zip"},
		{name: "Linux AMD64", goos: "linux", goarch: "amd64", want: "pandoc-linux-amd64.zip"},
		{name: "Linux ARM64", goos: "linux", goarch: "arm64", want: "pandoc-linux-arm64.zip"},
		{name: "Unsupported OS", goos: "freebsd", goarch: "amd64"},
		{name: "Unsupported architecture", goos: "linux", goarch: "386"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := pandocZipPath(pandocDir, test.goos, test.goarch)
			if "" == test.want {
				if "" != got {
					t.Fatalf("unexpected Pandoc archive path: %q", got)
				}
				return
			}
			want := filepath.Join(pandocDir, test.want)
			if want != got {
				t.Fatalf("Pandoc archive path: got %q, want %q", got, want)
			}
		})
	}
}

func TestInitPandocExtractsDevelopmentArchive(t *testing.T) {
	root := preparePandocTest(t)
	installedPandocDir := filepath.Join(WorkingDir, "pandoc")
	installedPandocBin := pandocBinPath(installedPandocDir)
	if "" == installedPandocBin {
		t.Skip("Pandoc is not supported on this platform")
	}
	pandocZip := pandocZipPath(installedPandocDir, runtime.GOOS, runtime.GOARCH)
	if "" == pandocZip {
		t.Skip("Pandoc archive is not available on this platform")
	}
	writePandocTestArchive(t, pandocZip, installedPandocBin, []byte("test-pandoc"))

	initPandoc("", func(binPath string) string {
		data, err := os.ReadFile(binPath)
		if nil == err && "test-pandoc" == string(data) {
			return "test"
		}
		return ""
	})

	if runtimeState := GetPandocRuntime(); installedPandocBin != runtimeState.BinPath {
		t.Fatalf("built-in Pandoc path: got %q, want %q", runtimeState.BinPath, installedPandocBin)
	}
	if data, err := os.ReadFile(installedPandocBin); nil != err || "test-pandoc" != string(data) {
		t.Fatalf("read extracted Pandoc executable failed: %v", err)
	}
	if "windows" != runtime.GOOS {
		info, err := os.Stat(installedPandocBin)
		if nil != err {
			t.Fatal(err)
		}
		if 0 == info.Mode().Perm()&0111 {
			t.Fatalf("extracted Pandoc executable is not executable: %v", info.Mode())
		}
	}
	if _, err := os.Stat(filepath.Join(root, "temp", "pandoc")); !os.IsNotExist(err) {
		t.Fatalf("Pandoc was extracted into the workspace temporary directory: %v", err)
	}
}

func TestInitPandocDoesNotUseWorkspaceTemp(t *testing.T) {
	preparePandocTest(t)
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

func preparePandocTest(t *testing.T) string {
	t.Helper()
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
	return root
}

func writePandocTestArchive(t *testing.T, archivePath, binPath string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(archivePath), 0755); nil != err {
		t.Fatal(err)
	}
	archive, err := os.Create(archivePath)
	if nil != err {
		t.Fatal(err)
	}
	zipWriter := zip.NewWriter(archive)
	relativeBinPath, err := filepath.Rel(filepath.Dir(archivePath), binPath)
	if nil != err {
		t.Fatal(err)
	}
	bin, err := zipWriter.Create(filepath.ToSlash(relativeBinPath))
	if nil != err {
		t.Fatal(err)
	}
	if _, err = bin.Write(data); nil != err {
		t.Fatal(err)
	}
	if err = zipWriter.Close(); nil != err {
		t.Fatal(err)
	}
	if err = archive.Close(); nil != err {
		t.Fatal(err)
	}
}
