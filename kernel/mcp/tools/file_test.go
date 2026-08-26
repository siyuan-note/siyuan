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

package tools

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestSecurityReproMCPReadsPublishAccessMetadata 验证 MCP 文件工具无法读取受保护的
// data/.siyuan/publishAccess.json：真实路径、大小写变体以及符号链接父目录均会被拦截，
// 修复 GHSA-mmgw-3mx9-cfwp 中 Linux 上大小写敏感比较导致的黑名单失效问题。
func TestSecurityReproMCPReadsPublishAccessMetadata(t *testing.T) {
	tmpWorkspace := t.TempDir()
	origWorkspace, origData := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = tmpWorkspace
	util.DataDir = filepath.Join(tmpWorkspace, "data")
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir = origWorkspace, origData })

	publishAccess := filepath.Join(util.DataDir, ".siyuan", "publishAccess.json")
	if err := os.MkdirAll(filepath.Dir(publishAccess), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(publishAccess, []byte(`{"id":"","password":"secret"}`), 0644); err != nil {
		t.Fatalf("write publishAccess.json: %v", err)
	}

	// 真实路径与大小写变体均应被拦截；Linux 上此前真实驼峰路径无法命中全小写黑名单条目。
	cases := []string{
		filepath.Join("data", ".siyuan", "publishAccess.json"),
		filepath.Join("data", ".siyuan", "PUBLISHACCESS.JSON"),
		filepath.Join("data", ".SIYUAN", "PublishAccess.json"),
	}
	for _, c := range cases {
		if _, err := resolvePath(c); err == nil {
			t.Errorf("resolvePath(%q) = nil error, want forbidden", c)
		}
	}

	// 通过指向 .siyuan 目录的符号链接父目录访问同样应被拦截。
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	parentLink := filepath.Join(util.DataDir, "assets", "siyuan-link")
	if err := os.Symlink(filepath.Join(util.DataDir, ".siyuan"), parentLink); err != nil {
		t.Skipf("symlink not supported on this platform: %v", err)
	}
	if _, err := resolvePath(filepath.Join("data", "assets", "siyuan-link", "publishAccess.json")); err == nil {
		t.Errorf("resolvePath(symlinked parent -> publishAccess.json) = nil error, want forbidden")
	}
}
