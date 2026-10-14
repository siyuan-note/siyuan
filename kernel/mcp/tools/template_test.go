package tools

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTemplateActionsAcceptDotPrefixedNames(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	base := filepath.Join(util.DataDir, "templates")
	if err := os.MkdirAll(base, 0755); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"..foo.md", filepath.Join(base, "..foo.md")} {
		if err := os.WriteFile(filepath.Join(base, "..foo.md"), []byte("template"), 0644); err != nil {
			t.Fatal(err)
		}
		result, err := templateGet(map[string]any{"path": path})
		if err != nil || result.IsError || result.Content[0].Text != "template" {
			t.Fatalf("get %q: %+v, %v", path, result, err)
		}
		// 无效块 ID 用于确认渲染已通过路径校验并进入模型层。
		result, err = templateRender(map[string]any{"path": path, "id": "invalid-block"})
		if err != nil || !result.IsError || result.Content[0].Text != "render template failed: "+model.ErrTreeNotFound.Error() {
			t.Fatalf("render path %q: %+v, %v", path, result, err)
		}
		result, err = templateRemove(map[string]any{"path": path})
		if err != nil || result.IsError {
			t.Fatalf("remove %q: %+v, %v", path, result, err)
		}
		if _, err := os.Stat(filepath.Join(base, "..foo.md")); !os.IsNotExist(err) {
			t.Fatalf("template still exists: %v", err)
		}
	}
	for _, handler := range []func(map[string]any) (CallToolResult, error){templateGet, templateRender, templateRemove} {
		for _, path := range []string{"", ".", "../outside.md", "nested/../../outside.md"} {
			result, err := handler(map[string]any{"path": path, "id": "invalid-block"})
			if err != nil || !result.IsError {
				t.Fatalf("accepted escaped path %q: %+v, %v", path, result, err)
			}
		}
	}
}

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
