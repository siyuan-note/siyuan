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

package bazaar

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExtractLocalPackage(t *testing.T) {
	tests := []struct {
		name         string
		files        map[string]string
		wantType     string
		wantName     string
		wantError    bool
		wantRootBase string
	}{
		{
			name:         "manifest at archive root",
			files:        map[string]string{"plugin.json": `{"name":"sample-plugin","version":"1.0.0"}`, "index.js": ""},
			wantType:     "plugins",
			wantName:     "sample-plugin",
			wantRootBase: "local",
		},
		{
			name:         "manifest in wrapper directory",
			files:        map[string]string{"sample-hash/theme.json": `{"name":"sample-theme","version":"1.0.0"}`},
			wantType:     "themes",
			wantName:     "sample-theme",
			wantRootBase: "sample-hash",
		},
		{
			name:         "icon package",
			files:        map[string]string{"icon.json": `{"name":"sample-icon","version":"1.0.0"}`},
			wantType:     "icons",
			wantName:     "sample-icon",
			wantRootBase: "local",
		},
		{
			name:         "template package",
			files:        map[string]string{"template/template.json": `{"name":"sample-template","version":"1.0.0"}`},
			wantType:     "templates",
			wantName:     "sample-template",
			wantRootBase: "template",
		},
		{
			name:         "widget package",
			files:        map[string]string{"widget.json": `{"name":"sample-widget","version":"1.0.0"}`},
			wantType:     "widgets",
			wantName:     "sample-widget",
			wantRootBase: "local",
		},
		{
			name:      "multiple manifests",
			files:     map[string]string{"plugin.json": `{"name":"sample"}`, "theme.json": `{"name":"sample"}`},
			wantError: true,
		},
		{
			name:      "manifest nested too deeply",
			files:     map[string]string{"wrapper/package/plugin.json": `{"name":"sample"}`},
			wantError: true,
		},
		{
			name:      "multiple top-level entries without root manifest",
			files:     map[string]string{"wrapper/plugin.json": `{"name":"sample"}`, "README.md": ""},
			wantError: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			archivePath := filepath.Join(t.TempDir(), "package.zip")
			writeLocalPackageArchive(t, archivePath, test.files)
			pkgType, pkg, packagePath, cleanup, err := ExtractLocalPackage(archivePath)
			if cleanup != nil {
				defer cleanup()
			}
			if test.wantError {
				if err == nil {
					t.Fatal("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("extract local package failed: %s", err)
			}
			if pkgType != test.wantType || pkg.Name != test.wantName {
				t.Fatalf("expected %s package %q, got %s package %q", test.wantType, test.wantName, pkgType, pkg.Name)
			}
			if test.wantRootBase == "local" {
				if filepath.Base(filepath.Dir(packagePath)) != "local" {
					t.Fatalf("expected archive root, got %q", packagePath)
				}
			} else if filepath.Base(packagePath) != test.wantRootBase {
				t.Fatalf("expected package root %q, got %q", test.wantRootBase, packagePath)
			}
		})
	}
}

func TestExtractLocalPackageRejectsTraversal(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "package.zip")
	writeLocalPackageArchive(t, archivePath, map[string]string{
		"plugin.json": `{"name":"sample"}`,
		"../outside":  "unsafe",
	})
	_, _, _, cleanup, err := ExtractLocalPackage(archivePath)
	if cleanup != nil {
		defer cleanup()
	}
	if err == nil {
		t.Fatal("expected path traversal to be rejected")
	}
}

func TestExtractLocalPackageRejectsSymlink(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "package.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	manifest, err := writer.Create("plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = manifest.Write([]byte(`{"name":"sample"}`)); err != nil {
		t.Fatal(err)
	}
	header := &zip.FileHeader{Name: "link"}
	header.SetMode(os.ModeSymlink | 0777)
	link, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = link.Write([]byte("target")); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}

	_, _, _, cleanup, err := ExtractLocalPackage(archivePath)
	if cleanup != nil {
		defer cleanup()
	}
	if err == nil {
		t.Fatal("expected symbolic link to be rejected")
	}
}

func TestInstallLocalPackageReplacesDirectory(t *testing.T) {
	oldDataDir := util.DataDir
	bazaarInfoCacheLock.Lock()
	oldCache := bazaarInfoCache
	oldModTime := bazaarInfoModTime
	bazaarInfoCache = nil
	bazaarInfoModTime = time.Time{}
	bazaarInfoCacheLock.Unlock()
	root := t.TempDir()
	util.DataDir = filepath.Join(root, "data")
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		bazaarInfoCacheLock.Lock()
		bazaarInfoCache = oldCache
		bazaarInfoModTime = oldModTime
		bazaarInfoCacheLock.Unlock()
	})

	sourcePath := filepath.Join(root, "source")
	installPath := filepath.Join(root, "plugins", "sample")
	if err := os.MkdirAll(sourcePath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(installPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "plugin.json"), []byte(`{"name":"sample","version":"2.0.0"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "new.js"), []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installPath, "stale.js"), []byte("stale"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := InstallLocalPackage(sourcePath, installPath, "plugins", "sample", true); err != nil {
		t.Fatalf("install local package failed: %s", err)
	}
	if _, err := os.Stat(filepath.Join(installPath, "new.js")); err != nil {
		t.Fatalf("new package file is missing: %s", err)
	}
	if _, err := os.Stat(filepath.Join(installPath, "stale.js")); !os.IsNotExist(err) {
		t.Fatalf("stale package file was not removed: %v", err)
	}
	entries, err := os.ReadDir(filepath.Dir(installPath))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "sample" {
		t.Fatalf("temporary installation directory was not cleaned up: %#v", entries)
	}
}

func writeLocalPackageArchive(t *testing.T, archivePath string, files map[string]string) {
	t.Helper()
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, content := range files {
		entry, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, writeErr := entry.Write([]byte(content)); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
}
