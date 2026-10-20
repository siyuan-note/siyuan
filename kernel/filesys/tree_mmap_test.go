package filesys

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTreeAttributeMmapSnapshot(t *testing.T) {
	box, root, _, _ := setupStalePathTest(t)
	tree := treenode.NewTree(box, "/"+root+".sy", "/Task", "Task")
	tree.Root.SetIALAttr("custom-deadline", "2026-10-16")
	if _, err := WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(util.DataDir, box, tree.Path)
	old := time.Now().Add(-10 * time.Second).Truncate(time.Second)
	if err := os.Chtimes(file, old, old); err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	repo, err := dejavu.NewRepo(util.DataDir, filepath.Join(base, "repo"), filepath.Join(base, "history"),
		filepath.Join(base, "temp"), "device", "device", "windows", []byte("0123456789abcdef0123456789abcdef"), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.Index("before attribute edit", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("custom-deadline", "2026-10-15")
	if _, err = WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	updated, err := os.ReadFile(file)
	if err != nil || len(original) != len(updated) || bytes.Equal(original, updated) {
		t.Fatalf("attribute edit must change content without changing length: %v", err)
	}
	after, err := repo.Index("after attribute edit", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if before.ID == after.ID {
		t.Fatal("attribute edit was omitted from the next snapshot")
	}
	if err = os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if _, _, err = repo.Checkout(after.ID, nil); err != nil {
		t.Fatal(err)
	}
	restored, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(restored, updated) {
		t.Fatalf("snapshot did not restore the updated attribute: %v", err)
	}
}
