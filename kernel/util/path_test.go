// SiYuan - Refactor your thinking
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
	"testing"
)

// TestIsSensitivePathCredentialDotfiles 覆盖 GHSA 报告中遗漏的家目录凭据 dotfile，
// 确保它们在 globalCopyFiles 等接受工作空间外绝对路径的接口处被拒绝。
func TestIsSensitivePathCredentialDotfiles(t *testing.T) {
	tmpHome := t.TempDir()
	tmpWorkspace := t.TempDir()
	origHome, origWorkspace := HomeDir, WorkspaceDir
	HomeDir, WorkspaceDir = tmpHome, tmpWorkspace
	t.Cleanup(func() { HomeDir, WorkspaceDir = origHome, origWorkspace })

	// 报告点名的攻击面 + 常见云/包管理器凭据。
	cases := []struct {
		name string
		rel  string // 相对 HomeDir 的路径
	}{
		{"git-credentials", ".git-credentials"},
		{"netrc", ".netrc"},
		{"pgpass", ".pgpass"},
		{"kube config", filepath.Join(".kube", "config")},
		{"docker config", filepath.Join(".docker", "config.json")},
		{"gnupg private keyring", filepath.Join(".gnupg", "private-keys-v1.d", "key.key")},
		{"aws credentials", filepath.Join(".aws", "credentials")},
		{"azure token", filepath.Join(".azure", "accessTokens.json")},
		{"npmrc", ".npmrc"},
		{"pypirc", ".pypirc"},
		// 原有黑名单项不应回归。
		{"ssh id_rsa", filepath.Join(".ssh", "id_rsa")},
		{"bashrc", ".bashrc"},
		{"config dir", filepath.Join(".config", "some-app")},
	}
	for _, c := range cases {
		abs := filepath.Join(tmpHome, c.rel)
		if got := IsSensitivePath(abs); !got {
			t.Errorf("IsSensitivePath(%q) = false, want true [%s]", abs, c.name)
		}
	}
}

// TestIsSensitivePathSymlinkBypass 验证通过符号链接绕过黑名单的尝试会被拦截：
// 在非敏感目录下放置一个指向 ~/.ssh/id_rsa 的符号链接，解析后应判定为敏感。
func TestIsSensitivePathSymlinkBypass(t *testing.T) {
	tmpHome := t.TempDir()
	tmpWorkspace := t.TempDir()
	origHome, origWorkspace := HomeDir, WorkspaceDir
	HomeDir, WorkspaceDir = tmpHome, tmpWorkspace
	t.Cleanup(func() { HomeDir, WorkspaceDir = origHome, origWorkspace })

	target := filepath.Join(tmpHome, ".ssh", "id_rsa")
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(target, []byte("PRIVATE"), 0600); err != nil {
		t.Fatalf("write target: %v", err)
	}

	// 在一个看起来无害的位置（家目录外的临时目录）放符号链接。
	innocentDir := t.TempDir()
	link := filepath.Join(innocentDir, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink not supported on this platform: %v", err)
	}

	// link 自身的路径不命中黑名单，但解析后指向 .ssh，应被拒绝。
	if got := IsSensitivePath(link); !got {
		t.Errorf("IsSensitivePath(symlink -> .ssh) = false, want true")
	}
}

// TestIsSensitivePathWorkspaceFilesNotBlocked 确保工作空间内的合法文件不会被误判。
func TestIsSensitivePathWorkspaceFilesNotBlocked(t *testing.T) {
	tmpWorkspace := t.TempDir()
	origWorkspace := WorkspaceDir
	WorkspaceDir = tmpWorkspace
	t.Cleanup(func() { WorkspaceDir = origWorkspace })

	cases := []string{
		filepath.Join(tmpWorkspace, "data", "assets", "image.png"),
		filepath.Join(tmpWorkspace, "data", "note.md"),
		filepath.Join(tmpWorkspace, "temp", "export", "output.pdf"),
	}
	for _, p := range cases {
		if got := IsSensitivePath(p); got {
			t.Errorf("IsSensitivePath(%q) = true, want false (workspace file)", p)
		}
	}
}
