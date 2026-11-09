// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"path/filepath"
	"runtime"
	"testing"
)

// TestIsSensitivePathForeignUserHome 验证其他 OS 用户的家目录整体按敏感路径处理，
// 内核自身家目录仍可用于导入，其凭据条目由家目录点文件规则单独拦截。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-wg79-89vp-f9vw
func TestIsSensitivePathForeignUserHome(t *testing.T) {
	originalHome, originalSystemHome, originalWorkspace := HomeDir, systemHomeDir, WorkspaceDir
	t.Cleanup(func() { HomeDir, systemHomeDir, WorkspaceDir = originalHome, originalSystemHome, originalWorkspace })
	WorkspaceDir = t.TempDir()
	systemHomeDir = ""

	var ownHome, foreignHome string
	switch runtime.GOOS {
	case "windows":
		ownHome, foreignHome = `C:\Users\kernel-user`, `C:\Users\other-user`
	case "darwin":
		ownHome, foreignHome = "/Users/kernel-user", "/Users/other-user"
	default:
		ownHome, foreignHome = "/home/kernel-user", "/home/other-user"
	}
	HomeDir = ownHome

	sensitive := []string{
		filepath.Join(foreignHome, "notes.txt"),
		filepath.Join(foreignHome, ".ssh", "authorized_keys"),
		filepath.Join(foreignHome, ".aws", "config"),
		filepath.Join(ownHome, ".ssh", "id_rsa"),
	}
	for _, p := range sensitive {
		if !IsSensitivePath(p) {
			t.Errorf("IsSensitivePath(%q) = false, want true", p)
		}
	}

	allowed := []string{
		filepath.Join(ownHome, "notes.txt"),
		filepath.Join(ownHome, "Documents", "report.pdf"),
	}
	for _, p := range allowed {
		if IsSensitivePath(p) {
			t.Errorf("IsSensitivePath(%q) = true, want false", p)
		}
	}

	// 工作空间位于其他用户家目录时仍需可读写，归属判断优先于家目录黑名单。
	WorkspaceDir = filepath.Join(foreignHome, "SiYuan")
	if IsSensitivePath(filepath.Join(WorkspaceDir, "data", "note.sy")) {
		t.Errorf("workspace file under a foreign home was treated as sensitive")
	}
}

// TestIsSensitivePathMountPoints 验证 /mnt、/media、/snap 不再作为工作空间外的导入来源。
func TestIsSensitivePathMountPoints(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("/mnt, /media and /snap are UNIX mount points")
	}
	originalWorkspace := WorkspaceDir
	t.Cleanup(func() { WorkspaceDir = originalWorkspace })
	WorkspaceDir = t.TempDir()

	for _, p := range []string{
		"/mnt/test-secret.txt",
		"/media/usb/test-secret.txt",
		"/snap/somepkg/test-secret.txt",
	} {
		if !IsSensitivePath(p) {
			t.Errorf("IsSensitivePath(%q) = false, want true", p)
		}
	}
}
