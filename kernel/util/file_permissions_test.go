// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func requirePermissionTest(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Windows 由用户目录的访问控制保护，POSIX 权限不适用")
	}
}

func permissionMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat [%s] failed: %s", path, err)
	}
	return info.Mode().Perm()
}

func TestRestrictConfFilePermissions(t *testing.T) {
	requirePermissionTest(t)
	oldConfDir, oldReadOnly := ConfDir, ReadOnly
	t.Cleanup(func() {
		ConfDir, ReadOnly = oldConfDir, oldReadOnly
	})
	ConfDir, ReadOnly = t.TempDir(), false

	confPath, keyPath := filepath.Join(ConfDir, "conf.json"), filepath.Join(ConfDir, TLSKeyFilename)
	for _, path := range []string{confPath, keyPath} {
		if err := os.WriteFile(path, []byte("{}"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	RestrictConfFilePermissions()
	for _, path := range []string{confPath, keyPath} {
		if perm := permissionMode(t, path); 0600 != perm {
			t.Fatalf("permission of [%s] is %#o, want 0600", filepath.Base(path), perm)
		}
	}

	// 已收紧的文件重复调用保持原权限
	RestrictConfFilePermissions()
	if perm := permissionMode(t, confPath); 0600 != perm {
		t.Fatalf("permission changed by repeated restriction: %#o", perm)
	}
}

func TestRestrictConfFilePermissionsWithoutTLSKey(t *testing.T) {
	requirePermissionTest(t)
	oldConfDir, oldReadOnly := ConfDir, ReadOnly
	t.Cleanup(func() {
		ConfDir, ReadOnly = oldConfDir, oldReadOnly
	})
	ConfDir, ReadOnly = t.TempDir(), false

	confPath := filepath.Join(ConfDir, "conf.json")
	if err := os.WriteFile(confPath, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	RestrictConfFilePermissions()
	if perm := permissionMode(t, confPath); 0600 != perm {
		t.Fatalf("permission is %#o, want 0600", perm)
	}
}

func TestRestrictConfFilePermissionsReadOnly(t *testing.T) {
	requirePermissionTest(t)
	oldConfDir, oldReadOnly := ConfDir, ReadOnly
	t.Cleanup(func() {
		ConfDir, ReadOnly = oldConfDir, oldReadOnly
	})
	ConfDir, ReadOnly = t.TempDir(), true

	confPath := filepath.Join(ConfDir, "conf.json")
	if err := os.WriteFile(confPath, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	RestrictConfFilePermissions()
	if perm := permissionMode(t, confPath); 0644 != perm {
		t.Fatalf("read-only workspace permission changed to %#o", perm)
	}
}
