//go:build linux

package server

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestAppearanceRestrictedAncestor(t *testing.T) {
	const probeEnv = "SIYUAN_TEST_APPEARANCE_ANCESTOR"
	if ancestor := os.Getenv(probeEnv); ancestor != "" {
		resource := filepath.Join(ancestor, "0", "probe.txt")
		if _, err := os.ReadFile(resource); err != nil {
			t.Fatalf("direct read: %s", err)
		}
		if _, err := filepath.EvalSymlinks(resource); !os.IsNotExist(err) {
			t.Fatalf("expected restricted ancestor to fail with ENOENT, got %v", err)
		}
		// 在相同的父目录限制下验证正常读取、语言补全、包目录软链接及越界拒绝。
		TestAppearanceFileBoundaries(t)
		return
	}
	if runtime.GOARCH != "amd64" {
		t.Skip("fault injection uses the amd64 newfstatat syscall")
	}
	strace, err := exec.LookPath("strace")
	if err != nil {
		t.Skip("strace is required for filesystem fault injection")
	}
	ancestor := filepath.Join(t.TempDir(), "storage", "emulated")
	tempDir := filepath.Join(ancestor, "0", "tmp")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ancestor, "0", "probe.txt"), []byte("resource"), 0644); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	// 只拒绝父目录本身的属性查询，子目录和文件仍可直接访问。
	cmd := exec.Command(strace, "-f", "-qq", "-e", "trace=newfstatat", "-P", ancestor,
		"-e", "inject=newfstatat:error=ENOENT", executable, "-test.run=^TestAppearanceRestrictedAncestor$", "-test.v")
	cmd.Env = append(os.Environ(), probeEnv+"="+ancestor, "TMPDIR="+tempDir)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("appearance requests with a restricted ancestor: %s\n%s", err, output)
	}
}
