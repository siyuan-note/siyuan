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

	type pathCase struct {
		name      string
		path      string
		sensitive bool
	}
	tests := []pathCase{
		{"普通路径的 conf 目录", confDir, true},
		{"普通路径的家目录凭据", filepath.Join(HomeDir, ".ssh", "id_rsa"), true},
		{"普通路径的 temp 目录", filepath.Join(tempDir, "private.txt"), true},
		{"temp/export 仍允许导出", filepath.Join(tempDir, "export", "document.pdf"), false},
		{"普通路径的工作空间资源", filepath.Join(dataDir, "assets", "image.png"), false},
	}
	// Windows 命名空间前缀不能拼接到 POSIX 路径作为同位置别名。
	if runtime.GOOS == "windows" {
		tests = append(tests, []pathCase{
			{"扩展长度前缀的 conf 目录", `\\?\` + confDir, true},
			{"反斜杠前缀的家目录凭据", `\\?\` + filepath.Join(HomeDir, ".ssh", "id_rsa"), true},
			{"扩展长度前缀的 temp 目录", `\\?\` + filepath.Join(tempDir, "private.txt"), true},
			{"扩展长度前缀的 temp/export 仍允许导出", `\\?\` + filepath.Join(tempDir, "export", "document.pdf"), false},
			{"扩展长度前缀的工作空间资源", `\\?\` + filepath.Join(dataDir, "assets", "image.png"), false},
		}...)
	}
	for _, test := range tests {
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
		{"正斜杠命名空间的 conf 目录", `//?/` + strings.ReplaceAll(confDir, `\`, `/`)},
		{"扩展长度 UNC 本机管理共享的 conf 目录", `\\?\UNC\localhost\` + strings.ToUpper(drive[:1]) + "$" + confDir[len(drive):]},
		{"小写 UNC 本机管理共享的 conf 目录", `\\?\unc\localhost\` + strings.ToUpper(drive[:1]) + "$" + confDir[len(drive):]},
		{"UNC 本机管理共享的 conf 目录", `\\localhost\` + strings.ToUpper(drive[:1]) + "$" + confDir[len(drive):]},
	}
	// GLOBALROOT 与卷 GUID 指向同一位置，但只能由内核对象管理器解析，无法归一化为盘符路径
	// （GHSA-gg3p-r4g8-vxg2），必须与常规路径一样按敏感路径拒绝，不能以任一种拼写放行
	deviceNamespaces := []string{
		`\\?\GLOBALROOT\Device\HarddiskVolume1`,
		`\\.\GLOBALROOT\Device\HarddiskVolume1`,
		`//?/GLOBALROOT/Device/HarddiskVolume1`,
		`\\?\globalroot\device\harddiskvolume1`,
		`\\.\GLOBALROOT\Device\HarddiskVolumeShadowCopy1`,
		`\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy4`,
		`\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}`,
		`\\.\Device\HarddiskVolume1`,
	}
	for _, ns := range deviceNamespaces {
		variants = append(variants, pathVariant{ns, ns + confDir[len(drive):]})
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

	// 设备命名空间无盘符等价形式，无法判断归属，故工作空间路径同样按 fail-closed 拒绝
	for _, p := range []string{
		`\\?\GLOBALROOT\Device\HarddiskVolume1` + WorkspaceDir[len(drive):],
		`\\?\GLOBALROOT\Device\HarddiskVolume1` + filepath.Join(WorkspaceDir, "data", "assets", "image.png")[len(drive):],
	} {
		if !IsSensitivePath(p) {
			t.Errorf("IsSensitivePath(%q) = false, want true (device namespace must fail closed)", p)
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
		{"正斜杠命名空间与盘符", `//?/D:/ws/conf/conf.json`, `D:\ws\conf\conf.json`},
		{"混合斜杠命名空间与盘符", `\/.\D:/ws/conf/conf.json`, `D:\ws\conf\conf.json`},
		{"根本地设备前缀与盘符", `\??\D:\ws\conf\conf.json`, `D:\ws\conf\conf.json`},
		{"设备命名空间", `\\.\D:\ws`, `D:\ws`},
		{"本机管理共享", `\\localhost\D$\ws\conf`, `D:\ws\conf`},
		{"本机管理共享仅含共享名", `\\localhost\D$`, `D:\`},
		{"本机管理共享与小写盘符", `\\localhost\d$\ws`, `D:\ws`},
		{"扩展长度 UNC 本机管理共享", `\\?\UNC\localhost\D$\ws\conf`, `D:\ws\conf`},
		{"设备命名空间 UNC 本机管理共享", `\\.\UNC\localhost\D$\ws`, `D:\ws`},
		{"小写 UNC 本机管理共享", `\\?\unc\localhost\D$\ws`, `D:\ws`},
		{"正斜杠 UNC 本机管理共享", `//?/unc/localhost/D$/ws`, `D:\ws`},
		{"扩展长度远程共享", `\\?\UNC\server\share\ws`, `\\server\share\ws`},
		{"设备命名空间远程共享", `\\.\unc\server\share\ws`, `\\server\share\ws`},
		{"远程共享保持 UNC 形式", `\\server\share\ws`, `\\server\share\ws`},
		{"非盘符共享不映射", `\\localhost\data\ws`, `\\localhost\data\ws`},
		{"普通路径不变", `D:\ws\conf`, `D:\ws\conf`},
		{"设备同名相对目录", `Device\image.png`, `Device\image.png`},
		{"卷同名相对目录", `Volume{notes}\image.png`, `Volume{notes}\image.png`},
		{"命名空间同名相对目录", `GLOBALROOT\image.png`, `GLOBALROOT\image.png`},
		{"GLOBALROOT 设备命名空间不可归一化", `\\?\GLOBALROOT\Device\HarddiskVolume3\ws\conf`, deviceNamespacePath},
		{"设备命名空间 GLOBALROOT 不可归一化", `\\.\GLOBALROOT\Device\HarddiskVolume3\ws\conf`, deviceNamespacePath},
		{"正斜杠 GLOBALROOT 不可归一化", `//?/GLOBALROOT/Device/HarddiskVolume3/ws/conf`, deviceNamespacePath},
		{"小写 GLOBALROOT 不可归一化", `\\?\globalroot\device\harddiskvolume3\ws\conf`, deviceNamespacePath},
		{"卷影副本不可归一化", `\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy2\ws\conf`, deviceNamespacePath},
		{"设备对象路径不可归一化", `\\.\Device\HarddiskVolume3\ws\conf`, deviceNamespacePath},
		{"卷 GUID 不可归一化", `\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}\ws\conf`, deviceNamespacePath},
		{"全局 DOS 设备目录不可归一化", `\\?\GLOBALROOT\GLOBAL??\D:\ws\conf`, deviceNamespacePath},
		{"当前 DOS 设备目录不可归一化", `\\?\GLOBALROOT\??\D:\ws\conf`, deviceNamespacePath},
		{"DOS 设备链接不可归一化", `\\?\GLOBALROOT\DosDevices\D:\ws\conf`, deviceNamespacePath},
		{"全局设备链接不可归一化", `\\.\Global\D:\ws\conf`, deviceNamespacePath},
		{"根本地设备别名不可归一化", `\??\Global\D:\ws\conf`, deviceNamespacePath},
		{"未知设备别名不可归一化", `\\?\OtherDevice\ws\conf`, deviceNamespacePath},
		{"卷设备句柄不可归一化", `\\.\D:`, deviceNamespacePath},
		{"盘符相对路径不可归一化", `\\?\D:conf\conf.json`, deviceNamespacePath},
		{"裸命名空间不可归一化", `\\?`, deviceNamespacePath},
		{"空命名空间不可归一化", `\\.\`, deviceNamespacePath},
		{"缺少共享名不可归一化", `\\?\UNC\server`, deviceNamespacePath},
		{"空共享名不可归一化", `\\?\UNC\server\\file`, deviceNamespacePath},
		{"空主机名不可归一化", `\\?\UNC\\share\file`, deviceNamespacePath},
		{"设备主机名不可归一化", `\\?\UNC\.\D:\ws`, deviceNamespacePath},
		{"相对共享名不可归一化", `\\?\UNC\server\..\D$\ws`, deviceNamespacePath},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := resolveNamespaceAlias(test.in); !strings.EqualFold(got, test.want) {
				t.Errorf("resolveNamespaceAlias(%q) = %q, want %q", test.in, got, test.want)
			}
		})
	}
}
