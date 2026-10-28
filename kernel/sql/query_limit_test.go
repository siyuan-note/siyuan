// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"context"
	gosql "database/sql"
	"fmt"
	"math"
	"testing"
)

func TestQueryRowLimit(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	testDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = testDB.Close() })
	previousDB := db
	db = testDB
	t.Cleanup(func() { db = previousDB })
	if _, err = testDB.Exec("CREATE TABLE items (n INTEGER, content TEXT); INSERT INTO items VALUES (1, 'a'), (2, 'a'), (3, 'a'), (4, 'a'), (5, 'a')"); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		stmt      string
		count     int
		truncated bool
	}{
		{"SELECT n FROM items ORDER BY n", 3, true},
		{"SELECT n FROM items WHERE n <= 3 ORDER BY n", 3, false},
		{"SELECT n FROM items WHERE n < 0", 0, false},
		{"SELECT n FROM items ORDER BY n LIMIT 5", 3, true},
		{"SELECT n FROM items ORDER BY n LIMIT -1", 3, true},
		{"SELECT n FROM items ORDER BY n LIMIT 2", 2, false},
		{"SELECT n FROM items ORDER BY n LIMIT 3 OFFSET 3", 2, false},
		{"SELECT n FROM items UNION SELECT 6 ORDER BY n", 3, true},
		{"WITH x AS (SELECT n FROM items LIMIT 5) SELECT n FROM x ORDER BY n", 3, true},
		{"SELECT n FROM items -- comment\nORDER BY n", 3, true},
		{`SELECT n FROM items WHERE content LIKE '%a%' ESCAPE '\' ORDER BY n`, 3, true},
	} {
		rows, info, queryErr := QueryWithRowLimitInfo(tc.stmt, 3)
		if queryErr != nil || rows == nil || len(rows) != tc.count || info.Limit != 3 || info.Truncated != tc.truncated {
			t.Fatalf("%s: rows=%v info=%+v err=%v", tc.stmt, rows, info, queryErr)
		}
		if tc.count > 0 && rows[0]["n"] != int64(1) && tc.stmt != "SELECT n FROM items ORDER BY n LIMIT 3 OFFSET 3" {
			t.Fatalf("query order changed: %s: %v", tc.stmt, rows)
		}
	}
	for _, limit := range []int{0, -1, math.MaxInt} {
		if _, _, err = QueryWithRowLimitInfo("SELECT 1", limit); err == nil {
			t.Fatalf("invalid limit accepted: %d", limit)
		}
	}
	if _, _, err = QueryWithRowLimitInfo("SELECT abs(-9223372036854775808)", 3); err == nil {
		t.Fatal("row iteration error was ignored")
	}
	rows, err := Query(`SELECT n FROM items WHERE content LIKE '%a%' ESCAPE '\' ORDER BY n`, 3)
	if err != nil || len(rows) != 3 {
		t.Fatalf("raw fallback exceeded default limit: %v %v", rows, err)
	}
}

// 带参查询与资源内容查询同样以 limit 为上限：语句未写 LIMIT 时不得多返回一行，
// 否则以 len(rows) == limit 判定截断的调用方会误认结果未截断。
func TestRawStatementQueriesHonourRowLimit(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	testDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = testDB.Close() })
	previousDB, previousAssetDB := db, assetContentDB
	db, assetContentDB = testDB, testDB
	t.Cleanup(func() { db, assetContentDB = previousDB, previousAssetDB })
	if _, err = testDB.Exec("CREATE TABLE items (n INTEGER, content TEXT); INSERT INTO items VALUES (1, 'a'), (2, 'a'), (3, 'a'), (4, 'a'), (5, 'a')"); err != nil {
		t.Fatal(err)
	}

	for _, limit := range []int{1, 3, 5} {
		rows, queryErr := queryRawStmtArgs("SELECT n FROM items WHERE n >= ? ORDER BY n", []any{1}, limit)
		if queryErr != nil || len(rows) != limit {
			t.Fatalf("queryRawStmtArgs limit=%d: got %d rows, err=%v", limit, len(rows), queryErr)
		}
		assetRows, assetErr := queryAssetContentRawStmt("SELECT n FROM items WHERE n >= ? ORDER BY n", []any{1}, limit)
		if assetErr != nil || len(assetRows) != limit {
			t.Fatalf("queryAssetContentRawStmt limit=%d: got %d rows, err=%v", limit, len(assetRows), assetErr)
		}
		assets := selectAssetContentsRawStmt("SELECT n, content, '', content, 0, 0, content FROM items WHERE n >= ? ORDER BY n", []any{1}, limit)
		if len(assets) != limit {
			t.Fatalf("selectAssetContentsRawStmt limit=%d: got %d rows", limit, len(assets))
		}
	}

	// 语句自带 LIMIT 时由语句决定行数，本层不再截断。
	rows, err := queryRawStmtArgs("SELECT n FROM items ORDER BY n LIMIT 2", nil, 3)
	if err != nil || len(rows) != 2 {
		t.Fatalf("statement limit was overridden: %d rows, err=%v", len(rows), err)
	}
}

