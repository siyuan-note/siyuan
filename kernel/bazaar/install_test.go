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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIncPackageDownloadsIncludesPackageName(t *testing.T) {
	oldServer := bazaarDownloadCloudServer
	t.Cleanup(func() { bazaarDownloadCloudServer = oldServer })
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if "/apis/siyuan/bazaar/addBazaarPackageDownloadCount" != request.URL.Path {
			t.Fatalf("unexpected download statistics path: %s", request.URL.Path)
		}
		body := map[string]any{}
		if err := json.NewDecoder(request.Body).Decode(&body); nil != err {
			t.Fatal(err)
		}
		if "system" != body["systemID"] || "owner/repo" != body["repo"] || "sample" != body["packageName"] {
			t.Fatalf("unexpected download statistics body: %+v", body)
		}
		writer.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	bazaarDownloadCloudServer = func() string { return server.URL }

	incPackageDownloads("https://github.com/owner/repo", "sample", "system")
}

// TestInstallPackageNameMismatch 校验下载包声明的名称与请求安装的包名不一致时拒绝安装
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rpx2-p6hp-x5gj
func TestInstallPackageNameMismatch(t *testing.T) {
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTempDir })

	installPath := filepath.Join(t.TempDir(), "plugins", "trusted-plugin")
	if err := os.MkdirAll(installPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installPath, "index.js"), []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	// 请求安装 trusted-plugin，但下载内容是另一个包（attacker-plugin）
	data := buildInstallPackageArchive(t, map[string]string{
		"plugin.json": `{"name":"attacker-plugin","version":"1.0.0"}`,
		"index.js":    "malicious",
	})
	if err := installPackage(data, installPath, "plugins", "trusted-plugin", true); err == nil {
		t.Fatal("expected name mismatch to be rejected")
	}
	content, err := os.ReadFile(filepath.Join(installPath, "index.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "original" {
		t.Fatalf("existing package files were overwritten: %q", content)
	}
}

// TestInstallPackageRefusesOverwriteWithoutUpdate 校验非更新安装时拒绝覆盖非空目标目录
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rpx2-p6hp-x5gj
func TestInstallPackageRefusesOverwriteWithoutUpdate(t *testing.T) {
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTempDir })

	installPath := filepath.Join(t.TempDir(), "plugins", "sample")
	if err := os.MkdirAll(installPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installPath, "index.js"), []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	data := buildInstallPackageArchive(t, map[string]string{
		"plugin.json": `{"name":"sample","version":"2.0.0"}`,
		"index.js":    "new",
	})
	if err := installPackage(data, installPath, "plugins", "sample", false); err == nil {
		t.Fatal("expected overwriting non-empty directory without update to be rejected")
	}
	content, err := os.ReadFile(filepath.Join(installPath, "index.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "original" {
		t.Fatalf("existing package files were overwritten: %q", content)
	}
}

// TestInstallPackageUpdateReplacesDirectory 校验在线更新会整目录替换，新版本已删除的文件不会残留
// https://github.com/siyuan-note/siyuan/issues/18933
func TestInstallPackageUpdateReplacesDirectory(t *testing.T) {
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTempDir })

	installPath := filepath.Join(t.TempDir(), "plugins", "sample")
	if err := os.MkdirAll(installPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installPath, "stale.js"), []byte("stale"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installPath, "plugin.json"), []byte(`{"name":"sample","version":"1.0.0"}`), 0644); err != nil {
		t.Fatal(err)
	}

	data := buildInstallPackageArchive(t, map[string]string{
		"plugin.json": `{"name":"sample","version":"2.0.0"}`,
		"new.js":      "new",
	})
	if err := installPackage(data, installPath, "plugins", "sample", true); err != nil {
		t.Fatalf("expected update install to succeed: %s", err)
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

// TestInstallPackageUpdateOverwrites 校验对同名已安装包的更新安装正常覆盖
func TestInstallPackageUpdateOverwrites(t *testing.T) {
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTempDir })

	installPath := filepath.Join(t.TempDir(), "plugins", "sample")
	if err := os.MkdirAll(installPath, 0755); err != nil {
		t.Fatal(err)
	}

	data := buildInstallPackageArchive(t, map[string]string{
		"plugin.json": `{"name":"sample","version":"2.0.0"}`,
		"index.js":    "new",
	})
	if err := installPackage(data, installPath, "plugins", "sample", true); err != nil {
		t.Fatalf("expected update install to succeed: %s", err)
	}
	content, err := os.ReadFile(filepath.Join(installPath, "index.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "new" {
		t.Fatalf("expected updated content, got %q", content)
	}
}

