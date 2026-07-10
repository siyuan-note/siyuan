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
	"sort"
	"strings"
	"testing"
)

// touchSkillMd 在 root 下创建一个含 SKILL.md 的 skill 目录。
func touchSkillMd(t *testing.T, parts ...string) {
	t.Helper()
	p := filepath.Join(parts...)
	if err := os.MkdirAll(p, 0755); err != nil {
		t.Fatalf("mkdir %s: %v", p, err)
	}
	skillMd := filepath.Join(p, "SKILL.md")
	if err := os.WriteFile(skillMd, []byte("---\nname: x\n---\nbody"), 0644); err != nil {
		t.Fatalf("write %s: %v", skillMd, err)
	}
}

// sorted 把 findSkillDirs 的返回结果排序后比较，避免遍历顺序影响断言。
func sorted(ss []string) []string {
	out := append([]string(nil), ss...)
	sort.Strings(out)
	return out
}

// toSlashSet 把路径分隔符统一为 /，便于跨平台断言。
func toSlashSet(ss []string) []string {
	out := make([]string, len(ss))
	for i, s := range ss {
		out[i] = filepath.ToSlash(s)
	}
	sort.Strings(out)
	return out
}

// TestFindSkillDirsRootSkill 验证 SKILL.md 直接在解压根时识别为单个 skill（相对路径 "."）。
func TestFindSkillDirsRootSkill(t *testing.T) {
	root := t.TempDir()
	touchSkillMd(t, root)
	got := findSkillDirs(root)
	want := []string{"."}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("findSkillDirs(root skill) = %v, want %v", got, want)
	}
}

// TestFindSkillDirsWrappedSingle 验证 codeload 包裹的单 skill（<repo-name>/SKILL.md）。
// 这是 owner/repo 简写最常见的场景，修复前会因"只在根找 skills/ 容器"而漏掉。
func TestFindSkillDirsWrappedSingle(t *testing.T) {
	root := t.TempDir()
	touchSkillMd(t, root, "WeChatReading")
	got := toSlashSet(findSkillDirs(root))
	want := []string{"WeChatReading"}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("findSkillDirs(wrapped single) = %v, want %v", got, want)
	}
}

// TestFindSkillDirsWrappedCollection 验证 codeload 包裹的集合仓库（<repo>/skills/<name>/SKILL.md）。
// 修复前会完全找不到（根只有 repo 目录，其下才有 skills/）。
func TestFindSkillDirsWrappedCollection(t *testing.T) {
	root := t.TempDir()
	touchSkillMd(t, root, "myrepo", "skills", "foo")
	touchSkillMd(t, root, "myrepo", "skills", "bar")
	got := toSlashSet(findSkillDirs(root))
	want := []string{"myrepo/skills/bar", "myrepo/skills/foo"}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("findSkillDirs(wrapped collection) = %v, want %v", got, want)
	}
}

// TestFindSkillDirsCollectionNoWrap 验证无包裹的集合仓库（skills/<name>/SKILL.md）。
func TestFindSkillDirsCollectionNoWrap(t *testing.T) {
	root := t.TempDir()
	touchSkillMd(t, root, "skills", "baz")
	got := toSlashSet(findSkillDirs(root))
	want := []string{"skills/baz"}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("findSkillDirs(collection no wrap) = %v, want %v", got, want)
	}
}

// TestFindSkillDirsDoesNotDescendIntoSkillInternals 验证识别到 skill 后停止下钻，
// 不会把 skill 内部的 references/、scripts/ 子目录误判为 skill。
func TestFindSkillDirsDoesNotDescendIntoSkillInternals(t *testing.T) {
	root := t.TempDir()
	// skill5 自身有 SKILL.md，同时含 references/a.md、scripts/b.py
	skillDir := filepath.Join(root, "skill5", "SKILL.md")
	if err := os.MkdirAll(filepath.Join(root, "skill5", "references"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "skill5", "scripts"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skillDir, []byte("---\nname: x\n---"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "skill5", "references", "a.md"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "skill5", "scripts", "b.py"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	got := toSlashSet(findSkillDirs(root))
	want := []string{"skill5"}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("should not descend into skill internals: got %v, want %v", got, want)
	}
}

// TestFindSkillDirsNoneFound 验证没有 SKILL.md 时返回空切片。
func TestFindSkillDirsNoneFound(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "some", "dir"), 0755); err != nil {
		t.Fatal(err)
	}
	if got := findSkillDirs(root); len(got) != 0 {
		t.Fatalf("findSkillDirs(no skill) = %v, want empty", got)
	}
}

