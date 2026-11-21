// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const readmeCacheTestBody = `# Probe

Rendered **README** body with an image: ![preview](preview.png)
`

func resetInstalledReadmeCache(t *testing.T) {
	t.Helper()
	installedReadmeCache.mu.Lock()
	installedReadmeCache.entries = map[string]installedReadmeCacheEntry{}
	installedReadmeCache.keys = nil
	installedReadmeCache.bytes = 0
	installedReadmeCache.mu.Unlock()
}

// countReadmeRenders 统计实际渲染次数，返回值在测试结束时仍然有效。
func countReadmeRenders(t *testing.T) *int {
	t.Helper()
	oldRenderer := installedReadmeRenderer
	renders := 0
	installedReadmeRenderer = func(linkBase string, mdData []byte, resolveImage func(string) string) string {
		renders++
		return oldRenderer(linkBase, mdData, resolveImage)
	}
	t.Cleanup(func() { installedReadmeRenderer = oldRenderer })
	return &renders
}

func writeReadmePackage(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte(readmeCacheTestBody), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "preview.png"), []byte("png"), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestInstalledPackageReadmeReusesRenderedResult(t *testing.T) {
	resetInstalledReadmeCache(t)
	renders := countReadmeRenders(t)
	dir := filepath.Join(t.TempDir(), "demo")
	writeReadmePackage(t, dir)
	readme := LocaleStrings{"default": "README.md"}

	first := getInstalledPackageREADME(dir, "/plugins/demo/", "", "", 1000, readme)
	second := getInstalledPackageREADME(dir, "/plugins/demo/", "", "", 1000, readme)
	if first != second || !strings.Contains(first, "<strong>README</strong>") {
		t.Fatalf("unexpected rendered readme: %q", first)
	}
	if 1 != *renders {
		t.Fatalf("readme was rendered %d times, want 1", *renders)
	}

	// 链接前缀与版本参与缓存键，变化后必须重新渲染
	getInstalledPackageREADME(dir, "/plugins/other/", "", "", 1000, readme)
	if 2 != *renders {
		t.Fatalf("changed link base reused the cached readme: %d", *renders)
	}
	getInstalledPackageREADME(dir, "/plugins/demo/", "", "", 2000, readme)
	if 3 != *renders {
		t.Fatalf("changed cache version reused the cached readme: %d", *renders)
	}
}

func TestInstalledPackageReadmeInvalidatesOnFileChange(t *testing.T) {
	resetInstalledReadmeCache(t)
	renders := countReadmeRenders(t)
	dir := filepath.Join(t.TempDir(), "demo")
	writeReadmePackage(t, dir)
	readme := LocaleStrings{"default": "README.md"}

	getInstalledPackageREADME(dir, "/plugins/demo/", "", "", 1000, readme)
	updated := "# Probe\n\nEdited body with different length.\n"
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte(updated), 0644); err != nil {
		t.Fatal(err)
	}
	html := getInstalledPackageREADME(dir, "/plugins/demo/", "", "", 1000, readme)
	if !strings.Contains(html, "Edited body") {
		t.Fatalf("stale readme was reused: %q", html)
	}
	if 2 != *renders {
		t.Fatalf("readme was rendered %d times, want 2", *renders)
	}
}

func TestInstalledPackageReadmeFollowsLanguage(t *testing.T) {
	resetInstalledReadmeCache(t)
	renders := countReadmeRenders(t)
	dir := filepath.Join(t.TempDir(), "demo")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# Default\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "README_zh_CN.md"), []byte("# 中文\n"), 0644); err != nil {
		t.Fatal(err)
	}
	readme := LocaleStrings{"default": "README.md", "zh_CN": "README_zh_CN.md"}

	oldLang := util.Lang
	t.Cleanup(func() { util.Lang = oldLang })

	util.Lang = "en_US"
	if html := getInstalledPackageREADME(dir, "/plugins/demo/", "", "", 1000, readme); !strings.Contains(html, "Default") {
		t.Fatalf("unexpected english readme: %q", html)
	}
	util.Lang = "zh_CN"
	html := getInstalledPackageREADME(dir, "/plugins/demo/", "", "", 1000, readme)
	if !strings.Contains(html, "中文") {
		t.Fatalf("language switch reused the cached readme: %q", html)
	}
	if 2 != *renders {
		t.Fatalf("readme was rendered %d times, want 2", *renders)
	}
}

func TestInvalidateInstalledPackageReadmeCache(t *testing.T) {
	resetInstalledReadmeCache(t)
	renders := countReadmeRenders(t)
	root := t.TempDir()
	readme := LocaleStrings{"default": "README.md"}
	target, other := filepath.Join(root, "target"), filepath.Join(root, "other")
	writeReadmePackage(t, target)
	writeReadmePackage(t, other)

	getInstalledPackageREADME(target, "/plugins/target/", "", "", 1000, readme)
	getInstalledPackageREADME(other, "/plugins/other/", "", "", 1000, readme)

	InvalidateInstalledPackageReadmeCache(target)
	getInstalledPackageREADME(target, "/plugins/target/", "", "", 1000, readme)
	getInstalledPackageREADME(other, "/plugins/other/", "", "", 1000, readme)
	if 3 != *renders {
		t.Fatalf("readme was rendered %d times, want 3 (only the invalidated package)", *renders)
	}
}

func TestRetainInstalledPackageCachesDropsReadmeEntries(t *testing.T) {
	resetInstalledReadmeCache(t)
	renders := countReadmeRenders(t)
	root := t.TempDir()
	readme := LocaleStrings{"default": "README.md"}
	kept, removed := filepath.Join(root, "kept"), filepath.Join(root, "removed")
	writeReadmePackage(t, kept)
	writeReadmePackage(t, removed)

	getInstalledPackageREADME(kept, "/plugins/kept/", "", "", 1000, readme)
	getInstalledPackageREADME(removed, "/plugins/removed/", "", "", 1000, readme)

	RetainInstalledPackageCaches("plugins", []string{kept})
	getInstalledPackageREADME(kept, "/plugins/kept/", "", "", 1000, readme)
	if 2 != *renders {
		t.Fatalf("retained readme was rendered again: %d", *renders)
	}
	getInstalledPackageREADME(removed, "/plugins/removed/", "", "", 1000, readme)
	if 3 != *renders {
		t.Fatalf("dropped readme was not rendered again: %d", *renders)
	}
}
