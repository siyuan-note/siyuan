package util

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteFileByMmapSizeTransitions(t *testing.T) {
	file := filepath.Join(t.TempDir(), "data.sy")
	large := bytes.Repeat([]byte("a"), os.Getpagesize()*3+17)
	changed := bytes.Clone(large)
	changed[os.Getpagesize()+1] = 'b'
	for _, data := range [][]byte{nil, []byte("first"), large, large, changed, []byte("short"), nil} {
		if err := WriteFileByMmap(file, data); err != nil {
			t.Fatal(err)
		}
		actual, err := os.ReadFile(file)
		if err != nil || !bytes.Equal(actual, data) {
			t.Fatalf("file content mismatch for size %d: %v", len(data), err)
		}
	}
}

func TestMmapChangedPageBudget(t *testing.T) {
	pageSize := os.Getpagesize()
	before := bytes.Repeat([]byte("a"), pageSize*1024+17)
	data := bytes.Clone(before)
	data[pageSize*500] = 'b'
	data[len(data)-1] = 'c'
	if pages := copyChangedMmapPages(before, data, pageSize); pages != 2 {
		t.Fatalf("two changed pages caused %d page writes", pages)
	}
	if !bytes.Equal(before, data) {
		t.Fatal("changed pages were not copied")
	}
	if pages := copyChangedMmapPages(before, data, pageSize); pages != 0 {
		t.Fatalf("identical data caused %d page writes", pages)
	}
}
