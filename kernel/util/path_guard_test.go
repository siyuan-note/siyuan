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

// TestIsForbiddenAbsPath 覆盖 HTTP 文件 API 与 MCP 文件工具共用的敏感路径黑名单：
// conf 目录下的 conf.json 与 TLS 密钥材料、data/snippets/conf.json、data/templates 目录、
// data/.siyuan/publishAccess.json、笔记本目录下的 .siyuan 内部文件以及 temp 目录下的
// siyuan.log 日志文件。
func TestIsForbiddenAbsPath(t *testing.T) {
	tmpWorkspace := t.TempDir()
	origWorkspace, origConf, origData, origTemp, origLog := WorkspaceDir, ConfDir, DataDir, TempDir, LogPath
	WorkspaceDir = tmpWorkspace
	ConfDir = filepath.Join(tmpWorkspace, "conf")
	DataDir = filepath.Join(tmpWorkspace, "data")
	TempDir = filepath.Join(tmpWorkspace, "temp")
	LogPath = filepath.Join(TempDir, "siyuan.log")
	t.Cleanup(func() {
		WorkspaceDir, ConfDir, DataDir, TempDir, LogPath = origWorkspace, origConf, origData, origTemp, origLog
	})

	cases := []struct {
		name string
		rel  string // 相对工作空间的路径
	}{
		{"conf", filepath.Join("conf", "conf.json")},
		{"tls ca cert", filepath.Join("conf", TLSCACertFilename)},
		{"tls ca key", filepath.Join("conf", TLSCAKeyFilename)},
		{"tls cert", filepath.Join("conf", TLSCertFilename)},
		{"tls key", filepath.Join("conf", TLSKeyFilename)},
		{"snippets conf", filepath.Join("data", "snippets", "conf.json")},
		{"templates dir", filepath.Join("data", "templates")},
		{"templates file", filepath.Join("data", "templates", "a.txt")},
		{"publish access", filepath.Join("data", ".siyuan", "publishAccess.json")},
		{"notebook conf", filepath.Join("data", "20210808180117-6v0mkxr", ".siyuan", "conf.json")},
		{"notebook sort", filepath.Join("data", "20210808180117-6v0mkxr", ".siyuan", "sort.json")},
		{"log", filepath.Join("temp", "siyuan.log")},
	}
	for _, c := range cases {
		abs := filepath.Join(tmpWorkspace, c.rel)
		if got := IsForbiddenAbsPath(abs); !got {
			t.Errorf("IsForbiddenAbsPath(%q) = false, want true [%s]", abs, c.name)
		}
	}

	// 工作空间内的合法文件不应被误判。
	allowed := []string{
		filepath.Join(tmpWorkspace, "data", "assets", "image.png"),
		filepath.Join(tmpWorkspace, "data", "snippets", "custom.css"),
		filepath.Join(tmpWorkspace, "data", "plugins", "example", "main.js"),
		filepath.Join(tmpWorkspace, "data", "20210808180117-6v0mkxr", "20240101.sy"),
		filepath.Join(tmpWorkspace, "data", "20210808180117-6v0mkxr", "conf.json"),
		filepath.Join(tmpWorkspace, "temp", "siyuan", "kernel.log"),
	}
	for _, p := range allowed {
		if got := IsForbiddenAbsPath(p); got {
			t.Errorf("IsForbiddenAbsPath(%q) = true, want false (workspace file)", p)
		}
	}
}

