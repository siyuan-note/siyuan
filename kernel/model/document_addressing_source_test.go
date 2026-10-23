package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func documentAddressingSourceWorkspace(t *testing.T) string {
	t.Helper()
	data, conf := util.DataDir, util.ConfDir
	util.DataDir, util.ConfDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.DataDir, util.ConfDir = data, conf })
	box := filepath.Join(util.DataDir, "20261022130000-source1")
	if err := os.MkdirAll(box, 0755); err != nil {
		t.Fatal(err)
	}
	return box
}

func writeDocumentAddressingSource(t *testing.T, name string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, data, 0644); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentAddressingRawSourceChanges(t *testing.T) {
	box := documentAddressingSourceWorkspace(t)
	destination := filepath.Join(box, "20261022130000-target1.sy")
	source := filepath.Join(t.TempDir(), "incoming.sy")
	ordinary := []byte(`{"Spec":"2","Properties":{"title":"Ordinary"}}`)
	future := []byte(`{"Spec":"999","Properties":{"title":"Future"}}`)
	conflict := []byte(`{"Spec":"2","Properties":{"title":"A/B"}}`)
	for _, mode := range []string{"write", "copy"} {
		t.Run(mode, func(t *testing.T) {
			writeDocumentAddressingSource(t, destination, ordinary)
			writeDocumentAddressingSource(t, source, ordinary)
			if err := CheckDocumentAddressingFileCopies([]string{source}, []string{destination}); err != nil {
				t.Fatal(err)
			}
			writeDocumentAddressingSource(t, destination, future)
			before, _ := os.Stat(destination)
			var err error
			if mode == "write" {
				err = WriteFileWithDocumentAddressing(destination, ordinary)
			} else {
				err = copyDocumentAddressingFile(source, destination)
			}
			if !errors.Is(err, treenode.ErrSpecTooNew) {
				t.Fatal("a changed destination bypassed source protection", err)
			}
			after, _ := os.Stat(destination)
			actual, _ := os.ReadFile(destination)
			if !bytes.Equal(actual, future) || !after.ModTime().Equal(before.ModTime()) {
				t.Fatal("a rejected write changed the destination")
			}
		})
	}
	writeDocumentAddressingSource(t, destination, ordinary)
	if err := CheckDocumentAddressingFileCopies([]string{source}, []string{destination}); err != nil {
		t.Fatal(err)
	}
	writeDocumentAddressingSource(t, source, conflict)
	if err := copyDocumentAddressingFile(source, destination); !errors.Is(err, documentaddressing.ErrModeConflict) {
		t.Fatal("copy used a source changed after batch preflight", err)
	}
	if actual, _ := os.ReadFile(destination); !bytes.Equal(actual, ordinary) {
		t.Fatal("changed incoming source replaced the destination")
	}
	missing := filepath.Join(box, "20261022130000-parent1", "20261022130000-child01.sy")
	if err := CheckDocumentAddressingFileWrite(missing, conflict, false); !errors.Is(err, documentaddressing.ErrModeConflict) {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(missing)); !os.IsNotExist(err) {
		t.Fatal("source validation created a destination directory", err)
	}
}

