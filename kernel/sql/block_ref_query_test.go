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
