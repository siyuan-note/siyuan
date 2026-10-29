// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLocalStorageIncrementalReadFailure(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	path := filepath.Join(util.DataDir, "storage", "local.json")
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	// A directory yields a non-permission read error on Windows and Unix.
	for _, update := range []func() error{
		func() error {
			set, err := SetLocalStorageVals(map[string]any{"new": "value"})
			if len(set) != 0 {
				t.Fatalf("failed reads must not report applied values: %v", set)
			}
			return err
		},
		func() error { return RemoveLocalStorageVals([]string{"old"}) },
	} {
		var pathErr *os.PathError
		if err := update(); !errors.As(err, &pathErr) || (pathErr.Op != "read" && pathErr.Op != "open") {
			t.Fatalf("must return the original read error: %v", err)
		}
	}
}

func TestLocalStorageIncrementalPreservesState(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	if _, err := SetLocalStorageVals(map[string]any{"old": "keep", "remove": "value"}); err != nil {
		t.Fatal(err)
	}
	if _, err := SetLocalStorageVals(map[string]any{"new": "added"}); err != nil {
		t.Fatal(err)
	}
	if err := RemoveLocalStorageVals([]string{"remove"}); err != nil {
		t.Fatal(err)
	}
	if got := GetLocalStorage(); !reflect.DeepEqual(got, map[string]any{"old": "keep", "new": "added"}) {
		t.Fatalf("incremental update lost unrelated state: %v", got)
	}
	path := filepath.Join(util.DataDir, "storage", "local.json")
	corrupt := []byte(`{"old":"keep",`)
	if err := os.WriteFile(path, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	// Startup reads remain tolerant, but runtime edits cannot replace unread state.
	_ = GetLocalStorage()
	if _, err := SetLocalStorageVals(map[string]any{"new": "value"}); err == nil {
		t.Fatal("corrupt state must not be replaced by a partial update")
	}
	if err := RemoveLocalStorageVals([]string{"old"}); err == nil {
		t.Fatal("corrupt state must not be replaced by a partial removal")
	}
	if data, err := os.ReadFile(path); err != nil || !bytes.Equal(data, corrupt) {
		t.Fatalf("failed update changed unread state: %s, %v", data, err)
	}
}

func TestClearRecentDocs(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.FileTree.Store(conf.NormalizeFileTree(conf.NewFileTree()))
	docPath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	before, err := os.ReadFile(docPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, update := range []func(string) error{UpdateRecentDocOpenTime, UpdateRecentDocViewTime, UpdateRecentDocCloseTime} {
		if err = update(fixture.sourceID); err != nil {
			t.Fatal(err)
		}
	}
	records, err := loadRecentDocsRaw()
	if err != nil || len(records) != 1 || records[0].ViewedAt == 0 || records[0].OpenAt == 0 || records[0].ClosedAt == 0 {
		t.Fatalf("missing initial activity records: %+v, %v", records, err)
	}
	for range 2 {
		if err = ClearRecentDocs(); err != nil {
			t.Fatal(err)
		}
		data, readErr := os.ReadFile(filepath.Join(util.DataDir, "storage", "recent-doc.json"))
		if readErr != nil || string(data) != "[]" {
			t.Fatalf("clear did not persist an empty array: %s, %v", data, readErr)
		}
		for _, sortBy := range []string{"viewedAt", "openAt", "closedAt"} {
			if docs, getErr := GetRecentDocs(sortBy); getErr != nil || docs == nil || len(docs) != 0 {
				t.Fatalf("cleared %s records remain: %+v, %v", sortBy, docs, getErr)
			}
		}
	}
	after, err := os.ReadFile(docPath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("clear changed document content or timestamps: %v", err)
	}
	for _, activity := range []struct {
		name                   string
		update                 func(string) error
		viewed, opened, closed bool
	}{
		{"view", UpdateRecentDocViewTime, true, false, false},
		{"open", UpdateRecentDocOpenTime, true, true, false},
		{"close existing tab", UpdateRecentDocCloseTime, false, false, true},
	} {
		t.Run(activity.name, func(t *testing.T) {
			if err := ClearRecentDocs(); err != nil {
				t.Fatal(err)
			}
			if err := activity.update(fixture.sourceID); err != nil {
				t.Fatal(err)
			}
			records, err := loadRecentDocsRaw()
			if err != nil || len(records) != 1 || records[0].RootID != fixture.sourceID ||
				(records[0].ViewedAt > 0) != activity.viewed || (records[0].OpenAt > 0) != activity.opened ||
				(records[0].ClosedAt > 0) != activity.closed {
				t.Fatalf("new activity should not restore old times: %+v, %v", records, err)
			}
		})
	}
}

func TestClearRecentDocsMissingStorageAndWriteFailure(t *testing.T) {
	previousDir, previousConf := util.DataDir, Conf
	util.DataDir, Conf = t.TempDir(), NewAppConf()
	Conf.FileTree.Store(conf.NormalizeFileTree(conf.NewFileTree()))
	t.Cleanup(func() { util.DataDir, Conf = previousDir, previousConf })
	if err := ClearRecentDocs(); err != nil {
		t.Fatalf("missing storage should be initialized: %v", err)
	}
	util.DataDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(util.DataDir, "storage"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ClearRecentDocs(); err == nil {
		t.Fatal("write failure must not be reported as success")
	}
}

func TestBuildRecentDocsByTimeStmt(t *testing.T) {
	tests := []struct {
		name          string
		sortBy        string
		hiddenRootIDs []string
		limit         int
		wantStmt      string
		wantArgs      []any
	}{
		{
			name:     "created",
			sortBy:   "created",
			limit:    32,
			wantStmt: "SELECT * FROM blocks WHERE type = 'd' ORDER BY created DESC, id DESC LIMIT 32",
		},
		{
			name:          "updated with hidden documents",
			sortBy:        "updated",
			hiddenRootIDs: []string{"20260822120000-abcdefg", "20260822120001-hijklmn"},
			limit:         64,
			wantStmt:      "SELECT * FROM blocks WHERE type = 'd' AND root_id NOT IN (?, ?) ORDER BY updated DESC, id DESC LIMIT 64",
			wantArgs:      []any{"20260822120000-abcdefg", "20260822120001-hijklmn"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stmt, args := buildRecentDocsByTimeStmt(test.sortBy, test.hiddenRootIDs, test.limit)
			if test.wantStmt != stmt {
				t.Fatalf("unexpected statement: got %q, want %q", stmt, test.wantStmt)
			}
			if !reflect.DeepEqual(test.wantArgs, args) {
				t.Fatalf("unexpected arguments: got %#v, want %#v", args, test.wantArgs)
			}
		})
	}
}
