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
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetInstalledPackagesReportsPluginStorageData(t *testing.T) {
	originalConf, originalDataDir := Conf, util.DataDir
	Conf, util.DataDir = NewAppConf(), t.TempDir()
	t.Cleanup(func() {
		Conf, util.DataDir = originalConf, originalDataDir
	})

	pluginsPath := filepath.Join(util.DataDir, "plugins")
	for _, name := range []string{"with-data", "empty-data"} {
		pluginPath := filepath.Join(pluginsPath, name)
		if err := os.MkdirAll(pluginPath, 0755); err != nil {
			t.Fatal(err)
		}
		manifest := []byte(`{"name":"` + name + `","version":"1.0.0","minAppVersion":"0.0.1"}`)
		if err := os.WriteFile(filepath.Join(pluginPath, "plugin.json"), manifest, 0644); err != nil {
			t.Fatal(err)
		}
	}
	invalidPath := filepath.Join(pluginsPath, "invalid-package")
	if err := os.MkdirAll(invalidPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(invalidPath, "index.js"), nil, 0644); err != nil {
		t.Fatal(err)
	}

	storageRoot := filepath.Join(util.DataDir, "storage", "petal")
	for _, name := range []string{"with-data", "empty-data", "invalid-package"} {
		if err := os.MkdirAll(filepath.Join(storageRoot, name, "nested"), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(storageRoot, "with-data", "nested", "empty.json"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storageRoot, "invalid-package", "nested", "data.json"), nil, 0644); err != nil {
		t.Fatal(err)
	}

	packages := getInstalledPackages0("plugins", "", "")
	got := make(map[string]*bazaar.Package, len(packages))
	for _, pkg := range packages {
		got[pkg.Name] = pkg
	}
	if len(got) != 3 {
		t.Fatalf("expected three installed packages, got %#v", got)
	}
	if pkg := got["with-data"]; pkg == nil || !pkg.HasStorageData {
		t.Fatal("expected an empty file to mark plugin storage as containing data")
	}
	if pkg := got["empty-data"]; pkg == nil || pkg.HasStorageData {
		t.Fatal("expected a nested empty directory not to mark plugin storage as containing data")
	}
	if pkg := got["invalid-package"]; pkg == nil || !pkg.HasStorageData || pkg.InvalidReason == "" {
		t.Fatal("expected an invalid installed plugin to retain its storage data state")
	}
}

func TestCleanupEmptyPluginStorageDirs(t *testing.T) {
	storageRoot := filepath.Join(t.TempDir(), "storage", "petal")
	for _, relativePath := range []string{
		"empty/nested/deep",
		"nonempty/unused-empty-dir",
		"zero-byte/nested",
		".unmanaged/nested",
	} {
		if err := os.MkdirAll(filepath.Join(storageRoot, filepath.FromSlash(relativePath)), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(storageRoot, "nonempty", "data.json"), []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storageRoot, "zero-byte", "nested", "empty.json"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storageRoot, "petals.json"), []byte("[]"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := cleanupEmptyPluginStorageDirs(storageRoot, bazaar.PackageDirContainsFile); err != nil {
		t.Fatal(err)
	}
	assertPathMissing(t, filepath.Join(storageRoot, "empty"))
	for _, relativePath := range []string{"nonempty", "zero-byte", ".unmanaged", "petals.json"} {
		assertPathExists(t, filepath.Join(storageRoot, relativePath))
	}
}

func TestCleanupEmptyPluginStorageDirsPreservesUnreadableAndActiveDirs(t *testing.T) {
	storageRoot := filepath.Join(t.TempDir(), "storage", "petal")
	for _, name := range []string{"unreadable", "active"} {
		if err := os.MkdirAll(filepath.Join(storageRoot, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	readErr := errors.New("read denied")
	containsFile := func(dirPath string) (bool, error) {
		switch filepath.Base(dirPath) {
		case "unreadable":
			return false, readErr
		case "active":
			if err := os.WriteFile(filepath.Join(dirPath, "late-data.json"), []byte("data"), 0644); err != nil {
				t.Fatal(err)
			}
			return false, nil
		default:
			return bazaar.PackageDirContainsFile(dirPath)
		}
	}

	err := cleanupEmptyPluginStorageDirs(storageRoot, containsFile)
	if !errors.Is(err, readErr) {
		t.Fatalf("expected the inspection error to be returned, got %v", err)
	}
	assertPathExists(t, filepath.Join(storageRoot, "unreadable"))
	assertPathExists(t, filepath.Join(storageRoot, "active", "late-data.json"))
}

func TestCleanupEmptyPluginStorageDirsPreservesSymlinks(t *testing.T) {
	root := t.TempDir()
	storageRoot := filepath.Join(root, "storage", "petal")
	targetPath := filepath.Join(root, "external")
	if err := os.MkdirAll(targetPath, 0755); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(storageRoot, "linked-plugin")
	if err := os.MkdirAll(storageRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(targetPath, linkPath); err != nil {
		t.Skipf("symbolic links are unavailable: %v", err)
	}

	if err := cleanupEmptyPluginStorageDirs(storageRoot, bazaar.PackageDirContainsFile); err != nil {
		t.Fatal(err)
	}
	assertPathExists(t, linkPath)
	assertPathExists(t, targetPath)
}

func TestCleanupEmptyPluginStorageDirsHandlesMissingRoot(t *testing.T) {
	storageRoot := filepath.Join(t.TempDir(), "missing")
	if err := cleanupEmptyPluginStorageDirs(storageRoot, bazaar.PackageDirContainsFile); err != nil {
		t.Fatal(err)
	}
}

func TestCleanupEmptyPluginStorageDirsSkipsReadOnlyMode(t *testing.T) {
	originalDataDir, originalReadOnly := util.DataDir, util.ReadOnly
	util.DataDir, util.ReadOnly = t.TempDir(), true
	t.Cleanup(func() {
		util.DataDir, util.ReadOnly = originalDataDir, originalReadOnly
	})

	emptyDir := pluginStoragePath("empty-plugin")
	if err := os.MkdirAll(filepath.Join(emptyDir, "nested"), 0755); err != nil {
		t.Fatal(err)
	}
	CleanupEmptyPluginStorageDirs()
	assertPathExists(t, emptyDir)
}

func assertPathExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Lstat(path); err != nil {
		t.Fatalf("expected path [%s] to exist: %v", path, err)
	}
}

func assertPathMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected path [%s] to be missing, got %v", path, err)
	}
}