func TestBlockRawStatementRowLimitsInBothDatabases(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	previousDB := db
	db = testDB
	t.Cleanup(func() { db = previousDB })
	for i := 1; i <= 5; i++ {
		insertEncryptedQueryTestBlock(t, testDB, fmt.Sprintf("row-%d", i), "", "root", "p")
	}
	const statement = "SELECT * FROM blocks ORDER BY id"
	for _, scenario := range []struct {
		name string
		run  func(string, int) (int, error)
	}{
		{"global block args", func(stmt string, limit int) (int, error) {
			rows := SelectBlocksRawStmtArgs(stmt, nil, limit)
			return len(rows), nil
		}},
		{"global block no parse", func(stmt string, limit int) (int, error) {
			return len(SelectBlocksRawStmtNoParse(stmt, limit)), nil
		}},
		{"encrypted block args", func(stmt string, limit int) (int, error) {
			rows, err := SelectBlocksRawStmtArgsInBoxContext(context.Background(), stmt, nil, limit, boxID)
			return len(rows), err
		}},
		{"encrypted block no parse", func(stmt string, limit int) (int, error) {
			return len(SelectBlocksRawStmtNoParseInBox(stmt, limit, boxID)), nil
		}},
		{"encrypted map", func(stmt string, limit int) (int, error) {
			rows, err := queryRawStmtForBox(boxID, stmt, limit)
			return len(rows), err
		}},
		{"encrypted map args", func(stmt string, limit int) (int, error) {
			rows, err := queryRawStmtArgsForBox(boxID, stmt, nil, limit)
			return len(rows), err
		}},
		{"encrypted map args context", func(stmt string, limit int) (int, error) {
			rows, err := queryRawStmtArgsForBoxContext(context.Background(), boxID, stmt, nil, limit)
			return len(rows), err
		}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			for _, limit := range []int{1, 3, 5, 6} {
				count, err := scenario.run(statement, limit)
				if err != nil || count != min(limit, 5) {
					t.Fatalf("limit %d: count=%d, err=%v", limit, count, err)
				}
			}
			count, err := scenario.run(statement+" LIMIT 4", 1)
			if err != nil || count != 4 {
				t.Fatalf("explicit SQL limit must take precedence: count=%d, err=%v", count, err)
			}
		})
	}
}

