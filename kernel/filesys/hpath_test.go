package filesys

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestReadDocHPathDoesNotRepairSource(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	box := "20260915000000-hpath01"
	parent := "20260915000001-hpath01"
	child := "20260915000002-hpath01"
	dir := filepath.Join(util.DataDir, box, parent)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	writeDoc := func(id, p, title string) {
		t.Helper()
		data, err := json.Marshal(map[string]any{"ID": id, "Type": "NodeDocument", "Properties": map[string]string{"id": id, "title": title}})
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(p, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	childPath := "/" + parent + "/" + child + ".sy"
	writeDoc(child, filepath.Join(dir, child+".sy"), "Child")
	parentFile := filepath.Join(util.DataDir, box, parent+".sy")
	if _, _, err := ReadDocHPath(box, childPath); !os.IsNotExist(err) {
		t.Fatalf("expected missing parent error, got %v", err)
	}
	if _, err := os.Stat(parentFile); !os.IsNotExist(err) {
		t.Fatal("read-only recovery created a parent file")
	}
	writeDoc(parent, parentFile, "Parent")
	if hpath, props, err := ReadDocHPath(box, childPath); err != nil || hpath != "/Parent/Child" || props["id"] != child {
		t.Fatalf("unexpected path metadata: %q, %#v, %v", hpath, props, err)
	}
	writeDoc(child, parentFile, "Wrong identity")
	before, _ := os.ReadFile(parentFile)
	if _, _, err := ReadDocHPath(box, childPath); err == nil {
		t.Fatal("mismatched source identity was accepted")
	}
	after, _ := os.ReadFile(parentFile)
	if string(before) != string(after) {
		t.Fatal("failed recovery modified the source")
	}
}
