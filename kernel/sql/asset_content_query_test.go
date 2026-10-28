// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	gosql "database/sql"
	"testing"
)

func TestAssetContentQueryArguments(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer testDB.Close()
	if _, err = testDB.Exec("CREATE TABLE asset_contents_fts_case_insensitive (id TEXT, name TEXT, ext TEXT, path TEXT, size INTEGER, updated INTEGER, content TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err = testDB.Exec("INSERT INTO asset_contents_fts_case_insensitive VALUES (?, ?, ?, ?, ?, ?, ?)", "id", "name", ".txt", "assets/test.txt", 4, 1, "needle"); err != nil {
		t.Fatal(err)
	}

	previousDB := assetContentDB
	assetContentDB = testDB
	defer func() {
		assetContentDB = previousDB
	}()

	stmt := "SELECT id, name, ext, path, size, updated, content FROM asset_contents_fts_case_insensitive WHERE content = ?"
	results := SelectAssetContentsRawStmtNoParseArgs(stmt, []any{"needle"}, 10)
	if 1 != len(results) || "id" != results[0].ID {
		t.Fatalf("FTS 参数查询结果错误：%v", results)
	}

	payload := "needle'; DELETE FROM asset_contents_fts_case_insensitive; --"
	SelectAssetContentsRawStmtNoParseArgs(stmt, []any{payload}, 10)
	SelectAssetContentsRawStmtNoParse("DELETE FROM asset_contents_fts_case_insensitive", 10)
	SelectAssetContentsRawStmt(stmt+"; DELETE FROM asset_contents_fts_case_insensitive", 1, 10)
	var count int
	if err = testDB.QueryRow("SELECT COUNT(*) FROM asset_contents_fts_case_insensitive").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if 1 != count {
		t.Fatalf("绑定参数中的 SQL 不应被执行，当前记录数为 %d", count)
	}
}