// TestIsForbiddenAbsPathCaseInsensitive 在大小写不敏感的文件系统上验证大小写变体无法绕过黑名单。
func TestIsForbiddenAbsPathCaseInsensitive(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "darwin" {
		t.Skip("case-insensitive comparison only on windows/darwin")
	}
	tmpWorkspace := t.TempDir()
	origWorkspace, origConf, origData, origTemp, origLog := WorkspaceDir, ConfDir, DataDir, TempDir, LogPath
	WorkspaceDir = tmpWorkspace
	ConfDir = filepath.Join(tmpWorkspace, "conf")
	DataDir = filepath.Join(tmpWorkspace, "data")
	TempDir = filepath.Join(tmpWorkspace, "temp")
	LogPath = filepath.Join(TempDir, "siyuan.log")
	t.Cleanup(func() {
		WorkspaceDir, ConfDir, DataDir, TempDir, LogPath = origWorkspace, origConf, origData, origTemp, origLog
	})

	// 模拟 MCP 工具输入的大小写变体路径（Windows 上 CONF.JSON 与 conf.json 指向同一文件）。
	cases := []string{
		filepath.Join(tmpWorkspace, "CONF", "CONF.JSON"),
		filepath.Join(tmpWorkspace, "CONF", strings.ToUpper(TLSCACertFilename)),
		filepath.Join(tmpWorkspace, "CONF", strings.ToUpper(TLSCAKeyFilename)),
		filepath.Join(tmpWorkspace, "CONF", strings.ToUpper(TLSCertFilename)),
		filepath.Join(tmpWorkspace, "CONF", strings.ToUpper(TLSKeyFilename)),
		filepath.Join(tmpWorkspace, "DATA", "SNIPPETS", "CONF.JSON"),
		filepath.Join(tmpWorkspace, "DATA", ".SIYUAN", "PUBLISHACCESS.JSON"),
		strings.ToUpper(filepath.Join(tmpWorkspace, "data", "20210808180117-6v0mkxr", ".siyuan", "conf.json")),
		strings.ToUpper(filepath.Join(tmpWorkspace, "data", "templates")),
		strings.ToUpper(filepath.Join(tmpWorkspace, "temp", "siyuan.log")),
	}
	for _, p := range cases {
		if got := IsForbiddenAbsPath(p); !got {
			t.Errorf("IsForbiddenAbsPath(%q) = false, want true (case variant)", p)
		}
	}
}

