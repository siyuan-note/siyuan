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
