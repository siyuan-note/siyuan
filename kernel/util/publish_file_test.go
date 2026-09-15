package util

import (
	"io"
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
