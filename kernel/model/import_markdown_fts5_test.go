//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMarkdownImportTargetAndHPath(t *testing.T) {
	const boxID = "20260910000000-box0001"
	const parentID = "20260910000001-doc0001"
	setupExportRelatedTest(t, boxID)
	Conf.Editor = conf.NewEditor()
	setupNotebookDocumentImportDatabase(t)
	parentPath := "/" + parentID + ".sy"
	writeExportRelatedTestTree(t, treenode.NewTree(boxID, parentPath, "/Parent", "Parent"))
	source := filepath.Join(t.TempDir(), "Imported")
	if err := os.MkdirAll(source, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "test.md"), []byte("# test"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"", "/", "/" + boxID, "/" + boxID + ".sy", parentPath, strings.TrimSuffix(parentPath, ".sy"), "/" + boxID + parentPath} {
		if err := ValidateImportFromLocalPath(boxID, source, target); err != nil {
			t.Fatalf("valid target %q: %v", target, err)
		}
	}
	for _, target := range []string{"missing", "/missing.sy"} {
		if err := ValidateImportFromLocalPath(boxID, source, target); err == nil {
			t.Fatalf("validation accepted %q", target)
		}
		if err := ImportFromLocalPath(boxID, source, target); err == nil {
			t.Fatalf("import accepted %q", target)
		}
	}
	if err := ValidateImportFromLocalPath(boxID, source+"-missing", parentPath); err == nil {
		t.Fatal("validation accepted missing source")
	}
	if err := ValidateImportFromLocalPath("missing", source, "/"); err == nil {
		t.Fatal("validation accepted missing notebook")
	}
	entries, err := os.ReadDir(filepath.Join(util.DataDir, boxID))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() && entry.Name() != ".siyuan" {
			t.Fatalf("validation or rejected import created %s", entry.Name())
		}
	}
	for _, target := range []string{parentPath, strings.TrimSuffix(parentPath, ".sy"), "/"} {
		if err := ImportFromLocalPath(boxID, source, target); err != nil {
			t.Fatal(err)
		}
		prefix := "/Parent/Imported"
		if target == "/" {
			prefix = "/Imported"
		}
		for _, hpath := range []string{prefix, prefix + "/test"} {
			if block := treenode.GetBlockTreeRootByHPath(boxID, hpath); block == nil || block.ID == "" {
				t.Fatalf("missing imported hpath %q", hpath)
			}
		}
	}
	root := treenode.GetBlockTreeRootByHPath(boxID, "/Parent/Imported")
	if err := ImportFromLocalPath(boxID, source, root.Path); err != nil {
		t.Fatal(err)
	}
	if block := treenode.GetBlockTreeRootByHPath(boxID, "/Parent/Imported/Imported/test"); block == nil || block.ID == "" {
		t.Fatal("nested import lost parent hpath")
	}
	if err := ImportFromLocalPath(boxID, filepath.Join(source, "test.md"), parentPath); err != nil {
		t.Fatal(err)
	}
	if block := treenode.GetBlockTreeRootByHPath(boxID, "/Parent/test"); block == nil || block.ID == "" {
		t.Fatal("single file import lost parent hpath")
	}
	if err := ImportFromLocalPathSkipRoot(boxID, source, root.Path); err != nil {
		t.Fatal(err)
	}
	children, err := os.ReadDir(filepath.Join(util.DataDir, boxID, strings.TrimSuffix(strings.TrimPrefix(root.Path, "/"), ".sy")))
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, child := range children {
		if strings.HasSuffix(child.Name(), ".sy") {
			block := treenode.GetBlockTreeRootByPath(boxID, strings.TrimSuffix(root.Path, ".sy")+"/"+child.Name())
			if block != nil && block.HPath == "/Parent/Imported/test" {
				count++
			}
		}
	}
	if count != 2 {
		t.Fatalf("skip-root import: got %d direct test documents, want 2", count)
	}
}
