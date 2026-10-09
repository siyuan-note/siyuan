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
	"runtime"
	"strings"
	"testing"
)

// TestIsSensitivePathNamespaceAlias 覆盖 Windows 路径命名空间别名绕过敏感路径黑名单的问题
// （GHSA-6gmc-424x-xgpm）：扩展长度前缀 `\\?\`、`\\?\UNC\`、设备命名空间 `\\.\` 以及本机管理共享
// 均指向同一位置，必须与常规 Win32 路径得到相同的敏感性判定。
func TestIsSensitivePathNamespaceAlias(t *testing.T) {
	originalHome, originalWorkspace := HomeDir, WorkspaceDir
	workspace := t.TempDir()
	HomeDir, WorkspaceDir = t.TempDir(), workspace
	t.Cleanup(func() { HomeDir, WorkspaceDir = originalHome, originalWorkspace })

	confDir := filepath.Join(WorkspaceDir, "conf")
	tempDir := filepath.Join(WorkspaceDir, "temp")
	dataDir := filepath.Join(WorkspaceDir, "data")

	for _, test := range []struct {
		name      string
		path      string
		sensitive bool
	}{
		{"普通路径的 conf 目录", confDir, true},
		{"扩展长度前缀的 conf 目录", `\\?\` + confDir, true},
		{"反斜杠前缀的家目录凭据", `\\?\` + filepath.Join(HomeDir, ".ssh", "id_rsa"), true},
		{"普通路径的 temp 目录", filepath.Join(tempDir, "private.txt"), true},
		{"扩展长度前缀的 temp 目录", `\\?\` + filepath.Join(tempDir, "private.txt"), true},
		{"temp/export 仍允许导出", filepath.Join(tempDir, "export", "document.pdf"), false},
		{"扩展长度前缀的 temp/export 仍允许导出", `\\?\` + filepath.Join(tempDir, "export", "document.pdf"), false},
		{"扩展长度前缀的工作空间资源", `\\?\` + filepath.Join(dataDir, "assets", "image.png"), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := IsSensitivePath(test.path); got != test.sensitive {
				t.Errorf("IsSensitivePath(%q) = %v, want %v", test.path, got, test.sensitive)
			}
		})
	}

	if runtime.GOOS != "windows" {
		return
	}

	drive := filepath.VolumeName(WorkspaceDir)
	if len(drive) != 2 || drive[1] != ':' {
		t.Skipf("workspace volume is not a drive letter: %s", drive)
	}

	// 命名空间别名指向同一位置，必须与常规路径一致；大小写变体同样不能放行
	type pathVariant struct {
		name string
		path string
	}
	variants := []pathVariant{
		{"设备命名空间 conf 目录", `\\.\` + confDir},
		{"扩展长度小写盘符的 conf 目录", `\\?\` + strings.ToLower(drive) + confDir[len(drive):]},
		{"扩展长度正斜杠的 conf 目录", `\\?\` + strings.ReplaceAll(confDir, `\`, `/`)},
		{"扩展长度 UNC 本机管理共享的 conf 目录", `\\?\UNC\localhost\` + strings.ToUpper(drive[:1]) + "$" + confDir[len(drive):]},
		{"UNC 本机管理共享的 conf 目录", `\\localhost\` + strings.ToUpper(drive[:1]) + "$" + confDir[len(drive):]},
	}
	if hostname, err := os.Hostname(); err == nil && "" != hostname {
		variants = append(variants, pathVariant{"UNC 本机主机名管理共享的 conf 目录", `\\` + hostname + `\` + strings.ToUpper(drive[:1]) + "$" + confDir[len(drive):]})
	} else {
		t.Logf("skip hostname admin share variant: %v", err)
	}
	for _, variant := range variants {
		t.Run(variant.name, func(t *testing.T) {
			if !IsSensitivePath(variant.path) {
				t.Errorf("IsSensitivePath(%q) = false, want true", variant.path)
			}
		})
	}

	// 工作空间自身不能因别名被误判，否则会阻断工作空间内的合法读写与伺服
	for _, p := range []string{`\\?\` + WorkspaceDir, `\\.\` + WorkspaceDir, `\\localhost\` + strings.ToUpper(drive[:1]) + "$" + WorkspaceDir[len(drive):]} {
		if IsSensitivePath(p) {
			t.Errorf("IsSensitivePath(%q) = true, want false (workspace root)", p)
		}
	}
}

// TestResolveNamespaceAlias 校验命名空间别名归一化的具体结果。
func TestResolveNamespaceAlias(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows path namespaces are platform specific")
	}

	for _, test := range []struct {
		name string
		in   string
		want string
	}{
		{"扩展长度前缀", `\\?\D:\ws\conf\conf.json`, `D:\ws\conf\conf.json`},
		{"扩展长度前缀与正斜杠", `\\?\D:/ws/conf/conf.json`, `D:\ws\conf\conf.json`},
		{"设备命名空间", `\\.\D:\ws`, `D:\ws`},
		{"本机管理共享", `\\localhost\D$\ws\conf`, `D:\ws\conf`},
		{"本机管理共享仅含共享名", `\\localhost\D$`, `D:\`},
		{"本机管理共享与小写盘符", `\\localhost\d$\ws`, `D:\ws`},
		{"扩展长度 UNC 本机管理共享", `\\?\UNC\localhost\D$\ws\conf`, `D:\ws\conf`},
		{"设备命名空间 UNC 本机管理共享", `\\.\UNC\localhost\D$\ws`, `D:\ws`},
		{"远程共享保持 UNC 形式", `\\server\share\ws`, `\\server\share\ws`},
		{"非盘符共享不映射", `\\localhost\data\ws`, `\\localhost\data\ws`},
		{"普通路径不变", `D:\ws\conf`, `D:\ws\conf`},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := resolveNamespaceAlias(test.in); !strings.EqualFold(got, test.want) {
				t.Errorf("resolveNamespaceAlias(%q) = %q, want %q", test.in, got, test.want)
			}
		})
	}
}
