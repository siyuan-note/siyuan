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
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func useTestBazaarInfo(t *testing.T) {
	t.Helper()
	oldDataDir := util.DataDir
	bazaarInfoCacheLock.Lock()
	oldCache := bazaarInfoCache
	oldModTime := bazaarInfoModTime
	bazaarInfoCache = nil
	bazaarInfoModTime = time.Time{}
	bazaarInfoCacheLock.Unlock()
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		bazaarInfoCacheLock.Lock()
		bazaarInfoCache = oldCache
		bazaarInfoModTime = oldModTime
		bazaarInfoCacheLock.Unlock()
	})
}

func TestRecordPackageOperationTime(t *testing.T) {
	useTestBazaarInfo(t)

	installTime := time.UnixMilli(1000)
	updateTime := time.UnixMilli(2000)
	recordPackageOperationTime("plugins", "test-package", installTime, time.Time{}, false,
		"https://github.com/owner/repo", "v1.0.0")
	recordPackageOperationTime("plugins", "test-package", updateTime, time.Time{}, true,
		"https://github.com/owner/repo", "v2.0.0")

	info := bazaarInfoCache.Packages["plugins"]["test-package"]
	if info.InstallTime != installTime.UnixMilli() {
		t.Fatalf("install time changed after update: %d", info.InstallTime)
	}
	if info.UpdateTime != updateTime.UnixMilli() {
		t.Fatalf("unexpected update time: %d", info.UpdateTime)
	}
	if info.RepoURL != "https://github.com/owner/repo" || info.RepoRef != "v2.0.0" {
		t.Fatalf("unexpected package source: %#v", info)
	}

	gotInstallTime, gotUpdateTime := ensurePackageInstallTime("plugins", "test-package", time.UnixMilli(3000))
	if gotInstallTime != installTime.UnixMilli() || gotUpdateTime != updateTime.UnixMilli() {
		t.Fatalf("initialization overwrote recorded times: install=%d, update=%d", gotInstallTime, gotUpdateTime)
	}

	reinstallTime := time.UnixMilli(4000)
	recordPackageOperationTime("plugins", "test-package", reinstallTime, time.Time{}, false, "", "")
	info = bazaarInfoCache.Packages["plugins"]["test-package"]
	if info.InstallTime != reinstallTime.UnixMilli() {
		t.Fatalf("unexpected reinstall time: %d", info.InstallTime)
	}
	if info.UpdateTime != 0 {
		t.Fatalf("update time was not cleared after reinstall: %d", info.UpdateTime)
	}
	if info.RepoURL != "" || info.RepoRef != "" {
		t.Fatalf("local reinstall retained remote source: %#v", info)
	}
}

func TestRecordPackageOperationTimeRejectsUntrustedSource(t *testing.T) {
	useTestBazaarInfo(t)
	recordPackageOperationTime("plugins", "test-package", time.UnixMilli(1000), time.Time{}, false,
		"https://example.com/owner/repo", "v1.0.0")
	info := bazaarInfoCache.Packages["plugins"]["test-package"]
	if info.RepoURL != "" || info.RepoRef != "" {
		t.Fatalf("untrusted package source was persisted: %#v", info)
	}
}

