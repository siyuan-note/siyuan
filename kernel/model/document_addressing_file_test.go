package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentAddressingSortRecoveryPreservesPendingWrite(t *testing.T) {
	initial := []byte(`{"` + appendSortOldID + `":7}`)
	confPath := prepareSortConfAppendTest(t, initial)
	previousConfDir := util.ConfDir
	util.ConfDir = filepath.Join(filepath.Dir(util.DataDir), "conf")
	t.Cleanup(func() { util.ConfDir = previousConfDir })
	record, err := newSortConfAppendRecord(initial, map[string]int{appendSortNewID: 8})
	if err != nil {
		t.Fatal(err)
	}
	recordPath := saveSortConfAppendTestRecord(t, confPath, record)
	journal, _ := os.ReadFile(recordPath)
	partial := append(bytes.Clone(initial[:record.Offset]), record.Suffix[:len(record.Suffix)/2]...)
	if err = os.WriteFile(confPath, partial, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(filepath.Dir(confPath), "conf.json"), []byte(`{"documentAddressingVersion":2}`), 0600); err != nil {
		t.Fatal(err)
	}
	for _, operation := range []func() error{
		func() error { return recoverSortConfAppend(confPath) },
		func() error { _, err := readSortConfMap(confPath); return err },
		func() error { return writeSortConfMap(confPath, map[string]int{appendSortOldID: 99}) },
		func() error { return appendSortConfMap(confPath, initial, map[string]int{appendSortNewID: 9}) },
		func() error { _, err := recoverSortConfMap(confPath, partial); return err },
	} {
		if err = operation(); !errors.Is(err, documentaddressing.ErrUnsupported) {
			t.Fatalf("sort operation entered unsupported notebook: %v", err)
		}
	}
	if err = recoverSortConfAppends(); err != nil {
		t.Fatalf("unavailable notebook prevented startup: %v", err)
	}
	for name, expected := range map[string][]byte{confPath: partial, recordPath: journal} {
		data, readErr := os.ReadFile(name)
		if readErr != nil || !bytes.Equal(data, expected) {
			t.Fatalf("sort recovery changed %s: %s, %v", name, data, readErr)
		}
	}
}

func TestDocumentAddressingRawPathAliases(t *testing.T) {
	documentAddressingRawPathAliases(t, func(link, target string) {
		if err := os.Symlink(target, link); err != nil {
			t.Skipf("symbolic links unavailable: %v", err)
		}
	})
}

func documentAddressingRawPathAliases(t *testing.T, linkDirectory func(string, string)) {
	t.Helper()
	previousData, previousConf := util.DataDir, util.ConfDir
	root := t.TempDir()
	util.DataDir, util.ConfDir = filepath.Join(root, "data"), filepath.Join(root, "conf")
	t.Cleanup(func() { util.DataDir, util.ConfDir = previousData, previousConf })
	boxID := "20261022120000-alias01"
	box := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(filepath.Join(box, ".siyuan"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(box, ".siyuan", "conf.json"), []byte(`{"documentAddressingVersion":2}`), 0600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(root, "alias")
	linkDirectory(alias, box)
	if err := CheckDocumentAddressingFileWrite(filepath.Join(alias, "new", "child.sy"), []byte("raw"), false); !errors.Is(err, documentaddressing.ErrUnsupported) {
		t.Fatalf("linked destination bypassed protection: %v", err)
	}
	outside := t.TempDir()
	linkDirectory(filepath.Join(box, "outside"), outside)
	if err := CheckDocumentAddressingPath(filepath.Join(box, "outside", "new.sy")); !errors.Is(err, documentaddressing.ErrUnsupported) {
		t.Fatalf("logical notebook path bypassed protection: %v", err)
	}
	confAlias := filepath.Join(root, "conf-alias")
	linkDirectory(confAlias, util.ConfDir)
	if err := CheckDocumentAddressingFileWrite(filepath.Join(confAlias, "document-addressing.json"), []byte(`{}`), false); !errors.Is(err, documentaddressing.ErrInvalid) {
		t.Fatalf("local capability alias bypassed protection: %v", err)
	}
	dataAlias := filepath.Join(root, "data-alias")
	linkDirectory(dataAlias, util.DataDir)
	util.DataDir = dataAlias
	if err := CheckDocumentAddressingFileWrite(filepath.Join(box, "new.sy"), []byte("raw"), false); !errors.Is(err, documentaddressing.ErrUnsupported) {
		t.Fatalf("physical path of linked data directory bypassed protection: %v", err)
	}
}
