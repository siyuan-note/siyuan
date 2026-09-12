// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package filesys

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/88250/lute/render"
	"github.com/mattn/go-sqlite3"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupStalePathTest(t *testing.T) (string, string, string, []byte) {
	t.Helper()
	original := util.DataDir
	util.DataDir = t.TempDir()
	cache.ClearTreeCache()
	t.Cleanup(func() {
		cache.ClearTreeCache()
		util.DataDir = original
	})
	box := "20260912000000-box0001"
	parent := "20260912000001-parent1"
	id := "20260912000002-child01"
	p := "/" + parent + "/" + id + ".sy"
	tree := treenode.NewTree(box, p, "/Parent/Child", "Child")
	data := render.NewJSONRenderer(tree, util.NewLute().RenderOptions, util.NewLute().ParseOptions).Render()
	return box, parent, p, data
}

func writeStalePathFixture(t *testing.T, box, p string, data []byte) string {
	t.Helper()
	abs := filepath.Join(util.DataDir, box, p)
	if err := os.MkdirAll(filepath.Dir(abs), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, data, 0600); err != nil {
		t.Fatal(err)
	}
	return abs
}

func TestLoadTreeRejectsStaleCachedPath(t *testing.T) {
	for _, cached := range []bool{false, true} {
		t.Run(map[bool]string{false: "disk", true: "cache"}[cached], func(t *testing.T) {
			box, parent, p, data := setupStalePathTest(t)
			oldPath := writeStalePathFixture(t, box, p, data)
			newPath := "/" + filepath.Base(p)
			newAbs := filepath.Join(util.DataDir, box, newPath)
			if err := os.Rename(oldPath, newAbs); err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(filepath.Dir(oldPath)); err != nil {
				t.Fatal(err)
			}
			if cached {
				id := util.GetTreeID(p)
				cache.SetTreeDataInBox(id, box, data)
				deadline := time.Now().Add(time.Second)
				for {
					if _, ok := cache.GetTreeDataInBox(id, box); ok {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("cache entry was not published")
					}
					time.Sleep(time.Millisecond)
				}
			}
			if _, err := LoadTree(box, p, util.NewLute()); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("expected missing old path, got %v", err)
			}
			if _, err := LoadTreeByData(data, box, p, util.NewLute()); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("expected stale data to reject parent repair, got %v", err)
			}
			if _, err := os.Stat(filepath.Join(util.DataDir, box, parent+".sy")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("old parent was restored: %v", err)
			}
			if _, err := LoadTree(box, newPath, util.NewLute()); err != nil {
				t.Fatalf("new path without blocktree must load: %v", err)
			}
			got, err := os.ReadFile(newAbs)
			if err != nil || !bytes.Equal(got, data) {
				t.Fatalf("new document changed: %v", err)
			}
		})
	}
}

func TestLoadTreePreservesInvalidParent(t *testing.T) {
	for _, invalid := range []string{"{", "{}", `{"Properties":{}}`, `{"Properties":{"title":"Parent"},"Children":[`} {
		t.Run(invalid, func(t *testing.T) {
			box, parent, p, data := setupStalePathTest(t)
			writeStalePathFixture(t, box, p, data)
			parentAbs := writeStalePathFixture(t, box, parent+".sy", []byte(invalid))
			if _, err := LoadTree(box, p, util.NewLute()); err == nil {
				t.Fatal("expected invalid parent error")
			}
			got, err := os.ReadFile(parentAbs)
			if err != nil || string(got) != invalid {
				t.Fatalf("invalid parent was overwritten: %v", err)
			}
		})
	}
}

func TestLoadTreeRepairsMissingParent(t *testing.T) {
	box, parent, p, data := setupStalePathTest(t)
	if !slices.Contains(sql.Drivers(), "sqlite3_extended") {
		sql.Register("sqlite3_extended", &sqlite3.SQLiteDriver{})
	}
	originalDB := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(t.TempDir(), "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = originalDB
	})
	writeStalePathFixture(t, box, p, data)
	if _, err := LoadTree(box, p, util.NewLute()); err != nil {
		t.Fatal(err)
	}
	ial, err := readParentDocIAL(filepath.Join(util.DataDir, box, parent+".sy"))
	if err != nil || ial["title"] != "Untitled" {
		t.Fatalf("missing parent was not repaired: %v, %v", ial, err)
	}
}

func TestLoadTreePreservesUnauthenticatedParent(t *testing.T) {
	box, parent, p, data := setupStalePathTest(t)
	originalProvider := DEKProvider
	DEKProvider = func(string) ([]byte, error) { return bytes.Repeat([]byte{1}, 32), nil }
	t.Cleanup(func() { DEKProvider = originalProvider })
	encrypted, err := encryptDataWithDEK(box, p, data, bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	writeStalePathFixture(t, box, p, encrypted)
	parentPath := parent + ".sy"
	parentData, err := encryptDataWithDEK(box, parentPath, []byte(`{"Properties":{"title":"Parent"}}`), bytes.Repeat([]byte{2}, 32))
	if err != nil {
		t.Fatal(err)
	}
	parentAbs := writeStalePathFixture(t, box, parentPath, parentData)
	if _, err = LoadTree(box, p, util.NewLute()); err == nil {
		t.Fatal("expected parent authentication failure")
	}
	got, err := os.ReadFile(parentAbs)
	if err != nil || !bytes.Equal(got, parentData) {
		t.Fatalf("unauthenticated parent was overwritten: %v", err)
	}
}
