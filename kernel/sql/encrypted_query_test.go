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

package sql

import (
	gosql "database/sql"
	"fmt"
	"testing"
)

func TestGetBlocksInBoxPreservesInputOrder(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	insertEncryptedQueryTestBlock(t, testDB, "block-1", "", "block-1", "d")
	insertEncryptedQueryTestBlock(t, testDB, "block-2", "", "block-2", "d")
	insertEncryptedQueryTestBlock(t, testDB, "block-3", "", "block-3", "d")

	blocks := GetBlocksInBox([]string{"block-3", "block-1", "block-2"}, boxID)
	if 3 != len(blocks) {
		t.Fatalf("unexpected block count: %d", len(blocks))
	}
	for i, expected := range []string{"block-3", "block-1", "block-2"} {
		if nil == blocks[i] || expected != blocks[i].ID {
			t.Fatalf("unexpected block at %d: %#v", i, blocks[i])
		}
	}
}

func TestQueryRefsByDefIDInBoxContainsChildren(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	insertEncryptedQueryTestBlock(t, testDB, "root", "", "root", "d")
	insertEncryptedQueryTestBlock(t, testDB, "heading", "root", "root", "h")
	insertEncryptedQueryTestBlock(t, testDB, "paragraph", "heading", "root", "p")
	insertEncryptedQueryTestBlock(t, testDB, "sibling", "root", "root", "p")
	insertEncryptedQueryTestRef(t, testDB, "ref-heading", "heading", "root")
	insertEncryptedQueryTestRef(t, testDB, "ref-paragraph", "paragraph", "root")
	insertEncryptedQueryTestRef(t, testDB, "ref-sibling", "sibling", "root")

	refs := QueryRefsByDefIDInBox("heading", true, boxID)
	actual := map[string]bool{}
	for _, ref := range refs {
		actual[ref.DefBlockID] = true
	}
	if 2 != len(refs) || !actual["heading"] || !actual["paragraph"] || actual["sibling"] {
		t.Fatalf("unexpected refs: %#v", actual)
	}
}

func TestSelectBlocksRawStmtInBoxPaginatesExistingLimit(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	for i := 1; i <= 6; i++ {
		id := fmt.Sprintf("block-%02d", i)
		insertEncryptedQueryTestBlock(t, testDB, id, "", id, "d")
	}

	blocks := SelectBlocksRawStmtInBox("SELECT * FROM blocks ORDER BY id LIMIT 3", 2, 32, boxID)
	if 3 != len(blocks) {
		t.Fatalf("unexpected block count: %d", len(blocks))
	}
	for i, expected := range []string{"block-04", "block-05", "block-06"} {
		if expected != blocks[i].ID {
			t.Fatalf("unexpected block at %d: %s", i, blocks[i].ID)
		}
	}
}

func useEncryptedQueryTestDB(t *testing.T) (*gosql.DB, string) {
	t.Helper()
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if nil != err {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	if _, err = testDB.Exec("CREATE TABLE blocks (id TEXT NOT NULL DEFAULT '', parent_id TEXT NOT NULL DEFAULT '', root_id TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL DEFAULT '', box TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '', hpath TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', alias TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', tag TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', fcontent TEXT NOT NULL DEFAULT '', markdown TEXT NOT NULL DEFAULT '', length INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT '', subtype TEXT NOT NULL DEFAULT '', ial TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL DEFAULT '')"); nil != err {
		t.Fatalf("create blocks table failed: %s", err)
	}
	if _, err = testDB.Exec("CREATE TABLE refs (id TEXT NOT NULL DEFAULT '', def_block_id TEXT NOT NULL DEFAULT '', def_block_parent_id TEXT NOT NULL DEFAULT '', def_block_root_id TEXT NOT NULL DEFAULT '', def_block_path TEXT NOT NULL DEFAULT '', block_id TEXT NOT NULL DEFAULT '', root_id TEXT NOT NULL DEFAULT '', box TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', markdown TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '')"); nil != err {
		t.Fatalf("create refs table failed: %s", err)
	}

	boxID := t.Name()
	encryptedDBs.Store(boxID, testDB)
	t.Cleanup(func() {
		encryptedDBs.Delete(boxID)
		testDB.Close()
	})
	return testDB, boxID
}

func insertEncryptedQueryTestBlock(t *testing.T, testDB *gosql.DB, id, parentID, rootID, blockType string) {
	t.Helper()
	if _, err := testDB.Exec("INSERT INTO blocks (id, parent_id, root_id, type) VALUES (?, ?, ?, ?)", id, parentID, rootID, blockType); nil != err {
		t.Fatalf("insert block failed: %s", err)
	}
}

func insertEncryptedQueryTestRef(t *testing.T, testDB *gosql.DB, id, defBlockID, defRootID string) {
	t.Helper()
	if _, err := testDB.Exec("INSERT INTO refs (id, def_block_id, def_block_root_id) VALUES (?, ?, ?)", id, defBlockID, defRootID); nil != err {
		t.Fatalf("insert ref failed: %s", err)
	}
}
