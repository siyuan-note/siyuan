// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCleanupRetiredRecordsIsLocalAndIdempotent(t *testing.T) {
	root := t.TempDir()
	conf := filepath.Join(root, "conf")
	if err := CleanupRetiredRecords(conf); err != nil {
		t.Fatal(err)
	}
	notebook := filepath.Join(root, "data", "notebook", FloorPath)
	for _, name := range []string{filepath.Join(conf, "document-addressing.json"), filepath.Join(conf, "document-addressing-recovery", "notebook.json"), notebook} {
		if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte("original"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := CleanupRetiredRecords(conf); err != nil {
			t.Fatal(err)
		}
		entries, err := os.ReadDir(conf)
		if err != nil || len(entries) != 0 {
			t.Fatal("local records survived cleanup", entries, err)
		}
		data, err := os.ReadFile(notebook)
		if err != nil || string(data) != "original" {
			t.Fatal("cleanup changed notebook data", err)
		}
	}
}

func TestCleanupRetiredRecordsReportsErrors(t *testing.T) {
	file := filepath.Join(t.TempDir(), "conf")
	if err := os.WriteFile(file, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := CleanupRetiredRecords(file); err == nil {
		t.Fatal("invalid configuration directory accepted")
	}
	if data, err := os.ReadFile(file); err != nil || string(data) != "original" {
		t.Fatal("failed cleanup changed data", err)
	}
}