// TestFindSkillDirsSkipsVCSDirs 验证跳过 .git/.github 等元数据目录，不做无意义下钻。
func TestFindSkillDirsSkipsVCSDirs(t *testing.T) {
	root := t.TempDir()
	touchSkillMd(t, root, "real-skill")
	// 构造 .github 目录（无 SKILL.md），确认不会因下钻它而出错或误判
	if err := os.MkdirAll(filepath.Join(root, ".github", "workflows"), 0755); err != nil {
		t.Fatal(err)
	}
	got := toSlashSet(findSkillDirs(root))
	want := []string{"real-skill"}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("findSkillDirs(skip vcs) = %v, want %v", got, want)
	}
}

// urlCase 是 normalizeSkillURL 的表驱动用例。
type urlCase struct {
	name       string
	in         string
	wantURL    string // 期望的 downloadURL；空表示不校验精确值，改校验 isZip/branch
	wantIsZip  bool
	wantBranch string
}

// TestNormalizeSkillURL 验证各种输入形态归一化为正确的下载源。
func TestNormalizeSkillURL(t *testing.T) {
	cases := []urlCase{
		// owner/repo 简写 → codeload main，失败回退 master
		{name: "shorthand", in: "Tencent/WeChatReading", wantURL: "https://codeload.github.com/Tencent/WeChatReading/zip/refs/heads/main", wantIsZip: true, wantBranch: "main"},
		// 整条 npx skills add 命令 → 提取出 owner/repo
		{name: "npx command", in: "npx skills add Tencent/WeChatReading -g", wantURL: "https://codeload.github.com/Tencent/WeChatReading/zip/refs/heads/main", wantIsZip: true, wantBranch: "main"},
		// 带 @ 版本的 skills 包名
		{name: "npx scoped", in: "npx skills@latest add foo/bar", wantURL: "https://codeload.github.com/foo/bar/zip/refs/heads/main", wantIsZip: true, wantBranch: "main"},
		// 完整 GitHub 仓库 URL → codeload main
		{name: "full repo", in: "https://github.com/Tencent/WeChatReading", wantURL: "https://codeload.github.com/Tencent/WeChatReading/zip/refs/heads/main", wantIsZip: true, wantBranch: "main"},
		// tree/<branch> → codeload 指定分支
		{name: "tree branch", in: "https://github.com/foo/bar/tree/dev", wantURL: "https://codeload.github.com/foo/bar/zip/refs/heads/dev", wantIsZip: true, wantBranch: "dev"},
		// tree/<branch>/<path> → 仍按整个仓库的该分支拉 zip
		{name: "tree branch path", in: "https://github.com/foo/bar/tree/dev/skills/x", wantURL: "https://codeload.github.com/foo/bar/zip/refs/heads/dev", wantIsZip: true, wantBranch: "dev"},
		// commit/<sha> → codeload zip/<sha>
		{name: "commit sha", in: "https://github.com/foo/bar/commit/abc123", wantURL: "https://codeload.github.com/foo/bar/zip/abc123", wantIsZip: true},
		// blob/<branch>/<path> → raw 直链（单文件）
		{name: "blob file", in: "https://github.com/foo/bar/blob/main/SKILL.md", wantURL: "https://raw.githubusercontent.com/foo/bar/main/SKILL.md", wantIsZip: false},
		// raw 直链 → 原样
		{name: "raw direct", in: "https://raw.githubusercontent.com/foo/bar/main/skills/x/SKILL.md", wantURL: "https://raw.githubusercontent.com/foo/bar/main/skills/x/SKILL.md", wantIsZip: false},
		// releases/download/<tag>/<asset>.zip → 原样，预判 zip
		{name: "release zip", in: "https://github.com/foo/bar/releases/download/v1.0/skill.zip", wantURL: "https://github.com/foo/bar/releases/download/v1.0/skill.zip", wantIsZip: true},
		// releases/download 但 asset 非 zip → 原样，不预判 zip（交由 Content-Type 判定）
		{name: "release non-zip", in: "https://github.com/foo/bar/releases/download/v1.0/skill.tar.gz", wantURL: "https://github.com/foo/bar/releases/download/v1.0/skill.tar.gz", wantIsZip: false},
		// 第三方直链 → 原样
		{name: "third-party", in: "https://example.com/skill.zip", wantURL: "https://example.com/skill.zip"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := normalizeSkillURL(c.in)
			if err != nil {
				t.Fatalf("normalizeSkillURL(%q) error: %v", c.in, err)
			}
			if c.wantURL != "" && got.downloadURL != c.wantURL {
				t.Errorf("downloadURL = %q, want %q", got.downloadURL, c.wantURL)
			}
			if got.isZip != c.wantIsZip {
				t.Errorf("isZip = %v, want %v", got.isZip, c.wantIsZip)
			}
			if c.wantBranch != "" && got.branch != c.wantBranch {
				t.Errorf("branch = %q, want %q", got.branch, c.wantBranch)
			}
		})
	}
}

