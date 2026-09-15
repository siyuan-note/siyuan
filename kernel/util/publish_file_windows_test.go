//go:build windows

package util

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestPublishFileJunctionBoundary(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "public"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	junction := filepath.Join(root, "public", "linked")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", junction, outside).CombinedOutput(); err != nil {
		t.Skipf("junction creation unavailable: %v %s", err, out)
	}
	if file, err := OpenPublishFile(root, "public/linked/secret.txt"); err == nil {
		file.Close()
		t.Fatal("junction target was exposed")
	}
}