// TestInstallPackageFreshInstall 校验新安装写入目标目录
func TestInstallPackageFreshInstall(t *testing.T) {
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTempDir })

	installPath := filepath.Join(t.TempDir(), "plugins", "sample")
	data := buildInstallPackageArchive(t, map[string]string{
		"plugin.json": `{"name":"sample","version":"1.0.0"}`,
		"index.js":    "new",
	})
	if err := installPackage(data, installPath, "plugins", "sample", false); err != nil {
		t.Fatalf("expected fresh install to succeed: %s", err)
	}
	if _, err := os.Stat(filepath.Join(installPath, "index.js")); err != nil {
		t.Fatalf("installed file is missing: %s", err)
	}
}

// TestInstallPackageFreshInstallReplacesEmptyDirectoryTree 校验新安装可以替换仅包含空目录的目标目录
func TestInstallPackageFreshInstallReplacesEmptyDirectoryTree(t *testing.T) {
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTempDir })

	installPath := filepath.Join(t.TempDir(), "plugins", "sample")
	if err := os.MkdirAll(filepath.Join(installPath, "i18n"), 0755); err != nil {
		t.Fatal(err)
	}
	data := buildInstallPackageArchive(t, map[string]string{
		"plugin.json": `{"name":"sample","version":"1.0.0"}`,
		"index.js":    "new",
	})
	if err := installPackage(data, installPath, "plugins", "sample", false); err != nil {
		t.Fatalf("expected fresh install into empty directory tree to succeed: %s", err)
	}
	if _, err := os.Stat(filepath.Join(installPath, "index.js")); err != nil {
		t.Fatalf("installed file is missing: %s", err)
	}
}

// TestReplacePackageDirectoryRechecksNonEmptyTarget 校验目录交换前会重新拒绝覆盖非空目标目录
func TestReplacePackageDirectoryRechecksNonEmptyTarget(t *testing.T) {
	root := t.TempDir()
	sourcePath := filepath.Join(root, "source")
	installPath := filepath.Join(root, "plugins", "sample")
	if err := os.MkdirAll(sourcePath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(installPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "new.js"), []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installPath, "original.js"), []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := replacePackageDirectory(sourcePath, installPath, false); err == nil {
		t.Fatal("expected replacing a non-empty target without update to be rejected")
	}
	content, err := os.ReadFile(filepath.Join(installPath, "original.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "original" {
		t.Fatalf("existing package file was changed: %q", content)
	}
	if _, err = os.Stat(filepath.Join(installPath, "new.js")); !os.IsNotExist(err) {
		t.Fatalf("new package file was written unexpectedly: %v", err)
	}
}

// TestInstallPackageMissingManifest 校验下载包缺少清单文件时拒绝安装
func TestInstallPackageMissingManifest(t *testing.T) {
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTempDir })

	installPath := filepath.Join(t.TempDir(), "plugins", "sample")
	data := buildInstallPackageArchive(t, map[string]string{
		"index.js": "new",
	})
	if err := installPackage(data, installPath, "plugins", "sample", false); err == nil {
		t.Fatal("expected missing manifest to be rejected")
	}
}