func TestQueryWithLimitInfo(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()
	previousDB := db
	db = testDB
	defer func() { db = previousDB }()
	if _, err = testDB.Exec("CREATE TABLE items (n INTEGER); INSERT INTO items VALUES (1), (2), (3), (4), (5)"); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, stmt   string
		count, limit int
		truncated    bool
	}{
		{"empty", "SELECT n FROM items WHERE n < 0", 0, 3, false},
		{"below", "SELECT n FROM items WHERE n < 3", 2, 3, false},
		{"equal", "SELECT n FROM items WHERE n <= 3", 3, 3, false},
		{"above", "SELECT n FROM items ORDER BY n", 3, 3, true},
		{"explicit below", "SELECT n FROM items LIMIT 2", 2, 0, false},
		{"explicit equal", "SELECT n FROM items LIMIT 3", 3, 0, false},
		{"explicit above", "SELECT n FROM items LIMIT 4", 4, 0, false},
		{"explicit zero", "SELECT n FROM items LIMIT 0", 0, 0, false},
		{"explicit unlimited", "SELECT n FROM items LIMIT -1", 5, 0, false},
		{"offset", "SELECT n FROM items ORDER BY n LIMIT 3 OFFSET 3", 2, 0, false},
		{"aggregate", "SELECT count(*) FROM items", 1, 3, false},
		{"union", "SELECT n FROM items UNION SELECT 6", 3, 3, true},
		{"union explicit", "SELECT n FROM items UNION SELECT 6 LIMIT 5", 5, 0, false},
		{"nested", "SELECT n FROM (SELECT n FROM items LIMIT 4)", 3, 3, true},
		{"cte", "WITH x AS (SELECT n FROM items LIMIT 4) SELECT * FROM x", 3, 3, true},
		{"fallback", "SELECT n || ' limit ' FROM items UNION SELECT 'x'", 3, 3, true},
		{"fallback below", "SELECT n || '' FROM items WHERE n < 2 UNION SELECT 'x'", 2, 3, false},
		{"fallback equal", "SELECT n || '' FROM items WHERE n < 3 UNION SELECT 'x'", 3, 3, false},
		{"fallback explicit", "SELECT n || '' FROM items UNION SELECT 'x' LIMIT\n4", 4, 0, false},
		{"fallback nested", "SELECT n || '' FROM (SELECT n FROM items LIMIT 4) UNION SELECT 'x'", 3, 3, true},
		{"fallback comment", "SELECT n || '' FROM items UNION SELECT 'x' /* LIMIT 1 */", 3, 3, true},
		{"multiple", "SELECT n FROM items LIMIT 1; SELECT n FROM items", 3, 3, true},
		{"multiple explicit", "SELECT n FROM items; SELECT n FROM items LIMIT 4", 4, 0, false},
		{"multiple write", "SELECT 1; INSERT INTO items VALUES (6) RETURNING n", 1, 3, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows, info, queryErr := QueryWithLimitInfo(tc.stmt, 3)
			if queryErr != nil {
				t.Fatal(queryErr)
			}
			if rows == nil || len(rows) != tc.count || info.Limit != tc.limit || info.Truncated != tc.truncated {
				t.Fatalf("rows=%v info=%+v, want count=%d limit=%d truncated=%v", rows, info, tc.count, tc.limit, tc.truncated)
			}
		})
	}
	var count int
	if err = testDB.QueryRow("SELECT count(*) FROM items WHERE n = 6").Scan(&count); err != nil || count != 1 {
		t.Fatalf("write executed more than once: count=%d err=%v", count, err)
	}
	if _, _, err = QueryWithLimitInfo("SELECT * FROM missing_table", 3); err == nil {
		t.Fatal("expected query error")
	}
	if _, _, err = QueryWithLimitInfo("SELECT abs(-9223372036854775808)", 3); err == nil {
		t.Fatal("expected row iteration error")
	}
	if _, _, err = QueryWithLimitInfo("SELECT abs(-9223372036854775808) || '' UNION SELECT 'x'", 3); err == nil {
		t.Fatal("expected raw row iteration error")
	}
	rows, _, err := QueryWithLimitInfo("SELECT n FROM items ORDER BY n LIMIT 2 OFFSET 3", 3)
	if err != nil || len(rows) != 2 || rows[0]["n"] != int64(4) || rows[1]["n"] != int64(5) {
		t.Fatalf("unexpected page: rows=%v err=%v", rows, err)
	}
}

func TestContainsOuterLimitClause(t *testing.T) {
	for _, stmt := range []string{
		"SELECT * FROM t LIMIT\n3; -- trailing",
		"SELECT * FROM t LiMiT/* comment */3",
		"SELECT 1; SELECT * FROM t LIMIT 3;; /* trailing */",
	} {
		if !containsOuterLimitClause(stmt) {
			t.Errorf("missing outer limit: %s", stmt)
		}
	}
	for _, stmt := range []string{
		"SELECT ' limit ', 'it''s limit ', \"limit\", `limit`, [limit] FROM t",
		"SELECT * FROM (SELECT * FROM t LIMIT 3)",
		"SELECT * FROM t -- LIMIT 3",
		"SELECT * FROM t /* LIMIT 3 */",
		"SELECT * FROM t LIMIT 3; SELECT * FROM t",
		"SELECT [a' limit ] FROM t",
	} {
		if containsOuterLimitClause(stmt) {
			t.Errorf("unexpected outer limit: %s", stmt)
		}
	}
}