// TestNormalizeSkillURLOwnerRepoBoundary 验证 owner/repo 简写判定不会误伤普通文本。
// 含点（域名）、含冒号、带 scheme 的都不应走简写分支。
func TestNormalizeSkillURLOwnerRepoBoundary(t *testing.T) {
	bad := []string{
		"example.com",     // 不是 owner/repo
		"a/b/c",           // 多于一个斜杠
		"https://foo/bar", // 含 scheme（应走 URL 分支，但属于合法 URL 不报错）
		"/abs/path",       // 绝对路径
	}
	for _, in := range bad {
		// 这些输入要么报错，要么走 URL 分支；只要不 panic、不误判为 codeload 即可
		got, err := normalizeSkillURL(in)
		if err != nil {
			continue // 报错是可接受的
		}
		// 不应被误判为 codeload.github.com（只有 owner/repo 简写和 github.com URL 才会）
		if in == "example.com" && strings.HasPrefix(got.downloadURL, "https://codeload.github.com/") {
			t.Errorf("input %q should not map to codeload, got %s", in, got.downloadURL)
		}
	}
}

// TestNormalizeSkillURLOwnerRepoValid 确认合法 owner/repo 走 codeload 分支。
func TestNormalizeSkillURLOwnerRepoValid(t *testing.T) {
	good := []string{"a/b", "Tencent/WeChatReading", "user-1/my.repo.v2"}
	for _, in := range good {
		got, err := normalizeSkillURL(in)
		if err != nil {
			t.Errorf("normalizeSkillURL(%q) unexpected error: %v", in, err)
			continue
		}
		if !got.isZip || got.branch != "main" {
			t.Errorf("normalizeSkillURL(%q) = %+v, want codeload main zip", in, got)
		}
	}
}

// TestParseSkillFrontmatter 验证 frontmatter 解析提取 name/description，正文正确剥离。
func TestParseSkillFrontmatter(t *testing.T) {
	cases := []struct {
		name     string
		text     string
		wantName string
		wantDesc string
		wantBody string
	}{
		{
			name:     "standard",
			text:     "---\nname: my-skill\ndescription: does X\n---\nbody line",
			wantName: "my-skill",
			wantDesc: "does X",
			wantBody: "body line",
		},
		{
			name:     "no frontmatter",
			text:     "just body",
			wantName: "",
			wantDesc: "",
			wantBody: "just body",
		},
		{
			name:     "extra fields ignored",
			text:     "---\nname: a\nversion: \"1.0\"\nauthor: me\ndescription: d\n---\nb",
			wantName: "a",
			wantDesc: "d",
			wantBody: "b",
		},
		{
			name:     "crlf line endings",
			text:     "---\r\nname: cr\r\ndescription: crlf\r\n---\r\nbody",
			wantName: "cr",
			wantDesc: "crlf",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			fm, body := parseSkillFrontmatter(c.text)
			if fm["name"] != c.wantName {
				t.Errorf("name = %q, want %q", fm["name"], c.wantName)
			}
			if fm["description"] != c.wantDesc {
				t.Errorf("description = %q, want %q", fm["description"], c.wantDesc)
			}
			if c.wantBody != "" && body != c.wantBody {
				t.Errorf("body = %q, want %q", body, c.wantBody)
			}
		})
	}
}

// TestFirstLine 验证描述兜底提取首行并截断。
func TestFirstLine(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"single", "single"},
		{"first\nsecond", "first"},
		{"first\r\nsecond", "first"},
		{"   trimmed   ", "trimmed"},
	}
	for _, c := range cases {
		if got := firstLine(c.in); got != c.want {
			t.Errorf("firstLine(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestFirstLineTruncation 验证超长首行被截断为 200 字符 + "..."。
func TestFirstLineTruncation(t *testing.T) {
	long := make([]rune, 300)
	for i := range long {
		long[i] = 'x'
	}
	got := firstLine(string(long))
	if len([]rune(got)) != 203 { // 200 + "..."
		t.Errorf("firstLine(long) len = %d, want 203", len([]rune(got)))
	}
}
