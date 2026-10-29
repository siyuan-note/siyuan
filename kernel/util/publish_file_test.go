// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestPublishFileBoundary(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "public", "nested"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "public", "nested", "ok.txt"), []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "private.txt"), []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	file, err := OpenPublishFile(root, "public/nested/ok.txt")
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(file)
	file.Close()
	if err != nil || string(data) != "ok" {
		t.Fatal("regular read failed")
	}
	for _, name := range []string{"../private.txt", "public/../private.txt", "/private.txt", "public//nested/ok.txt", "public/nested/ok.txt:stream", "public/%2e%2e/private.txt", "public\\nested\\ok.txt", "public/nested/ok.txt.", "public/nested/ok.txt ", "public/nested"} {
		if file, err := OpenPublishFile(root, name); err == nil {
			file.Close()
			t.Fatalf("accepted %q", name)
		}
	}
	t.Run("symlinks", func(t *testing.T) {
		if err := os.Symlink(filepath.Join(root, "private.txt"), filepath.Join(root, "public", "link")); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
		if file, err := OpenPublishFile(root, "public/link"); err == nil {
			file.Close()
			t.Fatal("file link accepted")
		}
		if err := os.Symlink(filepath.Join(root, "public", "nested"), filepath.Join(root, "public", "dirlink")); err != nil {
			t.Fatal(err)
		}
		if file, err := OpenPublishFile(root, "public/dirlink/ok.txt"); err == nil {
			file.Close()
			t.Fatal("directory link accepted")
		}
	})
}

// TestOpenPublishReaderFileSensitiveNames 验证读者可见的包资源在打开前按文件名策略拒绝敏感文件。
func TestOpenPublishReaderFileSensitiveNames(t *testing.T) {
	root := t.TempDir()
	previousWorkspace := WorkspaceDir
	WorkspaceDir = root
	t.Cleanup(func() { WorkspaceDir = previousWorkspace })

	dir := filepath.Join(root, "widgets", "example")
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"index.html":          "ok",
		"my-credentials.json": "ok",
		"credentials.json":    "secret",
		"id_rsa":              "secret",
		"sub/id_token":        "secret",
	} {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(name)), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	for _, name := range []string{"widgets/example/credentials.json", "widgets/example/id_rsa", "widgets/example/sub/id_token"} {
		if file, err := OpenPublishReaderFile(root, name); !errors.Is(err, fs.ErrPermission) {
			if file != nil {
				file.Close()
			}
			t.Fatalf("sensitive file %q: err = %v, want permission denied", name, err)
		}
	}
	for _, name := range []string{"widgets/example/index.html", "widgets/example/my-credentials.json"} {
		file, err := OpenPublishReaderFile(root, name)
		if err != nil {
			t.Fatalf("ordinary file %q rejected: %v", name, err)
		}
		file.Close()
	}
}
