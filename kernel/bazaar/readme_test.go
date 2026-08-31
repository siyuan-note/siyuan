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

package bazaar

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestResolvePackageREADMEImage(t *testing.T) {
	installPath := t.TempDir()
	if err := os.MkdirAll(filepath.Join(installPath, "docs"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installPath, "docs", "local image.png"), []byte("image"), 0644); err != nil {
		t.Fatal(err)
	}
	localRoot := "/plugins/A%20B%23C%25D%28E%29+F/"
	remoteRoot := "https://cdn.jsdelivr.net/gh/owner/repo@v1.0.0/"
	tests := []struct {
		name string
		src  string
		want string
	}{
		{
			name: "local image keeps query and fragment",
			src:  "local%20image.png?width=10#view",
			want: localRoot + "docs/local%20image.png?width=10&v=42#view",
		},
		{
			name: "missing image uses pinned source",
			src:  "../assets/missing.png?raw=1#preview",
			want: remoteRoot + "assets/missing.png?raw=1#preview",
		},
		{name: "network image unchanged", src: "https://example.com/image.png", want: "https://example.com/image.png"},
		{name: "data image unchanged", src: "data:image/png;base64,AAAA", want: "data:image/png;base64,AAAA"},
		{name: "root image unchanged", src: "/assets/image.png", want: "/assets/image.png"},
		{name: "path traversal rejected", src: "../../outside.png", want: "/"},
		{name: "encoded path traversal rejected", src: "%2e%2e/%2e%2e/outside.png", want: "/"},
		{name: "backslash traversal rejected", src: `..\..\outside.png`, want: "/"},
		{name: "leading backslash rejected", src: `\..\outside.png`, want: "/"},
		{name: "network path backslash rejected", src: `\\host\outside.png`, want: "/"},
		{name: "encoded Windows volume rejected", src: `C%3A/outside.png`, want: "/"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := resolvePackageREADMEImage(test.src, installPath, localRoot, remoteRoot, "docs/README.md", 42)
			if got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}

	got := resolvePackageREADMEImage("missing.png", installPath, localRoot, "", "docs/README.md", 42)
	if got != localRoot+"docs/missing.png?v=42" {
		t.Fatalf("missing image without a remote source should retain its local URL, got %q", got)
	}
}

func TestInstalledPackageREADMERewritesMarkdownAndHTMLImages(t *testing.T) {
	installPath := t.TempDir()
	readmeDir := "docs #%(+)"
	if err := os.MkdirAll(filepath.Join(installPath, readmeDir), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installPath, readmeDir, "local #%(+).png"), []byte("image"), 0644); err != nil {
		t.Fatal(err)
	}
	markdown := "![local](local%20%23%25%28+%29.png)\n\n![remote](missing%20%23%25%28+%29.webp?raw=1#view)" +
		"\n\n<img src=\"missing-html.avif\">"
	readmePath := readmeDir + "/README (v1)+#.md"
	if err := os.WriteFile(filepath.Join(installPath, filepath.FromSlash(readmePath)), []byte(markdown), 0644); err != nil {
		t.Fatal(err)
	}
	html := getInstalledPackageREADME(installPath, "/plugins/sample/", "https://github.com/owner/repo", "v1.2.3", 99,
		LocaleStrings{"default": readmePath})
	for _, expected := range []string{
		`/plugins/sample/docs%20%23%25%28+%29/local%20%23%25%28+%29.png?v=99`,
		`https://cdn.jsdelivr.net/gh/owner/repo@v1.2.3/docs%20%23%25%28+%29/missing%20%23%25%28+%29.webp?raw=1#view`,
		`https://cdn.jsdelivr.net/gh/owner/repo@v1.2.3/docs%20%23%25%28+%29/missing-html.avif`,
	} {
		if !strings.Contains(html, expected) {
			t.Fatalf("rendered README is missing %q:\n%s", expected, html)
		}
	}
}

func TestPackageRemoteRootURL(t *testing.T) {
	if got := packageRemoteRootURL("https://github.com/owner/repo", "release/v1", false); got !=
		"https://cdn.jsdelivr.net/gh/owner/repo@release%2Fv1/" {
		t.Fatalf("unexpected versioned source: %q", got)
	}
	if got := packageRemoteRootURL("https://github.com/owner/repo", "", true); got !=
		"https://cdn.jsdelivr.net/gh/owner/repo/" {
		t.Fatalf("unexpected legacy source: %q", got)
	}
	if got := packageRemoteRootURL("https://example.com/owner/repo", "v1", true); got != "" {
		t.Fatalf("untrusted source accepted: %q", got)
	}
}

func TestReadmeCandidatesRejectTraversal(t *testing.T) {
	candidates := getReadmeFileCandidates(LocaleStrings{"default": "docs/README.md", "en": "../../outside.md"})
	if len(candidates) != 2 || candidates[0] != "docs/README.md" || candidates[1] != "README.md" {
		t.Fatalf("unexpected README candidates: %#v", candidates)
	}
}

func TestRenderPackageREADMEDoesNotMutateInput(t *testing.T) {
	source := []byte(`<div style="display: flex;">
  <!-- 按钮：感谢您的支持 -->
  <a href="https://example.com">❤️ 感谢您的支持</a>
</div>

</br>

## 更新日志

> 如果未检测到旧数据，请重新导入。
`)
	backing := bytes.Repeat([]byte{0xA5}, len(source)+1024)
	markdown := backing[:len(source)]
	copy(markdown, source)
	original := bytes.Clone(backing)

	renderPackageREADME("https://example.com/package", markdown)

	if !bytes.Equal(original, backing) {
		t.Fatal("rendering package README mutated the input backing array")
	}
}

func TestRenderPackageREADMEConcurrently(t *testing.T) {
	source := []byte(`<div style="display: flex;">
  <!-- 按钮：感谢您的支持 -->
  <a href="https://example.com">❤️ 感谢您的支持</a>
</div>

</br>

## 更新日志

> 如果未检测到旧数据，请重新导入。
`)
	backing := make([]byte, len(source), len(source)+1024)
	copy(backing, source)
	markdown := backing[:len(source)]
	expected := renderPackageREADME("https://example.com/package", bytes.Clone(markdown))
	const workers = 32
	var waitGroup sync.WaitGroup
	waitGroup.Add(workers)
	errors := make(chan string, workers)
	for range workers {
		go func() {
			defer waitGroup.Done()
			for range 20 {
				if actual := renderPackageREADME("https://example.com/package", markdown); actual != expected {
					errors <- actual
					return
				}
			}
		}()
	}
	waitGroup.Wait()
	close(errors)
	if actual, ok := <-errors; ok {
		t.Fatalf("concurrent README rendering returned corrupted HTML:\n%s", actual)
	}
}