// buildInstallPackageArchive 构建内存中的集市包 zip 压缩数据
func buildInstallPackageArchive(t *testing.T, files map[string]string) []byte {
	t.Helper()
	archivePath := filepath.Join(t.TempDir(), "package.zip")
	writeLocalPackageArchive(t, archivePath, files)
	data, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestAppearanceInstallUpdateAndDeletePublishPackageState(t *testing.T) {
	useTestBazaarInfo(t)
	oldTemp, oldThemes, oldIcons := util.TempDir, util.ThemesPath, util.IconsPath
	util.TempDir = t.TempDir()
	util.ThemesPath, util.IconsPath = filepath.Join(util.DataDir, "themes"), filepath.Join(util.DataDir, "icons")
	t.Cleanup(func() { util.TempDir, util.ThemesPath, util.IconsPath = oldTemp, oldThemes, oldIcons })
	for _, kind := range []string{"themes", "icons"} {
		t.Run(kind, func(t *testing.T) {
			manifest, entry := "theme.json", "theme.css"
			if kind == "icons" {
				manifest, entry = "icon.json", "icon.js"
			}
			installPath := util.AppearancePackagePath(kind, "sample")
			data := buildInstallPackageArchive(t, map[string]string{
				manifest: `{"name":"sample","version":"1.0.0"}`, entry: "version one", "stale.txt": "stale",
			})
			if err := installPackageWithSource(data, installPath, kind, "sample", false, "https://github.com/owner/repo", "v1"); err != nil {
				t.Fatal(err)
			}
			if err := ValidateAppearancePackage(kind, "sample"); err != nil {
				t.Fatal(err)
			}
			initial, err := GetAppearancePackageInfo(kind, "sample")
			if err != nil || initial.InstallTime == 0 || initial.UpdateTime != 0 || initial.RepoRef != "v1" {
				t.Fatalf("invalid install state: %+v, %v", initial, err)
			}
			source := t.TempDir()
			for name, content := range map[string]string{manifest: `{"name":"sample","version":"2.0.0"}`, entry: "version two"} {
				if err = os.WriteFile(filepath.Join(source, name), []byte(content), 0644); err != nil {
					t.Fatal(err)
				}
			}
			if err = InstallLocalPackage(source, installPath, kind, "sample", true); err != nil {
				t.Fatal(err)
			}
			updated, err := GetAppearancePackageInfo(kind, "sample")
			if err != nil || updated.InstallTime != initial.InstallTime || updated.UpdateTime == 0 || updated.RepoURL != "" {
				t.Fatalf("invalid update state: %+v, %v", updated, err)
			}
			if _, err = os.Stat(filepath.Join(installPath, "stale.txt")); !os.IsNotExist(err) {
				t.Fatalf("stale file survived update: %v", err)
			}
			if err = ValidateAppearancePackage(kind, "sample"); err != nil {
				t.Fatal(err)
			}
			if err = UninstallPackage(installPath); err != nil {
				t.Fatal(err)
			}
			_, statePath, err := appearancePackagePaths(kind, "sample")
			if err != nil {
				t.Fatal(err)
			}
			state, err := readAppearanceState(statePath)
			if err != nil || !state.Deleted || len(state.Files) != 0 {
				t.Fatalf("invalid deletion state: %+v, %v", state, err)
			}
			if _, err = os.Stat(installPath); !os.IsNotExist(err) {
				t.Fatalf("package survived deletion: %v", err)
			}
			if err = InstallLocalPackage(source, installPath, kind, "sample", false); err != nil {
				t.Fatal(err)
			}
			if err = ValidateAppearancePackage(kind, "sample"); err != nil {
				t.Fatalf("explicit reinstall did not clear deletion: %v", err)
			}
			if info, err := GetAppearancePackageInfo(kind, "sample"); err != nil || reflect.DeepEqual(info, updated) || info.UpdateTime != 0 {
				t.Fatalf("reinstall did not reset operation state: %+v, %v", info, err)
			}
		})
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "storage", "bazaar.json")); !os.IsNotExist(err) {
		t.Fatalf("appearance installation unexpectedly rewrote shared bazaar metadata: %v", err)
	}
}
