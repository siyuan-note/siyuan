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

package sql

import (
	gosql "database/sql"
	"fmt"
	"testing"
)

func TestQueryRefsByDefIDParameterizesBlockIDs(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()

	if _, err = testDB.Exec("CREATE TABLE blocks (id TEXT, parent_id TEXT)"); err != nil {
		t.Fatalf("create blocks table failed: %s", err)
	}
	if _, err = testDB.Exec("CREATE TABLE refs (id TEXT, def_block_id TEXT, def_block_parent_id TEXT, def_block_root_id TEXT, def_block_path TEXT, block_id TEXT, root_id TEXT, box TEXT, path TEXT, content TEXT, markdown TEXT, type TEXT)"); err != nil {
		t.Fatalf("create refs table failed: %s", err)
	}
	if _, err = testDB.Exec("INSERT INTO refs VALUES ('sentinel', 'definition', '', '', '', '', '', '', '', '', '', '')"); err != nil {
		t.Fatalf("insert ref failed: %s", err)
	}
	if _, err = testDB.Exec("INSERT INTO blocks (id, parent_id) VALUES ('root', ''), ('child', 'root'), ('grandchild', 'child'), ('sibling', '')"); err != nil {
		t.Fatalf("insert blocks failed: %s", err)
	}
	if _, err = testDB.Exec("INSERT INTO refs VALUES ('root-ref', 'root', '', '', '', '', '', '', '', '', '', ''), ('child-ref', 'child', '', '', '', '', '', '', '', '', '', ''), ('grandchild-ref', 'grandchild', '', '', '', '', '', '', '', '', '', ''), ('sibling-ref', 'sibling', '', '', '', '', '', '', '', '', '', '')"); err != nil {
		t.Fatalf("insert child refs failed: %s", err)
	}

	previousDB := db
	db = testDB
	defer func() {
		db = previousDB
	}()

	refs := QueryRefsByDefID("root", true)
	actual := map[string]bool{}
	for _, ref := range refs {
		actual[ref.ID] = true
	}
	if len(refs) != 3 || !actual["root-ref"] || !actual["child-ref"] || !actual["grandchild-ref"] || actual["sibling-ref"] {
		t.Fatalf("unexpected refs: %#v", actual)
	}

	QueryRefsByDefID(`"); DELETE FROM refs --`, true)

	var count int
	if err = testDB.QueryRow("SELECT COUNT(*) FROM refs WHERE id = 'sentinel'").Scan(&count); err != nil {
		t.Fatalf("query ref count failed: %s", err)
	}
	if count != 1 {
		t.Fatalf("query argument changed stored refs, count: %d", count)
	}
}

func TestInvalidRefsAreNotIndexedAndAreCleaned(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if nil != err {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()
	if _, err = testDB.Exec("CREATE TABLE refs (id TEXT, def_block_id TEXT, def_block_parent_id TEXT, def_block_root_id TEXT, def_block_path TEXT, block_id TEXT, root_id TEXT, box TEXT, path TEXT, content TEXT, markdown TEXT, type TEXT)"); nil != err {
		t.Fatalf("create refs table failed: %s", err)
	}

	tx, err := testDB.Begin()
	if nil != err {
		t.Fatalf("begin transaction failed: %s", err)
	}
	invalidRefs := []*Ref{
		{ID: "empty-definition", BlockID: "source", RootID: "source-root"},
		{ID: "empty-source", DefBlockID: "definition", RootID: "source-root"},
		{ID: "empty-source-root", DefBlockID: "definition", BlockID: "source"},
	}
	if err = insertBlockRefs(tx, invalidRefs); nil != err {
		t.Fatalf("insert refs failed: %s", err)
	}
	if err = tx.Commit(); nil != err {
		t.Fatalf("commit transaction failed: %s", err)
	}
	var count int
	if err = testDB.QueryRow("SELECT COUNT(*) FROM refs").Scan(&count); nil != err || 0 != count {
		t.Fatalf("invalid refs should not be indexed: count=%d, err=%v", count, err)
	}

	if _, err = testDB.Exec("INSERT INTO refs (id, def_block_id, block_id, root_id) VALUES ('invalid', '', 'source', 'source-root'), ('valid', 'definition', 'source', 'source-root')"); nil != err {
		t.Fatalf("insert cleanup fixtures failed: %s", err)
	}
	if err = cleanupInvalidRefs(testDB); nil != err {
		t.Fatalf("cleanup invalid refs failed: %s", err)
	}
	if err = testDB.QueryRow("SELECT COUNT(*) FROM refs").Scan(&count); nil != err || 1 != count {
		t.Fatalf("cleanup should retain only valid refs: count=%d, err=%v", count, err)
	}
}

func TestQueryRefsByDefIDsInBoxBatchesAndParameterizesIDs(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if nil != err {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()
	if _, err = testDB.Exec("CREATE TABLE refs (id TEXT, def_block_id TEXT, def_block_parent_id TEXT, " +
		"def_block_root_id TEXT, def_block_path TEXT, block_id TEXT, root_id TEXT, box TEXT, path TEXT, " +
		"content TEXT, markdown TEXT, type TEXT)"); nil != err {
		t.Fatalf("create refs table failed: %s", err)
	}
	lastIndex := queryRefsByDefIDsBatchSize
	if _, err = testDB.Exec(`WITH RECURSIVE seq(n) AS (
		SELECT 0
		UNION ALL
		SELECT n + 1 FROM seq WHERE n < ?
	)
	INSERT INTO refs
	SELECT printf('ref-%d', n), printf('def-%d', n), '', 'old-root', '', printf('block-%d', n),
		'ref-root', 'box', '/ref.sy', '', '', '' FROM seq`, lastIndex); nil != err {
		t.Fatalf("insert refs failed: %s", err)
	}

	previousDB := db
	db = testDB
	defer func() {
		db = previousDB
	}()

	defIDs := make([]string, 0, lastIndex+4)
	for i := 0; i <= lastIndex; i++ {
		defIDs = append(defIDs, fmt.Sprintf("def-%d", i))
	}
	defIDs = append(defIDs, "", "def-0", `"); DELETE FROM refs --`)
	refs := QueryRefsByDefIDsInBox(defIDs, "")
	if lastIndex+1 != len(refs) {
		t.Fatalf("unexpected refs count: got %d, want %d", len(refs), lastIndex+1)
	}
	actual := map[string]bool{}
	for _, ref := range refs {
		actual[ref.DefBlockID] = true
	}
	if !actual["def-0"] || !actual[fmt.Sprintf("def-%d", lastIndex)] {
		t.Fatalf("batched query missed boundary refs: %#v", actual)
	}

	var count int
	if err = testDB.QueryRow("SELECT COUNT(*) FROM refs").Scan(&count); nil != err {
		t.Fatalf("query ref count failed: %s", err)
	}
	if lastIndex+1 != count {
		t.Fatalf("query argument changed stored refs, count: %d", count)
	}
}
