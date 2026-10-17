package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIsPathInTemplatesDirJunctionWorkspace(t *testing.T) {
	for _, atWorkspace := range []bool{false, true} {
		t.Run(map[bool]string{false: "ancestor", true: "workspace"}[atWorkspace], func(t *testing.T) {
			alias, _ := testutil.JunctionWorkspace(t, t.TempDir(), atWorkspace)
			previous := util.DataDir
			util.DataDir = filepath.Join(alias, "data")
			t.Cleanup(func() { util.DataDir = previous })
			root := filepath.Join(util.DataDir, "templates")
			if err := os.MkdirAll(root, 0755); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(root, "test.md")
			if err := os.WriteFile(file, []byte("template"), 0644); err != nil {
				t.Fatal(err)
			}
			if !isPathInTemplatesDir(file) {
				t.Error("valid template below a junction was rejected")
			}
			outside := t.TempDir()
			if err := os.WriteFile(filepath.Join(outside, "test.md"), []byte("outside"), 0644); err != nil {
				t.Fatal(err)
			}
			testutil.Junction(t, filepath.Join(root, "escape"), outside)
			if isPathInTemplatesDir(filepath.Join(root, "escape", "test.md")) {
				t.Error("template escaped its real root")
			}
		})
	}
}