func TestDocumentAddressingRawSourceDirectoryCopy(t *testing.T) {
	box := documentAddressingSourceWorkspace(t)
	source := t.TempDir()
	document := filepath.Join("20261022130000-parent1", "20261022130000-child01.sy")
	plain := []byte("\xef\xbb\xbf" + `{"Spec":"2","Properties":{"title":"A&amp;#47;B"}}`)
	files := map[string][]byte{
		document:        plain,
		"000-first.txt": []byte("original attachment"),
		filepath.Join("assets", "20261022130000-child01.sy"): []byte("arbitrary asset content"),
	}
	stamp := time.Unix(1750000000, 0)
	for name, data := range files {
		abs := filepath.Join(source, name)
		writeDocumentAddressingSource(t, abs, data)
		if err := os.Chtimes(abs, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(source, "empty"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(source, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	if err := CopyFileWithDocumentAddressing(source, box); err != nil {
		t.Fatal(err)
	}
	for name, expected := range files {
		data, err := os.ReadFile(filepath.Join(box, name))
		if err != nil || !bytes.Equal(data, expected) {
			t.Fatal("copy did not preserve source bytes", name, err)
		}
		original, _ := os.Stat(filepath.Join(source, name))
		copied, _ := os.Stat(filepath.Join(box, name))
		if original.Mode().Perm() != copied.Mode().Perm() || !original.ModTime().Equal(copied.ModTime()) {
			t.Fatal("copy changed source permissions or modification time", name)
		}
	}
	if info, err := os.Stat(filepath.Join(box, "empty")); err != nil || !info.IsDir() {
		t.Fatal("copy omitted an empty directory", err)
	}
	if info, _ := os.Stat(box); !info.ModTime().Equal(stamp) {
		t.Fatal("directory copy did not preserve modification time")
	}
	writeDocumentAddressingSource(t, filepath.Join(source, "000-first.txt"), []byte("new attachment"))
	writeDocumentAddressingSource(t, filepath.Join(source, document), []byte(`{"Spec":"999"}`))
	if err := CopyFileWithDocumentAddressing(source, box); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatal("directory copy accepted an incompatible descendant", err)
	}
	if data, _ := os.ReadFile(filepath.Join(box, "000-first.txt")); string(data) != "original attachment" {
		t.Fatal("directory copy partially wrote before checking descendants")
	}
	if data, _ := os.ReadFile(filepath.Join(box, document)); !bytes.Equal(data, plain) {
		t.Fatal("directory copy changed the existing document")
	}
}

func TestDocumentAddressingRawSourceAliases(t *testing.T) {
	documentAddressingRawSourceAliases(t, func(link, target string) {
		if err := os.Symlink(target, link); err != nil {
			t.Skipf("symbolic links unavailable: %v", err)
		}
	})
}

func TestDocumentAddressingRawSourceFileLink(t *testing.T) {
	box := documentAddressingSourceWorkspace(t)
	directory := t.TempDir()
	source := filepath.Join(directory, "source.sy")
	link := filepath.Join(directory, "link.sy")
	writeDocumentAddressingSource(t, source, []byte(`{"Spec":"999"}`))
	if err := os.Symlink(source, link); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	destination := filepath.Join(box, "20261022130000-target1.sy")
	original := []byte(`{"Spec":"2","Properties":{"title":"Original"}}`)
	writeDocumentAddressingSource(t, destination, original)
	if err := CheckDocumentAddressingFileCopies([]string{link}, []string{destination}); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatal("file link bypassed the preflight shared by copy and rename", err)
	}
	writeDocumentAddressingSource(t, source, []byte(`{"Spec":"2","Properties":{"title":"Incoming"}}`))
	if err := CopyFileWithDocumentAddressing(link, destination); err != nil {
		t.Fatal("compatible file link changed copy behavior", err)
	}
	if data, _ := os.ReadFile(destination); !bytes.Equal(data, original) {
		t.Fatal("ignored file link changed the existing document")
	}
}

func documentAddressingRawSourceAliases(t *testing.T, linkDirectory func(string, string)) {
	t.Helper()
	box := documentAddressingSourceWorkspace(t)
	alias := filepath.Join(t.TempDir(), "alias")
	linkDirectory(alias, box)
	name := "20261022130000-target1.sy"
	ordinary := []byte(`{"Spec":"2","Properties":{"title":"Ordinary"}}`)
	future := []byte(`{"Spec":"999","Properties":{"title":"Future"}}`)
	writeDocumentAddressingSource(t, filepath.Join(box, name), ordinary)
	if err := WriteFileWithDocumentAddressing(filepath.Join(alias, name), future); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatal("linked destination bypassed incoming document validation", err)
	}
	writeDocumentAddressingSource(t, filepath.Join(box, name), future)
	if err := WriteFileWithDocumentAddressing(filepath.Join(alias, name), ordinary); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatal("linked destination bypassed existing document validation", err)
	}
	dataAlias := filepath.Join(t.TempDir(), "data-alias")
	linkDirectory(dataAlias, util.DataDir)
	util.DataDir = dataAlias
	if err := WriteFileWithDocumentAddressing(filepath.Join(box, name), ordinary); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatal("linked workspace bypassed existing document validation", err)
	}
	if actual, _ := os.ReadFile(filepath.Join(box, name)); !bytes.Equal(actual, future) {
		t.Fatal("alias write replaced an incompatible source")
	}
}
