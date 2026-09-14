package tools

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTemplatePathGetSymlink(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	base := filepath.Join(util.DataDir, "templates")
	if err := os.MkdirAll(base, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "test.md"), []byte("template"), 0644); err != nil {
		t.Fatal(err)
	}
	result, err := templateGet(map[string]any{"path": "test.md"})
	if err != nil || result.IsError || len(result.Content) != 1 || result.Content[0].Text != "template" {
		t.Fatalf("read template: %+v, %v", result, err)
	}
	outside := t.TempDir()
	target := filepath.Join(outside, "secret.md")
	if err := os.WriteFile(target, []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(base, "linked")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	for _, handler := range []func(map[string]any) (CallToolResult, error){templateGet, templateRemove} {
		result, err = handler(map[string]any{"path": "linked/secret.md"})
		if err != nil || !result.IsError {
			t.Fatalf("escaped operation: %+v, %v", result, err)
		}
	}
	if data, err := os.ReadFile(target); err != nil || string(data) != "secret" {
		t.Fatalf("outside data changed: %q, %v", data, err)
	}
}
