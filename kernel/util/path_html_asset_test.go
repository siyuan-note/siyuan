package util

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestIsSensitivePathHTMLAssets(t *testing.T) {
	previousHome, previousWorkspace := HomeDir, WorkspaceDir
	HomeDir, WorkspaceDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { HomeDir, WorkspaceDir = previousHome, previousWorkspace })
	for _, item := range []struct {
		path string
		want bool
	}{
		{filepath.Join(t.TempDir(), "lu123.tmp", "image.png"), false},
		{filepath.Join(HomeDir, "Documents", "image.png"), false},
		{filepath.Join(HomeDir, ".ssh", "key.png"), true},
		{filepath.Join(HomeDir, ".config", "token"), true},
		{filepath.Join(HomeDir, ".netrc"), true},
		{filepath.Join(os.TempDir(), "credentials.json"), true},
		{filepath.Join(os.TempDir(), "id_rsa"), true},
		{filepath.Join(WorkspaceDir, "conf", "conf.json"), true},
		{filepath.Join(WorkspaceDir, "temp", "decrypted.png"), true},
		{filepath.Join(WorkspaceDir, "temp", "export", "image.png"), false},
	} {
		if got := IsSensitiveHTMLAssetPath(item.path); got != item.want {
			t.Errorf("IsSensitiveHTMLAssetPath(%q) = %v, want %v", item.path, got, item.want)
		}
	}
}

func TestIsSensitivePathHTMLAssetsUnixRoots(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix system directory prefixes")
	}
	previousHome, previousWorkspace := HomeDir, WorkspaceDir
	HomeDir, WorkspaceDir = "/var/home/siyuan-html-paste", "/var/home/siyuan-html-paste/workspace"
	t.Cleanup(func() { HomeDir, WorkspaceDir = previousHome, previousWorkspace })
	t.Setenv("TMPDIR", "/var/folders/siyuan-html-paste/T")
	for _, p := range []string{HomeDir + "/Documents/image.png", os.TempDir() + "/lu123.tmp/image.png"} {
		if IsSensitiveHTMLAssetPath(p) || !IsSensitivePath(p) {
			t.Errorf("clipboard exception must not change generic path protection: %s", p)
		}
	}
	for _, p := range []string{"/var/home/siyuan-html-paste-other/image.png", "/var/lib/private.png", "/etc/passwd", "/proc/self/environ"} {
		if !IsSensitiveHTMLAssetPath(p) {
			t.Errorf("system path was allowed: %s", p)
		}
	}
}

func TestIsSensitivePathHTMLAssetsSymlinks(t *testing.T) {
	previousHome, previousWorkspace := HomeDir, WorkspaceDir
	HomeDir, WorkspaceDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { HomeDir, WorkspaceDir = previousHome, previousWorkspace })
	for _, relative := range []string{"Documents", ".ssh"} {
		target := filepath.Join(HomeDir, relative)
		if err := os.MkdirAll(target, 0700); err != nil {
			t.Fatal(err)
		}
		link := filepath.Join(t.TempDir(), "image-dir")
		if err := os.Symlink(target, link); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		if got := IsSensitiveHTMLAssetPath(filepath.Join(link, "image.png")); got != (relative == ".ssh") {
			t.Errorf("incorrect protection for symlink to %s", relative)
		}
	}
}
