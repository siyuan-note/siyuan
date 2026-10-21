// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
