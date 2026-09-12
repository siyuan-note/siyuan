package sql

import (
	gosql "database/sql"
	"testing"
)

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
