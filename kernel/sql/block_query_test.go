// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"context"
	gosql "database/sql"
	"reflect"
	"testing"
)

func TestQueryWritesWithoutResultColumns(t *testing.T) {
	for _, kind := range []string{"limited", "raw", "arguments", "row limit"} {
		t.Run(kind, func(t *testing.T) {
			testDB, err := gosql.Open("sqlite3_extended", ":memory:")
			if err != nil {
				t.Fatal(err)
			}
			testDB.SetMaxOpenConns(1)
			previous := db
			db = testDB
			t.Cleanup(func() { db = previous; testDB.Close() })
			run := func(stmt string) ([]map[string]any, error) {
				switch kind {
				case "limited":
					rows, _, err := QueryWithLimitInfo(stmt, 2)
					return rows, err
				case "row limit":
					rows, _, err := QueryWithRowLimitInfo(stmt, 2)
					return rows, err
				case "arguments":
					return QueryNoLimitArgs(stmt)
				default:
					return QueryNoLimit(stmt)
				}
			}
			testRawSQLWrites(t, testDB, run)
		})
	}
}

func testRawSQLWrites(t *testing.T, testDB *gosql.DB, run func(string) ([]map[string]any, error)) {
	t.Helper()
	exec := func(stmt string) {
		t.Helper()
		if rows, err := run(stmt); err != nil || len(rows) != 0 {
			t.Fatalf("%s: rows=%v, err=%v", stmt, rows, err)
		}
	}
	check := func(stmt string, want int) {
		t.Helper()
		var got int
		if err := testDB.QueryRow(stmt).Scan(&got); err != nil || got != want {
			t.Fatalf("%s: got=%d, want=%d, err=%v", stmt, got, want, err)
		}
	}
	exec("CREATE TABLE query_write_items (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")
	check("SELECT count(*) FROM sqlite_schema WHERE name = 'query_write_items'", 1)
	exec("INSERT INTO query_write_items VALUES (1, 1)")
	check("SELECT n FROM query_write_items WHERE id = 1", 1)
	exec("UPDATE query_write_items SET n = n + 1 WHERE id = 1")
	check("SELECT n FROM query_write_items WHERE id = 1", 2)
	for _, stmt := range []string{
		"INSERT INTO query_write_items VALUES (1, 3)",
		"UPDATE query_write_items SET n = NULL WHERE id = 1",
	} {
		if _, err := run(stmt); err == nil {
			t.Fatalf("execution failure was reported as success: %s", stmt)
		}
		check("SELECT n FROM query_write_items WHERE id = 1", 2)
	}
	exec("ALTER TABLE query_write_items ADD COLUMN extra TEXT")
	check("SELECT count(*) FROM pragma_table_info('query_write_items') WHERE name = 'extra'", 1)
	exec("DELETE FROM query_write_items WHERE id = 1")
	check("SELECT count(*) FROM query_write_items", 0)
	exec("DROP TABLE query_write_items")
	check("SELECT count(*) FROM sqlite_schema WHERE name = 'query_write_items'", 0)
	exec("; -- empty statement")
}

func TestQueryArgumentsExecuteWritesOnce(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	previous := db
	db = testDB
	t.Cleanup(func() { db = previous })
	for _, kind := range []string{"global", "box", "context"} {
		t.Run(kind, func(t *testing.T) {
			if _, err := testDB.Exec("DROP TABLE IF EXISTS args_items; CREATE TABLE args_items (n INTEGER NOT NULL); INSERT INTO args_items VALUES (1)"); err != nil {
				t.Fatal(err)
			}
			run := func(value any) ([]map[string]any, error) {
				const stmt = "UPDATE args_items SET n = n + ?"
				switch kind {
				case "box":
					return QueryNoLimitArgsInBox(stmt, boxID, value)
				case "context":
					return QueryNoLimitArgsInBoxContext(context.Background(), stmt, boxID, value)
				default:
					return QueryNoLimitArgs(stmt, value)
				}
			}
			if rows, err := run(2); err != nil || len(rows) != 0 {
				t.Fatalf("parameterized write failed: %v, %v", rows, err)
			}
			if _, err := run(nil); err == nil {
				t.Fatal("constraint failure was ignored")
			}
			var n int
			if err := testDB.QueryRow("SELECT n FROM args_items").Scan(&n); err != nil || n != 3 {
				t.Fatalf("parameterized write skipped or repeated: %d, %v", n, err)
			}
		})
	}
}

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
	if "content = ? OR name = ? OR instr(',' || alias || ',', ?) > 0" != condition || !reflect.DeepEqual(arg, []any{"Math%_\\", "Math%_\\", ",Math%_\\,"}) {
		t.Fatalf("unexpected case-sensitive exact match: condition=%q arg=%q", condition, arg)
	}

	condition, arg = rootBlockExactMatchCondition("Math%_\\", false)
	if "content LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR (',' || alias || ',') LIKE ? ESCAPE '\\'" != condition || !reflect.DeepEqual(arg, []any{"Math\\%\\_\\\\", "Math\\%\\_\\\\", "%,Math\\%\\_\\\\,%"}) {
		t.Fatalf("unexpected case-insensitive exact match: condition=%q arg=%q", condition, arg)
	}
}

func TestDocumentSearchDepthUsesIdentityPath(t *testing.T) {
	testDB := createGraphTestBlocksTable(t)
	previousDB := db
	db = testDB
	t.Cleanup(func() { db = previousDB })
	for _, doc := range []struct{ id, dataPath, displayPath string }{
		{"nested", "/parent/nested.sy", "/Parent/Child"},
		{"literal", "/literal.sy", "/Literal/title/with/separators"},
	} {
		_, err := testDB.Exec(`INSERT INTO blocks SELECT ?, '', ?, '', 'box', ?, ?, '', '', '', '',
			'Title', '', '', 0, 'd', '', '', 0, '', ''`, doc.id, doc.id, doc.dataPath, doc.displayPath)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, result := range [][]*Block{QueryRootBlockByCondition("1=1", "no exact match", 10),
		QueryRootBlockByConditionInBox("1=1", "no exact match", 10, "box")} {
		if len(result) != 2 || result[0].ID != "literal" || result[1].ID != "nested" {
			t.Fatalf("display title changed structural depth: %+v", result)
		}
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

func TestRootBlockExactMatchBeforeLimit(t *testing.T) {
	testDB := createGraphTestBlocksTable(t)
	for _, sensitive := range []bool{true, false} {
		for _, field := range []string{"content", "name", "alias"} {
			if _, err := testDB.Exec("DELETE FROM blocks"); err != nil {
				t.Fatal(err)
			}
			keyword := "Math%_\\'"
			value := keyword
			if field == "alias" {
				value = "Other," + value + ",Last"
			}
			if _, err := testDB.Exec("INSERT INTO blocks (id, content, name, alias) VALUES ('partial', 'Higher Math', 'Higher Math', 'Higher Math')"); err != nil {
				t.Fatal(err)
			}
			if _, err := testDB.Exec("INSERT INTO blocks (id, "+field+") VALUES ('exact', ?)", value); err != nil {
				t.Fatal(err)
			}
			condition, args := rootBlockExactMatchCondition(keyword, sensitive)
			var id string
			if err := testDB.QueryRow("SELECT id FROM blocks ORDER BY CASE WHEN "+condition+" THEN 0 ELSE 1 END, rowid LIMIT 1", args...).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if id != "exact" {
				t.Fatalf("exact %s match lost before limit (sensitive=%t): %s", field, sensitive, id)
			}
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
