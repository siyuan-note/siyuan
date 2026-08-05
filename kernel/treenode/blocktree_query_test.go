// SiYuan - Refactor your thinking
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

package treenode

import (
	"database/sql"
	"path/filepath"
	"slices"
	"testing"

	"github.com/mattn/go-sqlite3"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func init() {
	sql.Register("sqlite3_extended", &sqlite3.SQLiteDriver{})
}

func TestGetRootBlockIDsByBoxID(t *testing.T) {
	const (
		boxID      = "20260730000000-box0001"
		otherBoxID = "20260730000001-box0002"
		docID      = "20260730000002-doc0001"
		otherDocID = "20260730000003-doc0002"
	)

	previousBlockTreeDBPath := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(t.TempDir(), "blocktree.db")
	InitBlockTree(true)
	t.Cleanup(func() {
		CloseDatabase()
		util.BlockTreeDBPath = previousBlockTreeDBPath
		if "" != previousBlockTreeDBPath {
			InitBlockTree(false)
		}
	})

	UpsertBlockTree(NewTree(boxID, "/"+docID+".sy", "/Document", "Document"))
	UpsertBlockTree(NewTree(otherBoxID, "/"+otherDocID+".sy", "/Other", "Other"))

	if rootIDs := GetRootBlockIDsByBoxID(boxID); !slices.Equal(rootIDs, []string{docID}) {
		t.Fatalf("unexpected document root IDs: %v", rootIDs)
	}
}

func TestCleanupInvalidBlockTrees(t *testing.T) {
	testDB, err := sql.Open("sqlite3_extended", ":memory:")
	if nil != err {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()
	if _, err = testDB.Exec("CREATE TABLE blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type)"); nil != err {
		t.Fatalf("create blocktrees table failed: %s", err)
	}
	if _, err = testDB.Exec("INSERT INTO blocktrees (id, root_id) VALUES ('', 'root'), ('block', ''), ('valid', 'root')"); nil != err {
		t.Fatalf("insert blocktrees failed: %s", err)
	}

	if err = cleanupInvalidBlockTrees(testDB); nil != err {
		t.Fatalf("cleanup invalid blocktrees failed: %s", err)
	}
	var count int
	if err = testDB.QueryRow("SELECT COUNT(*) FROM blocktrees").Scan(&count); nil != err || 1 != count {
		t.Fatalf("cleanup should retain only valid blocktrees: count=%d, err=%v", count, err)
	}
}
