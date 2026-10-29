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

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSortRecoveryIgnoresRetiredAddressingMarker(t *testing.T) {
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
	partial := append(bytes.Clone(initial[:record.Offset]), record.Suffix[:len(record.Suffix)/2]...)
	if err = os.WriteFile(confPath, partial, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(filepath.Dir(confPath), "conf.json"), []byte(`{"documentAddressingVersion":3}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := recoverSortConfAppend(confPath); err != nil {
		t.Fatal("retired marker blocked sort recovery", err)
	}
	if _, err := os.Stat(recordPath); !os.IsNotExist(err) {
		t.Fatal("completed recovery retained journal", err)
	}
	if got, err := readSortConfMap(confPath); err != nil || got[appendSortOldID] != 7 || got[appendSortNewID] != 8 {
		t.Fatal(got, err)
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
	if err := os.WriteFile(filepath.Join(box, ".siyuan", "conf.json"), []byte(`{"documentAddressingVersion":3}`), 0600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(root, "alias")
	linkDirectory(alias, box)
	if err := CheckDocumentAddressingFileWrite(filepath.Join(alias, "20261026000001-parent1", "20261026000002-child01.sy"), []byte(`{"Spec":"999"}`), false); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatalf("linked destination bypassed protection: %v", err)
	}
	outside := t.TempDir()
	linkDirectory(filepath.Join(box, "outside"), outside)
	if err := CheckDocumentAddressingFileWrite(filepath.Join(box, "20261026000001-parent2", "20261026000002-child01.sy"), []byte(`{"Spec":"999"}`), false); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatalf("logical notebook path bypassed protection: %v", err)
	}
	dataAlias := filepath.Join(root, "data-alias")
	linkDirectory(dataAlias, util.DataDir)
	util.DataDir = dataAlias
	if err := CheckDocumentAddressingFileWrite(filepath.Join(box, "20261026000002-child01.sy"), []byte(`{"Spec":"999"}`), false); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatalf("physical path of linked data directory bypassed protection: %v", err)
	}
}
