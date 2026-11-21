// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func resetInstalledManifestCache(t *testing.T) {
	t.Helper()
	installedManifestCacheMu.Lock()
	installedManifestCache = map[string]map[string]installedManifestCacheEntry{}
	installedManifestCacheMu.Unlock()
}

// countManifestParses 统计实际读取并解析清单的次数，返回值在测试结束时仍然有效。
func countManifestParses(t *testing.T) *int {
	t.Helper()
	oldReader := installedManifestReader
	parses := 0
	installedManifestReader = func(manifestPath string) (installedManifestStamp, *Package, error) {
		parses++
		return oldReader(manifestPath)
	}
	t.Cleanup(func() { installedManifestReader = oldReader })
	return &parses
}

func writeTestManifest(t *testing.T, dir, content string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(dir, "plugin.json")
	if err := os.WriteFile(manifestPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return manifestPath
}

func TestLoadInstalledPackageManifestReusesParsedResult(t *testing.T) {
	resetInstalledManifestCache(t)
	parses := countManifestParses(t)
	dir := filepath.Join(t.TempDir(), "cached")
	manifestPath := writeTestManifest(t, dir, `{"name":"cached","version":"1.0.0"}`)

	pkg, err := LoadInstalledPackageManifest("plugins", dir, manifestPath)
	if err != nil || "cached" != pkg.Name {
		t.Fatalf("unexpected first load: %#v, %v", pkg, err)
	}
	pkg, err = LoadInstalledPackageManifest("plugins", dir, manifestPath)
	if err != nil || "cached" != pkg.Name {
		t.Fatalf("unexpected second load: %#v, %v", pkg, err)
	}
	if 1 != *parses {
		t.Fatalf("manifest was parsed %d times, want 1", *parses)
	}

	// 清单变化后重新解析
	writeTestManifest(t, dir, `{"name":"cached","version":"2.0.0-with-longer-content"}`)
	pkg, err = LoadInstalledPackageManifest("plugins", dir, manifestPath)
	if err != nil || "2.0.0-with-longer-content" != pkg.Version {
		t.Fatalf("manifest change was not picked up: %#v, %v", pkg, err)
	}
	if 2 != *parses {
		t.Fatalf("manifest was parsed %d times after change, want 2", *parses)
	}
}

func TestLoadInstalledPackageManifestReturnsIndependentCopies(t *testing.T) {
	resetInstalledManifestCache(t)
	dir := filepath.Join(t.TempDir(), "copied")
	manifestPath := writeTestManifest(t, dir,
		`{"name":"copied","displayName":{"default":"Copied"},"keywords":["first"]}`)

	first, err := LoadInstalledPackageManifest("plugins", dir, manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	first.DisplayName["default"] = "mutated"
	first.Keywords[0] = "mutated"

	second, err := LoadInstalledPackageManifest("plugins", dir, manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if "Copied" != second.DisplayName["default"] || "first" != second.Keywords[0] {
		t.Fatalf("cached prototype was modified by its caller: %#v", second)
	}
}

func TestInvalidateInstalledPackageManifestCache(t *testing.T) {
	resetInstalledManifestCache(t)
	parses := countManifestParses(t)
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldDataDir })

	dir := filepath.Join(util.DataDir, "plugins", "demo")
	manifestPath := writeTestManifest(t, dir, `{"name":"demo","version":"1.0.0"}`)
	for range 2 {
		if _, err := LoadInstalledPackageManifest("plugins", dir, manifestPath); err != nil {
			t.Fatal(err)
		}
	}
	if 1 != *parses {
		t.Fatalf("manifest was parsed %d times, want 1", *parses)
	}

	InvalidateInstalledPackageManifestCache("plugins", "demo")
	if _, err := LoadInstalledPackageManifest("plugins", dir, manifestPath); err != nil {
		t.Fatal(err)
	}
	if 2 != *parses {
		t.Fatalf("manifest was parsed %d times after invalidation, want 2", *parses)
	}
}

func TestRetainInstalledPackageManifestCacheDropsRemovedDirectories(t *testing.T) {
	resetInstalledManifestCache(t)
	parses := countManifestParses(t)
	root := t.TempDir()
	keptDir, removedDir := filepath.Join(root, "kept"), filepath.Join(root, "removed")
	keptManifest := writeTestManifest(t, keptDir, `{"name":"kept","version":"1.0.0"}`)
	removedManifest := writeTestManifest(t, removedDir, `{"name":"removed","version":"1.0.0"}`)
	for _, dir := range []string{keptDir, removedDir} {
		if _, err := LoadInstalledPackageManifest("plugins", dir, filepath.Join(dir, "plugin.json")); err != nil {
			t.Fatal(err)
		}
	}
	if 2 != *parses {
		t.Fatalf("manifest was parsed %d times, want 2", *parses)
	}

	RetainInstalledPackageManifestCache("plugins", []string{keptDir})
	if _, err := LoadInstalledPackageManifest("plugins", keptDir, keptManifest); err != nil {
		t.Fatal(err)
	}
	if 2 != *parses {
		t.Fatalf("retained manifest was parsed again: %d", *parses)
	}
	if _, err := LoadInstalledPackageManifest("plugins", removedDir, removedManifest); err != nil {
		t.Fatal(err)
	}
	if 3 != *parses {
		t.Fatalf("dropped manifest was not parsed again: %d", *parses)
	}
}
