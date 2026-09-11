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
	"strings"
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

// setupProbeWorkspace 准备临时工作区并接管全局路径，返回工作区根目录。
func setupProbeWorkspace(t *testing.T) string {
	t.Helper()
	workspace := t.TempDir()
	origWorkspace, origData, origConf, origTemp, origLog := util.WorkspaceDir, util.DataDir, util.ConfDir, util.TempDir, util.LogPath
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.ConfDir = filepath.Join(workspace, "conf")
	util.TempDir = filepath.Join(workspace, "temp")
	util.LogPath = filepath.Join(util.TempDir, "siyuan.log")
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir, util.ConfDir, util.TempDir, util.LogPath = origWorkspace, origData, origConf, origTemp, origLog
	})
	return workspace
}

func writeProbeFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir [%s] failed: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(data), 0644); err != nil {
		t.Fatalf("write [%s] failed: %v", path, err)
	}
}

func probeText(result CallToolResult) string {
	var builder strings.Builder
	for _, item := range result.Content {
		builder.WriteString(item.Text)
	}
	return builder.String()
}

// TestSecurityReproRecursiveFileOperationsRejectSensitiveDescendants 验证递归遍历、复制、删除和重命名
// 都不会绕过敏感文件黑名单：容器路径合法不代表其全部后代合法，见 GHSA-9g6v-r3xf-673q。
func TestSecurityReproRecursiveFileOperationsRejectSensitiveDescendants(t *testing.T) {
	workspace := setupProbeWorkspace(t)
	const secret = "SYNTHETIC-ACCESS-CODE-9f2c"
	confFile := filepath.Join(util.ConfDir, "conf.json")
	writeProbeFile(t, confFile, `{"accessAuthCode":"`+secret+`"}`)
	writeProbeFile(t, filepath.Join(util.DataDir, "snippets", "conf.json"), `{"snippet":"`+secret+`"}`)
	writeProbeFile(t, filepath.Join(util.DataDir, ".siyuan", "publishAccess.json"), `{"password":"`+secret+`"}`)
	writeProbeFile(t, filepath.Join(util.DataDir, "notes", "plain.txt"), "ordinary line\n")

	// 直接访问仍然被拒绝，作为后续递归用例的对照
	if result, _ := fileRead(map[string]any{"path": "conf/conf.json"}); !result.IsError {
		t.Errorf("file.read(conf/conf.json) = %q, want forbidden", probeText(result))
	}

	// grep 不得经允许目录读出敏感后代，隐藏目录与普通文件的既有语义保持不变
	for _, root := range []string{"conf", "data"} {
		result, _ := fileGrep(map[string]any{"pattern": "SYNTHETIC", "path": root})
		if strings.Contains(probeText(result), secret) {
			t.Errorf("file.grep(%s) leaked sensitive content: %q", root, probeText(result))
		}
	}
	if result, _ := fileGrep(map[string]any{"pattern": "ordinary", "path": "data"}); !strings.Contains(probeText(result), "ordinary line") {
		t.Errorf("file.grep(data) = %q, want the ordinary match", probeText(result))
	}

	// 复制目录不得复制敏感后代，且被拒绝时不得产生部分复制
	if result, _ := fileCopy(map[string]any{"src": "conf", "dst": "data/backup"}); !result.IsError {
		t.Errorf("file.copy(conf -> data/backup) = %q, want forbidden", probeText(result))
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "backup")); !os.IsNotExist(err) {
		t.Errorf("file.copy produced partial output at data/backup: %v", err)
	}
	if result, _ := fileCopy(map[string]any{"src": "data/snippets", "dst": "data/exfil"}); !result.IsError {
		t.Errorf("file.copy(data/snippets -> data/exfil) = %q, want forbidden", probeText(result))
	}

	// 重命名和删除目录不得搬移或删除敏感后代
	if result, _ := fileRename(map[string]any{"old": "conf", "new": "data/moved"}); !result.IsError {
		t.Errorf("file.rename(conf -> data/moved) = %q, want forbidden", probeText(result))
	}
	if _, err := os.Stat(confFile); err != nil {
		t.Errorf("sensitive file was moved away: %v", err)
	}
	writeProbeFile(t, confFile, `{"accessAuthCode":"`+secret+`"}`) // 恢复现场，让删除用例独立于重命名用例
	if result, _ := fileDelete(map[string]any{"path": "conf"}); !result.IsError {
		t.Errorf("file.delete(conf) = %q, want forbidden", probeText(result))
	}
	if _, err := os.Stat(confFile); err != nil {
		t.Errorf("sensitive file was removed: %v", err)
	}

	// 列表和查找不得枚举出敏感文件名
	if result, _ := fileList(map[string]any{"path": "conf"}); strings.Contains(probeText(result), "conf.json") {
		t.Errorf("file.list(conf) exposed a sensitive name: %q", probeText(result))
	}
	if result, _ := fileFind(map[string]any{"path": "conf"}); strings.Contains(probeText(result), "conf.json") {
		t.Errorf("file.find(conf) exposed a sensitive name: %q", probeText(result))
	}

	// 安全路径的复制与读取不受影响
	if result, _ := fileCopy(map[string]any{"src": "data/notes", "dst": "data/copy"}); result.IsError {
		t.Errorf("file.copy(data/notes -> data/copy) failed: %q", probeText(result))
	}
	if result, _ := fileRead(map[string]any{"path": "data/copy/plain.txt"}); result.IsError || !strings.Contains(probeText(result), "ordinary line") {
		t.Errorf("file.read(data/copy/plain.txt) = %q, want the copied content", probeText(result))
	}
	if _, err := os.Stat(filepath.Join(workspace, "data", "copy", "plain.txt")); err != nil {
		t.Errorf("safe copy missing: %v", err)
	}
}