// TestIsForbiddenAbsPathSymlinkBypass 验证通过符号链接指向敏感文件的路径会被拦截。
func TestIsForbiddenAbsPathSymlinkBypass(t *testing.T) {
	tmpWorkspace := t.TempDir()
	origWorkspace, origConf, origData := WorkspaceDir, ConfDir, DataDir
	WorkspaceDir = tmpWorkspace
	ConfDir = filepath.Join(tmpWorkspace, "conf")
	DataDir = filepath.Join(tmpWorkspace, "data")
	t.Cleanup(func() { WorkspaceDir, ConfDir, DataDir = origWorkspace, origConf, origData })

	target := filepath.Join(tmpWorkspace, "data", ".siyuan", "publishAccess.json")
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(target, []byte(`{"id":"","password":"secret"}`), 0644); err != nil {
		t.Fatalf("write target: %v", err)
	}

	// 在 data/assets 下放一个指向 publishAccess.json 的符号链接。
	link := filepath.Join(tmpWorkspace, "data", "assets", "leak.json")
	if err := os.MkdirAll(filepath.Dir(link), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink not supported on this platform: %v", err)
	}

	// 链接自身路径不命中黑名单，但解析后指向敏感文件，应被拒绝。
	if got := IsForbiddenAbsPath(link); !got {
		t.Errorf("IsForbiddenAbsPath(symlink -> publishAccess.json) = false, want true")
	}

	// 同样验证指向 TLS 私钥的符号链接无法绕过黑名单。
	tlsKey := filepath.Join(tmpWorkspace, "conf", TLSKeyFilename)
	if err := os.MkdirAll(filepath.Dir(tlsKey), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(tlsKey, []byte("-----BEGIN EC PRIVATE KEY-----\n"), 0600); err != nil {
		t.Fatalf("write tls key: %v", err)
	}
	tlsKeyLink := filepath.Join(tmpWorkspace, "data", "assets", "leak.pem")
	if err := os.Symlink(tlsKey, tlsKeyLink); err != nil {
		t.Skipf("symlink not supported on this platform: %v", err)
	}
	if got := IsForbiddenAbsPath(tlsKeyLink); !got {
		t.Errorf("IsForbiddenAbsPath(symlink -> key.pem) = false, want true")
	}

	// 符号链接指向的父目录同样无法绕过黑名单：经由链接目录访问 publishAccess.json 应被拦截。
	parentLink := filepath.Join(tmpWorkspace, "data", "assets", "siyuan-link")
	if err := os.Symlink(filepath.Join(DataDir, ".siyuan"), parentLink); err != nil {
		t.Skipf("symlink not supported on this platform: %v", err)
	}
	if got := IsForbiddenAbsPath(filepath.Join(parentLink, "publishAccess.json")); !got {
		t.Errorf("IsForbiddenAbsPath(symlinked parent -> publishAccess.json) = false, want true")
	}
}

// TestIsForbiddenDataRelPath 覆盖 /history 与 /repo/diff 路由共用的数据相对路径片段匹配黑名单。
// 历史快照副本位于 HistoryDir 等绝对路径下，无法用 IsForbiddenAbsPath 精确匹配，因此按数据目录下的
// 相对位置拦截：data/snippets/conf.json、data/templates 目录、data/.siyuan/publishAccess.json
// 以及笔记本目录下的 .siyuan 内部文件。
func TestIsForbiddenDataRelPath(t *testing.T) {
	forbidden := []string{
		".siyuan/publishAccess.json",
		"/.siyuan/publishAccess.json",
		filepath.Join(".siyuan", "publishAccess.json"),
		".siyuan/PUBLISHACCESS.JSON",
		filepath.Join(".SIYUAN", "PublishAccess.json"),
		"templates",
		"/templates",
		filepath.Join("templates", "a.md"),
		"snippets/conf.json",
		filepath.Join("snippets", "conf.json"),
		filepath.Join("20210808180117-6v0mkxr", ".siyuan", "conf.json"),
		filepath.Join("20210808180117-6v0mkxr", ".siyuan", "sort.json"),
		filepath.Join("20210808180117-6v0mkxr", ".siyuan"),
		filepath.Join("20210808180117-6v0mkxr", ".siyuan", "history", "2021-01-01-120000-x.sy"),
		filepath.Join("20210808180117-6v0mkxr", ".siyuan", "publishAccess.json"),
	}
	for _, p := range forbidden {
		if got := IsForbiddenDataRelPath(p); !got {
			t.Errorf("IsForbiddenDataRelPath(%q) = false, want true", p)
		}
	}

	// 快照内合法文件不应被误判，尤其笔记本内名为 templates 的文档目录。
	allowed := []string{
		"",
		"/",
		"assets/image.png",
		filepath.Join("20210808180117-6v0mkxr", "templates", "a.sy"),
		filepath.Join("20210808180117-6v0mkxr", "20240101.sy"),
		filepath.Join("20210808180117-6v0mkxr", "conf.json"),
		"plugins/example/main.js",
		".siyuan/publishAccess.json.bak",
	}
	for _, p := range allowed {
		if got := IsForbiddenDataRelPath(p); got {
			t.Errorf("IsForbiddenDataRelPath(%q) = true, want false", p)
		}
	}
}

// TestIsForbiddenDataRelPathCaseInsensitive 在大小写不敏感的文件系统上验证大小写变体无法绕过片段匹配。
func TestIsForbiddenDataRelPathCaseInsensitive(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "darwin" {
		t.Skip("case-insensitive comparison only on windows/darwin")
	}

	cases := []string{
		filepath.Join(".SIYUAN", "PUBLISHACCESS.JSON"),
		strings.ToUpper(filepath.Join("templates", "A.MD")),
		filepath.Join("SNIPPETS", "CONF.JSON"),
		filepath.Join("20210808180117-6v0mkxr", ".SIYUAN", "CONF.JSON"),
	}
	for _, p := range cases {
		if got := IsForbiddenDataRelPath(p); !got {
			t.Errorf("IsForbiddenDataRelPath(%q) = false, want true (case variant)", p)
		}
	}
}