func TestSetInstalledPackageMetadataImageURLs(t *testing.T) {
	useTestBazaarInfo(t)
	installPath := t.TempDir()
	for name, content := range map[string]string{
		"README.md":         "README\n\n![icon](custom%20%23%25%28+%29.webp)",
		"custom #%(+).webp": "icon",
		"preview.png":       "preview",
	} {
		if err := os.WriteFile(filepath.Join(installPath, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	icon := "custom #%(+).webp"
	noPreview := ""
	recordPackageOperationTime("plugins", "A B#C%D(E)+F", time.UnixMilli(2000), time.Time{}, false, "", "")
	recordPackageOperationTime("plugins", "A B#C%D(E)+F", time.UnixMilli(1000), time.Time{}, true, "", "")
	pkg := &Package{
		Name:    "A B#C%D(E)+F",
		Icon:    &icon,
		Preview: &noPreview,
		Readme:  LocaleStrings{"default": "README.md"},
	}
	baseURL := "/plugins/A%20B%23C%25D%28E%29+F/"
	if !SetInstalledPackageMetadata(pkg, installPath, baseURL, "plugins") {
		t.Fatal("expected installed metadata")
	}
	if pkg.IconURL != baseURL+"custom%20%23%25%28+%29.webp?v=2000" {
		t.Fatalf("unexpected icon URL: %q", pkg.IconURL)
	}
	if pkg.PreviewURL != "" {
		t.Fatalf("explicit missing preview should not use preview.png: %q", pkg.PreviewURL)
	}
	if !strings.Contains(pkg.PreferredReadme, baseURL+"custom%20%23%25%28+%29.webp?v=2000") ||
		!strings.Contains(pkg.PreferredReadme, "README") {
		t.Fatalf("unexpected installed README: %q", pkg.PreferredReadme)
	}
}

func TestInstalledPackageSizeCacheAndInvalidation(t *testing.T) {
	installPath := t.TempDir()
	if err := os.WriteFile(filepath.Join(installPath, "first"), []byte("first"), 0644); err != nil {
		t.Fatal(err)
	}

	const pkgType = "plugins"
	const packageName = "size-cache-test"
	RemoveInstalledPackageSizeCache(pkgType, packageName)
	t.Cleanup(func() {
		RemoveInstalledPackageSizeCache(pkgType, packageName)
	})

	firstSize, firstHSize, err := GetInstalledPackageSize(pkgType, packageName, installPath)
	if err != nil {
		t.Fatal(err)
	}
	if firstSize < 1 || firstHSize == "" {
		t.Fatalf("expected a formatted non-zero size, got %d and %q", firstSize, firstHSize)
	}

	if err = os.WriteFile(filepath.Join(installPath, "second"), []byte("second file"), 0644); err != nil {
		t.Fatal(err)
	}
	cachedSize, _, err := GetInstalledPackageSize(pkgType, packageName, installPath)
	if err != nil {
		t.Fatal(err)
	}
	if cachedSize != firstSize {
		t.Fatalf("expected cached size %d, got %d", firstSize, cachedSize)
	}

	RemoveInstalledPackageSizeCache(pkgType, packageName)
	refreshedSize, _, err := GetInstalledPackageSize(pkgType, packageName, installPath)
	if err != nil {
		t.Fatal(err)
	}
	if refreshedSize <= firstSize {
		t.Fatalf("expected refreshed size greater than %d, got %d", firstSize, refreshedSize)
	}
}

func TestPackageDirContainsFile(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "i18n", "nested"), 0755); err != nil {
		t.Fatal(err)
	}

	containsFile, err := PackageDirContainsFile(root)
	if err != nil {
		t.Fatal(err)
	}
	if containsFile {
		t.Fatal("expected an empty directory tree not to contain files")
	}

	if err = os.WriteFile(filepath.Join(root, "i18n", "nested", "en_US.json"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	containsFile, err = PackageDirContainsFile(root)
	if err != nil {
		t.Fatal(err)
	}
	if !containsFile {
		t.Fatal("expected an empty file to count as an actual file")
	}
}

func TestIsValidInstalledPackageRequiresExactName(t *testing.T) {
	if !IsValidInstalledPackage(&Package{Name: "plugin-sample"}, "plugin-sample") {
		t.Fatal("expected an exact package name match to be valid")
	}
	for _, test := range []struct {
		pkg     *Package
		dirName string
	}{
		{pkg: nil, dirName: "plugin-sample"},
		{pkg: &Package{Name: "plugin-sample"}, dirName: "Plugin-Sample"},
		{pkg: &Package{Name: "插件"}, dirName: "插件"},
	} {
		if IsValidInstalledPackage(test.pkg, test.dirName) {
			t.Fatalf("expected package %#v in directory %q to be invalid", test.pkg, test.dirName)
		}
	}
}
