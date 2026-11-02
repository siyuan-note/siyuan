// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const legacyTestCookieKey = "abcdefgh12345678"

func setupCookieKeyTest(t *testing.T) string {
	t.Helper()
	previousHome := util.HomeDir
	util.HomeDir = t.TempDir()
	t.Cleanup(func() { util.HomeDir = previousHome })
	if err := os.MkdirAll(filepath.Join(util.HomeDir, ".config", "siyuan"), 0755); err != nil {
		t.Fatal(err)
	}
	return cookieKeyPath()
}

func assertCookieKeyFile(t *testing.T, keyPath, want string) {
	t.Helper()
	data, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != want {
		t.Fatalf("cookie key file = %q, want %q", data, want)
	}
	if runtime.GOOS == "windows" {
		return
	}
	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Fatalf("cookie key file permission = %o, want 600", perm)
	}
}

func TestLoadCookieKeyGeneratesAndRestores(t *testing.T) {
	for _, tc := range []struct {
		name, confKey string
		restored      bool
	}{
		{"fresh installation", "", false},
		{"legacy workspace configuration", legacyTestCookieKey, false},
		{"recreated home directory", "restored-cookie-key-0123456789abcdefghij", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			keyPath := setupCookieKeyTest(t)
			key := loadCookieKey(tc.confKey)
			if len(key) < cookieKeyMinLen || (key == tc.confKey) != tc.restored {
				t.Fatalf("unexpected cookie key %q for configuration key %q", key, tc.confKey)
			}
			assertCookieKeyFile(t, keyPath, key)
			if again := loadCookieKey(""); again != key {
				t.Fatalf("cookie key changed between boots: %q, %q", key, again)
			}
		})
	}
}

func TestLoadCookieKeyReplacesLegacyFileOnce(t *testing.T) {
	keyPath := setupCookieKeyTest(t)
	if err := os.WriteFile(keyPath, []byte(legacyTestCookieKey+"\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// 同时启动的多个工作空间必须得到同一个替换后的密钥，否则共用的会话 Cookie 会互相失效。
	keys := make([]string, 8)
	var wg sync.WaitGroup
	for i := range keys {
		wg.Add(1)
		go func() {
			defer wg.Done()
			keys[i] = loadCookieKey(legacyTestCookieKey)
		}()
	}
	wg.Wait()
	for _, key := range keys {
		if key != keys[0] {
			t.Fatalf("concurrent kernels loaded different cookie keys: %q", keys)
		}
	}
	if len(keys[0]) < cookieKeyMinLen || keys[0] == legacyTestCookieKey {
		t.Fatalf("legacy cookie key was not replaced: %q", keys[0])
	}
	assertCookieKeyFile(t, keyPath, keys[0])
}

func TestLoadCookieKeyKeepsLegacyFileWhenReplacementFails(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("directory permissions do not prevent writes")
	}
	keyPath := setupCookieKeyTest(t)
	if err := os.WriteFile(keyPath, []byte(legacyTestCookieKey), 0600); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Dir(keyPath)
	if err := os.Chmod(dir, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0755) })
	if key := loadCookieKey(legacyTestCookieKey); key != legacyTestCookieKey {
		t.Fatalf("kernel used an unsaved cookie key %q while other workspaces read the legacy file", key)
	}
	assertCookieKeyFile(t, keyPath, legacyTestCookieKey)
}

func TestLoadCookieKeyKeepsCurrentFile(t *testing.T) {
	keyPath := setupCookieKeyTest(t)
	const current = "current-cookie-key-0123456789abcdefghijkl"
	if err := os.WriteFile(keyPath, []byte(current), 0644); err != nil {
		t.Fatal(err)
	}
	if key := loadCookieKey("other-workspace-cookie-key-0123456789abcd"); key != current {
		t.Fatalf("shared cookie key file was not preferred: %q", key)
	}
	assertCookieKeyFile(t, keyPath, current)
}

func TestLoadCookieKeyDoesNotOverwriteUnreadableFile(t *testing.T) {
	keyPath := setupCookieKeyTest(t)
	if err := os.Mkdir(keyPath, 0700); err != nil {
		t.Fatal(err)
	}
	const confKey = "workspace-cookie-key-0123456789abcdefghij"
	if key := loadCookieKey(confKey); key != confKey {
		t.Fatalf("unreadable key file did not fall back to the workspace key: %q", key)
	}
	if key := loadCookieKey(legacyTestCookieKey); len(key) < cookieKeyMinLen {
		t.Fatalf("unreadable key file kept a legacy workspace key: %q", key)
	}
	if info, err := os.Stat(keyPath); err != nil || !info.IsDir() {
		t.Fatalf("unreadable key file was replaced: %v", err)
	}
}
