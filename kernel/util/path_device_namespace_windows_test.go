// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build windows

package util

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"unsafe"
)

// 本文件动态校验设备命名空间别名绕过敏感路径黑名单的问题（GHSA-gg3p-r4g8-vxg2）。
// 卷的 `\Device\HarddiskVolumeN` 编号随机器与接入顺序变化，无法写死，故通过 QueryDosDevice 动态推导，
// 确保 `\\?\GLOBALROOT\Device\HarddiskVolumeN\...` 与常规盘符路径被判定为同一位置。

// TestDeviceNamespaceAliasRejected 用真实卷设备路径构造 GLOBALROOT 别名，校验其仍被拒绝，
// 并确认该别名确实指向工作空间内的真实文件，即拒绝不是因为路径不存在。
func TestDeviceNamespaceAliasRejected(t *testing.T) {
	originalHome, originalWorkspace := HomeDir, WorkspaceDir
	workspace := t.TempDir()
	HomeDir, WorkspaceDir = t.TempDir(), workspace
	t.Cleanup(func() { HomeDir, WorkspaceDir = originalHome, originalWorkspace })

	confDir := filepath.Join(WorkspaceDir, "conf")
	if err := os.MkdirAll(confDir, 0755); err != nil {
		t.Fatal(err)
	}
	confPath := filepath.Join(confDir, "conf.json")
	if err := os.WriteFile(confPath, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}

	drive := filepath.VolumeName(confPath)
	aliasBase := globalRootVolumePath(t, drive)
	name := strings.TrimPrefix(confPath, drive)
	for _, test := range []struct {
		name string
		path string
	}{
		{"扩展长度 GLOBALROOT", `\\?\` + aliasBase + name},
		{"设备命名空间 GLOBALROOT", `\\.\` + aliasBase + name},
		{"小写 GLOBALROOT", `\\?\` + strings.ToLower(aliasBase) + name},
		{"卷影副本形态", `\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy1\conf\conf.json`},
	} {
		t.Run(test.name, func(t *testing.T) {
			if !IsSensitivePath(test.path) {
				t.Errorf("IsSensitivePath(%q) = false, want true (device namespace bypass)", test.path)
			}
		})
	}

	// 常规路径的敏感判定不能因本次改动而失效
	if !IsSensitivePath(confPath) {
		t.Errorf("IsSensitivePath(%q) = false, want true", confPath)
	}

	// 同一卷的常规盘符路径不受设备命名空间规则影响，否则会阻断工作空间内的合法读写
	if IsSensitivePath(filepath.Join(WorkspaceDir, "data", "assets", "image.png")) {
		t.Errorf("workspace asset path is treated as sensitive")
	}

	// 别名确实指向该文件，说明拒绝不是路径不存在导致的
	f, err := os.Open(`\\?\` + aliasBase + name)
	if err != nil {
		t.Logf("real volume device path is not openable here: %v", err)
		return
	}
	f.Close()
}

// TestIsSensitivePathDosDeviceAliases 使用真实文件验证对象管理器别名不能绕过敏感路径检查。
func TestIsSensitivePathDosDeviceAliases(t *testing.T) {
	originalHome, originalWorkspace := HomeDir, WorkspaceDir
	HomeDir, WorkspaceDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { HomeDir, WorkspaceDir = originalHome, originalWorkspace })

	drive := filepath.VolumeName(WorkspaceDir)
	if len(drive) != 2 || drive[1] != ':' {
		t.Skipf("workspace volume is not a drive letter: %s", drive)
	}
	confPath := filepath.Join(WorkspaceDir, "conf", "conf.json")
	if err := os.MkdirAll(filepath.Dir(confPath), 0700); err != nil {
		t.Fatal(err)
	}
	const fixture = "namespace alias fixture"
	if err := os.WriteFile(confPath, []byte(fixture), 0600); err != nil {
		t.Fatal(err)
	}

	for _, prefix := range []string{`\\?\`, `\\.\`} {
		for _, alias := range []string{`GLOBALROOT\GLOBAL??\`, `GLOBALROOT\??\`, `GLOBALROOT\DosDevices\`, `Global\`} {
			p := prefix + alias + confPath
			t.Run(prefix+alias, func(t *testing.T) {
				// 先核实别名确实读取同一文件，避免仅凭构造出的路径判断修复是否有效。
				data, err := os.ReadFile(p)
				if err != nil {
					t.Fatalf("read fixture through alias: %v", err)
				}
				if string(data) != fixture {
					t.Fatalf("alias read %q, want %q", data, fixture)
				}
				for _, variant := range []string{p, strings.ToLower(p), strings.ReplaceAll(p, `\`, "/")} {
					// 同时覆盖新建目标，不能依赖文件存在或符号链接解析才能识别命名空间。
					for _, target := range []string{variant, filepath.Join(filepath.Dir(variant), "new", "conf.json")} {
						if !IsSensitivePath(target) {
							t.Errorf("IsSensitivePath(%q) = false, want true", target)
						}
						if !IsSensitiveHTMLAssetPath(target) {
							t.Errorf("IsSensitiveHTMLAssetPath(%q) = false, want true", target)
						}
					}
				}
			})
		}
	}
}

// globalRootVolumePath 返回形如 `GLOBALROOT\Device\HarddiskVolume3\` 的卷设备路径前缀。
func globalRootVolumePath(t *testing.T, drive string) string {
	t.Helper()

	volume, err := queryDosDevice(drive)
	if err != nil {
		t.Skipf("query dos device %q failed: %v", drive, err)
	}
	if !strings.HasPrefix(volume, `\Device\`) {
		t.Skipf("unexpected dos device path %q", volume)
	}

	return `GLOBALROOT` + volume + `\`
}

// queryDosDevice 返回盘符（如 `D:`）对应的设备路径（如 `\Device\HarddiskVolume3`）。
func queryDosDevice(drive string) (string, error) {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("QueryDosDeviceW")

	drivePtr, err := syscall.UTF16PtrFromString(drive)
	if err != nil {
		return "", err
	}
	buf := make([]uint16, 1024)
	count, _, callErr := proc.Call(uintptr(unsafe.Pointer(drivePtr)), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if count == 0 {
		return "", callErr
	}
	return syscall.UTF16ToString(buf), nil
}
