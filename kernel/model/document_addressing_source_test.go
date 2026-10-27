// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	if err := copyDocumentAddressingFile(source, destination); !errors.Is(err, treenode.ErrDocumentTitleSpec) {
		t.Fatal("copy used a source changed after batch preflight", err)
	}
	if actual, _ := os.ReadFile(destination); !bytes.Equal(actual, ordinary) {
		t.Fatal("changed incoming source replaced the destination")
	}
	missing := filepath.Join(box, "20261022130000-parent1", "20261022130000-child01.sy")
	if err := CheckDocumentAddressingFileWrite(missing, conflict, false); !errors.Is(err, treenode.ErrDocumentTitleSpec) {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(missing)); !os.IsNotExist(err) {
		t.Fatal("source validation created a destination directory", err)
	}
}

func TestDocumentAddressingRawTitleWriteSpec(t *testing.T) {
	box := documentAddressingSourceWorkspace(t)
	writeDocumentAddressingSource(t, filepath.Join(box, documentaddressing.ConfigPath), []byte(`{"documentAddressingVersion":2}`))
	destination := filepath.Join(box, "20261022130000-target1.sy")
	underVersioned := []byte(`{"Spec":"2","Properties":{"title":"A/B"}}`)
	valid := []byte("\xef\xbb\xbf" + "{\n  \"Spec\": \"6\", \"Properties\": {\"title\": \"A/B\"}\n}\n")
	writeDocumentAddressingSource(t, destination, underVersioned)
	if err := checkDocumentAddressingSource(destination, underVersioned); err != nil {
		t.Fatal("existing source can no longer be read or recovered", err)
	}
	before, _ := os.Stat(destination)
	if err := WriteFileWithDocumentAddressing(destination, underVersioned); !errors.Is(err, treenode.ErrDocumentTitleSpec) {
		t.Fatal("under-versioned raw write was accepted", err)
	}
	after, _ := os.Stat(destination)
	if data, _ := os.ReadFile(destination); !bytes.Equal(data, underVersioned) || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("rejected write changed existing source bytes or timestamp")
	}
	missing := filepath.Join(box, "20261022130000-parent1", "20261022130000-child01.sy")
	if err := CheckDocumentAddressingFileWrite(missing, underVersioned, false); !errors.Is(err, treenode.ErrDocumentTitleSpec) {
		t.Fatal("new document did not require title spec", err)
	}
	if _, err := os.Stat(filepath.Dir(missing)); !os.IsNotExist(err) {
		t.Fatal("preflight created a directory", err)
	}
	if err := WriteFileWithDocumentAddressing(destination, valid); err != nil {
		t.Fatal("a valid raw replacement could not repair an existing low-spec source", err)
	}
	if data, _ := os.ReadFile(destination); !bytes.Equal(data, valid) {
		t.Fatal("valid raw write changed request bytes")
	}
	source := filepath.Join(t.TempDir(), "incoming")
	writeDocumentAddressingSource(t, filepath.Join(source, "000-first.txt"), []byte("attachment"))
	writeDocumentAddressingSource(t, filepath.Join(source, "20261022130000-other01.sy"), underVersioned)
	if err := CopyFileWithDocumentAddressing(source, box); !errors.Is(err, treenode.ErrDocumentTitleSpec) {
		t.Fatal("directory copy accepted an under-versioned descendant", err)
	}
	if _, err := os.Stat(filepath.Join(box, "000-first.txt")); !os.IsNotExist(err) {
		t.Fatal("directory copy wrote an earlier attachment before rejecting", err)
	}
	writeDocumentAddressingSource(t, filepath.Join(source, "20261022130000-other01.sy"), valid)
	if err := CopyFileWithDocumentAddressing(source, box); err != nil {
		t.Fatal("valid versioned copy was rejected", err)
	}
	if data, _ := os.ReadFile(filepath.Join(box, "20261022130000-other01.sy")); !bytes.Equal(data, valid) {
		t.Fatal("valid copy changed source bytes")
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
