package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTemplatePathOperations(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	base := filepath.Join(util.DataDir, "templates")
	if err := os.MkdirAll(filepath.Join(base, "nested"), 0755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(base, "nested", "test.md")
	if err := os.WriteFile(target, []byte("template"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"nested/test.md", target} {
		data, err := ReadTemplateFile(p)
		if err != nil || string(data) != "template" {
			t.Fatalf("read %q: %q, %v", p, data, err)
		}
	}
	for _, p := range []string{"", ".", base, "..", "../outside"} {
		if err := RemoveTemplate(p); err == nil {
			t.Fatalf("accepted removal %q", p)
		}
		if _, err := ReadTemplateFile(p); err == nil {
			t.Fatalf("accepted read %q", p)
		}
	}
	if err := RemoveTemplate(filepath.Join(base, "nested")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("nested template still exists: %v", err)
	}
	if err := RemoveTemplate("missing"); err != nil {
		t.Fatalf("missing removal: %v", err)
	}
}

func TestTemplatePathSymlinks(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	base := filepath.Join(util.DataDir, "templates")
	outside := t.TempDir()
	for _, dir := range []string{base, filepath.Join(outside, "sub")} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	target := filepath.Join(outside, "sub", "secret.md")
	if err := os.WriteFile(target, []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "linked")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	for _, p := range []string{"linked/sub/secret.md", "linked/sub", filepath.Join(link, "sub")} {
		if err := RemoveTemplate(p); err == nil {
			t.Fatalf("accepted escaped removal %q", p)
		}
		if _, err := ReadTemplateFile(p); err == nil {
			t.Fatalf("accepted escaped read %q", p)
		}
		data, err := os.ReadFile(target)
		if err != nil || string(data) != "secret" {
			t.Fatalf("outside data changed: %q, %v", data, err)
		}
	}
	if err := RemoveTemplate("linked"); err != nil {
		t.Fatalf("remove leaf symlink: %v", err)
	}
	if _, err := os.Lstat(link); !os.IsNotExist(err) {
		t.Fatalf("leaf symlink still exists: %v", err)
	}
	if data, err := os.ReadFile(target); err != nil || string(data) != "secret" {
		t.Fatalf("leaf removal changed outside data: %q, %v", data, err)
	}
}
