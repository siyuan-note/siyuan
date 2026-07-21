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
