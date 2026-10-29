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

// TestIsSensitivePathPlatformWorkspace 覆盖平台应用数据目录中的工作空间及其访问边界。
func TestIsSensitivePathPlatformWorkspace(t *testing.T) {
	originalHome, originalWorkspace := HomeDir, WorkspaceDir
	originalEntries, hadEntries := platformSensitiveHomeEntries[runtime.GOOS]
	t.Cleanup(func() {
		HomeDir, WorkspaceDir = originalHome, originalWorkspace
		if hadEntries {
			platformSensitiveHomeEntries[runtime.GOOS] = originalEntries
		} else {
			delete(platformSensitiveHomeEntries, runtime.GOOS)
		}
	})

	// 注入各平台的目录规则，使所有运行平台都能验证 macOS 和 Windows 的工作空间布局。
	for _, layout := range []struct {
		name      string
		platform  string
		workspace string
		external  string
	}{
		{"macOS default", "darwin", "Library/Application Support/SiYuan", "Library/Keychains/login.keychain-db"},
		{"macOS iCloud", "darwin", "Library/Mobile Documents/SiYuan", "Library/Keychains/login.keychain-db"},
		{"Windows roaming", "windows", "AppData/Roaming/SiYuan", "AppData/Roaming/gcloud/token.db"},
		{"Windows local", "windows", "AppData/Local/SiYuan", "AppData/Local/Google/Chrome/profile.db"},
	} {
		t.Run(layout.name, func(t *testing.T) {
			entries := originalEntries
			if layout.platform != runtime.GOOS {
				entries = platformSensitiveHomeEntries[layout.platform]
			}
			// 测试目录位于系统临时目录内，关闭临时目录例外以独立验证工作空间例外。
			entries = append([]sensitiveHomeEntry(nil), entries...)
			for i := range entries {
				entries[i].exemptSystemTemp = false
			}
			platformSensitiveHomeEntries[runtime.GOOS] = entries
			home, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			HomeDir = home
			realWorkspace := filepath.Join(home, filepath.FromSlash(layout.workspace))
			WorkspaceDir = realWorkspace
			if err := os.MkdirAll(realWorkspace, 0755); err != nil {
				t.Fatal(err)
			}

			checkPaths := func(t *testing.T, root string) {
				t.Helper()
				for _, checker := range []struct {
					name  string
					check func(string) bool
				}{
					{"file", IsSensitivePath},
					{"HTML asset", IsSensitiveHTMLAssetPath},
				} {
					for _, test := range []struct {
						rel       string
						sensitive bool
					}{
						{"data/assets/image.png", false},
						{"data/assets/attachment.pdf", false},
						{"data/20260806000000-abcdefg/assets/image.png", false},
						{"data/plugins/example/icon.png", false},
						{"data/widgets/example/index.html", false},
						{"data/emojis/example.svg", false},
						{"temp/export/new/document.html", false},
						{"conf/conf.json", true},
						{"conf/new/config.json", true},
						{"temp/private.txt", true},
						{"data/assets/credentials.json", true},
						{"data/assets/id_rsa", true},
					} {
						p := filepath.Join(root, filepath.FromSlash(test.rel))
						if got := checker.check(p); got != test.sensitive {
							t.Errorf("%s check(%q) = %v, want %v", checker.name, p, got, test.sensitive)
						}
					}
					for _, p := range []string{
						realWorkspace + "-outside" + string(filepath.Separator) + "image.png",
						filepath.Join(home, filepath.FromSlash(layout.external)),
						filepath.Join(home, ".ssh", "config"),
						filepath.Join(home, ".env.local"),
					} {
						if !checker.check(p) {
							t.Errorf("%s check allowed external sensitive path %q", checker.name, p)
						}
					}
				}
			}
			checkPaths(t, realWorkspace)
			t.Run("workspace alias", func(t *testing.T) {
				WorkspaceDir = filepath.Join(t.TempDir(), "workspace")
				if err := os.Symlink(realWorkspace, WorkspaceDir); err != nil {
					t.Skipf("create workspace symlink: %v", err)
				}
				checkPaths(t, WorkspaceDir)
				checkPaths(t, realWorkspace)
			})
		})
	}
}
