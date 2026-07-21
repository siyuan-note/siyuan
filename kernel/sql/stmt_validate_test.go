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

func TestTailIsOnlyWhitespaceOrSQLComments(t *testing.T) {
	tests := []struct {
		s    string
		want bool
	}{
		{"", true},
		{"   \n\t", true},
		{"-- foo", true},
		{"-- foo\n", true},
		{"/* */", true},
		{"  /* x */  \n--y", true},
		{"/* no close ", true},
		{"SELECT 1", false},
		{"-- a\nSELECT 1", false},
		{"/* */;", false},
	}
	for _, tt := range tests {
		if got := tailIsOnlyWhitespaceOrSQLComments(tt.s); got != tt.want {
			t.Errorf("tailIsOnlyWhitespaceOrSQLComments(%q) = %v, want %v", tt.s, got, tt.want)
		}
	}
}

func TestContainsMultipleStatements(t *testing.T) {
	tests := []struct {
		stmt string
		want bool
	}{
		{"SELECT 1 AS n; -- 尾部注释", false},
		{"SELECT 1 AS n; -- 注释\n", false},
		{"SELECT 1 AS n; /* 仅注释 */", false},
		{"SELECT 1 AS n;   \n\t  ", false},
		{"SELECT 'a''b;c' AS s", false},
		{"SELECT 1 AS `a;b`", false},
		{"SELECT 1 AS [a;b]", false},
		{"SELECT 1; SELECT 2", true},
		{"SELECT 1; -- a\nSELECT 2", true},
		{"SELECT 1;/* */;SELECT 2", true},
	}
	for _, tt := range tests {
		if got := containsMultipleStatements(tt.stmt); got != tt.want {
			t.Errorf("containsMultipleStatements(%q) = %v, want %v", tt.stmt, got, tt.want)
		}
	}
}

func TestCheckAssetContentReadonlyStatement(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer testDB.Close()
	if _, err = testDB.Exec("CREATE TABLE asset_contents (id TEXT)"); err != nil {
		t.Fatal(err)
	}

	previousDB := assetContentDB
	assetContentDB = testDB
	defer func() {
		assetContentDB = previousDB
	}()

	if err = CheckAssetContentReadonlyStatement("SELECT id FROM asset_contents"); err != nil {
		t.Fatalf("只读语句校验失败：%s", err)
	}
	if err = CheckAssetContentReadonlyStatement("DELETE FROM asset_contents"); err == nil {
		t.Fatal("写入语句不应通过只读校验")
	}
}

func TestCheckReadonlyStatementForMainAndEncryptedDatabases(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer testDB.Close()
	if _, err = testDB.Exec("CREATE TABLE blocks (id TEXT)"); err != nil {
		t.Fatal(err)
	}

	previousDB := db
	previousIsEncryptedBoxFn := IsEncryptedBoxFn
	db = testDB
	const encryptedBoxID = "20260721120000-encbox1"
	encryptedDBs.Store(encryptedBoxID, testDB)
	IsEncryptedBoxFn = func(boxID string) bool {
		return encryptedBoxID == boxID
	}
	defer func() {
		db = previousDB
		encryptedDBs.Delete(encryptedBoxID)
		IsEncryptedBoxFn = previousIsEncryptedBoxFn
	}()

	readonlyStatements := []string{
		"SELECT id FROM blocks",
		"SELECT id FROM blocks UNION SELECT id FROM blocks",
		"WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM nums WHERE n < 3) SELECT n FROM nums",
		"-- comment\nSELECT id FROM blocks",
		"/* comment */ WITH selected AS (SELECT id FROM blocks) SELECT id FROM selected",
	}
	for _, boxID := range []string{"", encryptedBoxID} {
		for _, stmt := range readonlyStatements {
			if err = CheckReadonlyStatementInBox(stmt, boxID); err != nil {
				t.Fatalf("自定义只读语句校验失败 [box=%s, stmt=%s]：%s", boxID, stmt, err)
			}
		}
		if err = CheckReadonlyStatementInBox("DELETE FROM blocks", boxID); err == nil {
			t.Fatalf("写入语句不应通过只读校验 [box=%s]", boxID)
		}
		if err = CheckReadonlyStatementInBox("ATTACH DATABASE ':memory:' AS attached", boxID); err == nil {
			t.Fatalf("ATTACH 语句不应通过只读校验 [box=%s]", boxID)
		}
		if err = CheckReadonlyStatementInBox("BEGIN", boxID); err == nil {
			t.Fatalf("事务控制语句不应通过只读校验 [box=%s]", boxID)
		}
		if err = CheckReadonlyStatementInBox("PRAGMA query_only = OFF", boxID); err == nil {
			t.Fatalf("PRAGMA 语句不应通过只读校验 [box=%s]", boxID)
		}
	}
	if err = CheckSingleStatement("SELECT id FROM blocks; DELETE FROM blocks"); err == nil {
		t.Fatal("堆叠语句不应通过单语句校验")
	}
}
