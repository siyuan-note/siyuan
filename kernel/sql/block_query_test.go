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
	"testing"
)

func createGraphTestBlocksTable(t *testing.T) *gosql.DB {
	t.Helper()
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		testDB.Close()
	})
	if _, err = testDB.Exec("CREATE TABLE blocks (id TEXT, parent_id TEXT, root_id TEXT, hash TEXT, box TEXT, path TEXT, hpath TEXT, name TEXT, alias TEXT, memo TEXT, tag TEXT, content TEXT, fcontent TEXT, markdown TEXT, length INTEGER, type TEXT, subtype TEXT, ial TEXT, sort INTEGER, created TEXT, updated TEXT)"); err != nil {
		t.Fatalf("create blocks table failed: %s", err)
	}
	if _, err = testDB.Exec("INSERT INTO blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated) VALUES ('child', 'root', 'root', '', '', '/', '/', '', '', '', '', 'hello', '', '', 0, 'p', '', '', 0, '', '')"); err != nil {
		t.Fatalf("insert block failed: %s", err)
	}
	return testDB
}

// TestGraphChildBlocksRejectNonSingleStatement 验证关系图查询条件无法通过多语句拼接执行写入语句，
// 执行前由 CheckSingleStatement 拒绝 https://github.com/siyuan-note/siyuan/security/advisories/GHSA-5rwv-4j4c-f954
func TestGraphChildBlocksRejectNonSingleStatement(t *testing.T) {
	testDB := createGraphTestBlocksTable(t)
	previousDB := db
	db = testDB
	defer func() {
		db = previousDB
	}()

	blocks := GetAllChildBlocks([]string{"root"}, "1=1); DELETE FROM blocks; --", 10)
	if 0 != len(blocks) {
		t.Fatalf("unexpected blocks returned for injected condition: %#v", blocks)
	}
	var count int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM blocks").Scan(&count); err != nil {
		t.Fatalf("query block count failed: %s", err)
	}
	if 1 != count {
		t.Fatalf("injected statement changed blocks, count: %d", count)
	}
}

// TestGraphLocalChildBlocksRejectNonSingleStatement 验证局部关系图查询条件同样无法通过多语句拼接执行写入语句
func TestGraphLocalChildBlocksRejectNonSingleStatement(t *testing.T) {
	testDB := createGraphTestBlocksTable(t)
	previousDB := db
	db = testDB
	defer func() {
		db = previousDB
	}()

	blocks := GetChildBlocks("root", "1=1); DELETE FROM blocks; --", 10)
	if 0 != len(blocks) {
		t.Fatalf("unexpected blocks returned for injected condition: %#v", blocks)
	}
	var count int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM blocks").Scan(&count); err != nil {
		t.Fatalf("query block count failed: %s", err)
	}
	if 1 != count {
		t.Fatalf("injected statement changed blocks, count: %d", count)
	}
}

// TestGraphChildBlocksAcceptNormalCondition 验证正常的只读查询条件不受校验影响
func TestGraphChildBlocksAcceptNormalCondition(t *testing.T) {
	testDB := createGraphTestBlocksTable(t)
	previousDB := db
	db = testDB
	defer func() {
		db = previousDB
	}()

	blocks := GetAllChildBlocks([]string{"root"}, "(content LIKE '%hello%')", 10)
	if 1 != len(blocks) || "child" != blocks[0].ID {
		t.Fatalf("unexpected blocks: %#v", blocks)
	}
}

func TestRootBlockExactMatchCondition(t *testing.T) {
	condition, arg := rootBlockExactMatchCondition("Math%_\\", true)
	if "content = ?" != condition || "Math%_\\" != arg {
		t.Fatalf("unexpected case-sensitive exact match: condition=%q arg=%q", condition, arg)
	}

	condition, arg = rootBlockExactMatchCondition("Math%_\\", false)
	if "content LIKE ? ESCAPE '\\'" != condition || "Math\\%\\_\\\\" != arg {
		t.Fatalf("unexpected case-insensitive exact match: condition=%q arg=%q", condition, arg)
	}
}

func TestQueryLikeEscape(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()

	if _, err = testDB.Exec("CREATE TABLE blocks (id TEXT, content TEXT)"); err != nil {
		t.Fatalf("create blocks table failed: %s", err)
	}
	if _, err = testDB.Exec("INSERT INTO blocks VALUES ('literal', 'a%b'), ('wildcard', 'axb')"); err != nil {
		t.Fatalf("insert blocks failed: %s", err)
	}

	previousDB := db
	db = testDB
	defer func() {
		db = previousDB
	}()

	stmts := []string{
		`SELECT id FROM blocks WHERE content LIKE '%a\%b%' ESCAPE '\' ORDER BY id LIMIT 10`,
		`SELECT id FROM blocks WHERE content LIKE '%a\%b%' ESCAPE '\' ORDER BY id`,
	}
	for _, stmt := range stmts {
		rows, queryErr := Query(stmt, 10)
		if queryErr != nil {
			t.Fatalf("query failed [stmt=%s]: %s", stmt, queryErr)
		}
		if 1 != len(rows) || "literal" != rows[0]["id"] {
			t.Fatalf("unexpected query result [stmt=%s]: %#v", stmt, rows)
		}
	}
}

func TestQueryPreservesOriginalErrorWithLimit(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()

	if _, err = testDB.Exec("CREATE TABLE blocks (id TEXT)"); err != nil {
		t.Fatalf("create blocks table failed: %s", err)
	}

	previousDB := db
	db = testDB
	defer func() {
		db = previousDB
	}()

	_, err = Query("SELECT id, previous_id, next_id FROM blocks LIMIT 2", 10)
	if err == nil || "no such column: previous_id" != err.Error() {
		t.Fatalf("unexpected query error: %v", err)
	}
}
