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
	"context"
	"os"
	"path/filepath"
	"testing"
)

// embedBlockWritePayloads 返回嵌入块脚本可能的写语句形态：既覆盖「包含 select 子串」的绕过，
// 也覆盖 vitess 解析失败后回退原样执行的绕过。
func embedBlockWritePayloads(leakPath string) []string {
	leakPath = filepath.ToSlash(leakPath)
	return []string{
		"VACUUM INTO '" + leakPath + "' -- select",
		"VACUUM INTO (SELECT '" + leakPath + "')",
		"DELETE FROM blocks WHERE id IN (SELECT id FROM blocks)",
		"DELETE FROM blocks -- select",
		"SELECT 1; DELETE FROM blocks",
		"ATTACH DATABASE '" + leakPath + "' AS v",
		"PRAGMA writable_schema = 1 -- select",
		"UPDATE blocks SET content = 'x' WHERE id IN (SELECT id FROM blocks)",
	}
}

// TestRawBlockQueryRejectsWriteScripts 验证文档内容中的嵌入块脚本无法通过任一原始块查询出口
// 在只读路径上执行非只读语句 https://github.com/siyuan-note/siyuan/security/advisories/GHSA-67p9-hm94-xwf3
func TestRawBlockQueryRejectsWriteScripts(t *testing.T) {
	testDB := createGraphTestBlocksTable(t)
	previousDB := db
	db = testDB
	t.Cleanup(func() {
		db = previousDB
	})

	leakPath := filepath.Join(t.TempDir(), "leak.db")
	sinks := map[string]func(stmt string){
		"SelectBlocksRawStmt":             func(stmt string) { SelectBlocksRawStmt(stmt, 1, 32) },
		"SelectBlocksRawStmtNoParse":      func(stmt string) { SelectBlocksRawStmtNoParse(stmt, 32) },
		"SelectBlocksRawStmtArgs":         func(stmt string) { SelectBlocksRawStmtArgs(stmt, nil, 32) },
		"SelectBlocksRawStmtInBox":        func(stmt string) { SelectBlocksRawStmtInBox(stmt, 1, 32, "") },
		"SelectBlocksRawStmtNoParseInBox": func(stmt string) { SelectBlocksRawStmtNoParseInBox(stmt, 32, "") },
		"SelectBlocksRawStmtArgsInBox":    func(stmt string) { SelectBlocksRawStmtArgsInBox(stmt, nil, 32, "") },
		"SelectBlocksRawStmtBoundedInBox": func(stmt string) {
			SelectBlocksRawStmtBoundedInBoxContext(context.Background(), stmt, 32, "")
		},
		"SelectBlocksRawStmtInBoxContext": func(stmt string) {
			SelectBlocksRawStmtInBoxContext(context.Background(), stmt, 1, 32, "")
		},
	}

	for name, sink := range sinks {
		for _, payload := range embedBlockWritePayloads(leakPath) {
			sink(payload)

			if _, err := os.Stat(leakPath); err == nil {
				t.Fatalf("%s executed a file-writing payload, leak file created: %s", name, payload)
			}
			var count int
			if err := testDB.QueryRow("SELECT COUNT(*) FROM blocks").Scan(&count); err != nil {
				t.Fatalf("query block count failed: %s", err)
			}
			if 1 != count {
				t.Fatalf("%s executed write payload [%s], blocks count: %d", name, payload, count)
			}
		}
	}
}

// TestRawBlockQueryAcceptsReadonlyScripts 验证只读校验不会误伤正常的嵌入块查询
func TestRawBlockQueryAcceptsReadonlyScripts(t *testing.T) {
	testDB := createGraphTestBlocksTable(t)
	previousDB := db
	db = testDB
	t.Cleanup(func() {
		db = previousDB
	})

	// WITH 语句无法被 vitess 解析，会走原样执行分支，用于确认该分支仍然可用
	readonlyStatements := []string{
		"SELECT * FROM blocks",
		"SELECT * FROM blocks WHERE content LIKE '%hello%' LIMIT 1",
		"WITH selected AS (SELECT * FROM blocks) SELECT * FROM selected",
		"SELECT * FROM blocks -- 尾部注释",
	}
	for _, stmt := range readonlyStatements {
		if blocks := SelectBlocksRawStmt(stmt, 1, 32); 1 != len(blocks) {
			t.Fatalf("只读语句不应被拒绝 [%s]：%#v", stmt, blocks)
		}
		if blocks := SelectBlocksRawStmtNoParse(stmt, 32); 1 != len(blocks) {
			t.Fatalf("只读语句不应被 NoParse 出口拒绝 [%s]：%#v", stmt, blocks)
		}
	}
}

// TestRawBlockQueryRejectsJSEmbedScript 验证 JS 嵌入块脚本不会被当作 SQL 执行
func TestRawBlockQueryRejectsJSEmbedScript(t *testing.T) {
	testDB := createGraphTestBlocksTable(t)
	previousDB := db
	db = testDB
	t.Cleanup(func() {
		db = previousDB
	})

	for _, stmt := range []string{"//!js\nreturn [];", "   ", "{{ }}"} {
		if blocks := SelectBlocksRawStmt(stmt, 1, 32); nil != blocks {
			t.Fatalf("非 SQL 脚本不应被执行 [%s]：%#v", stmt, blocks)
		}
		if blocks := SelectBlocksRawStmtNoParse(stmt, 32); nil != blocks {
			t.Fatalf("非 SQL 脚本不应被执行 [%s]：%#v", stmt, blocks)
		}
	}
}

// TestRawBlockQueryGuardRoutesEncryptedBox 验证加密笔记本的嵌入块脚本在加密库连接上校验
func TestRawBlockQueryGuardRoutesEncryptedBox(t *testing.T) {
	testDB := createGraphTestBlocksTable(t)
	const encryptedBoxID = "20260721120000-encbox1"
	previousDB, previousIsEncryptedBoxFn := db, IsEncryptedBoxFn
	db = testDB
	IsEncryptedBoxFn = func(boxID string) bool {
		return encryptedBoxID == boxID
	}
	encryptedDBs.Store(encryptedBoxID, testDB)
	t.Cleanup(func() {
		db = previousDB
		IsEncryptedBoxFn = previousIsEncryptedBoxFn
		encryptedDBs.Delete(encryptedBoxID)
	})

	if blocks := SelectBlocksRawStmtNoParseInBox("DELETE FROM blocks WHERE id IN (SELECT id FROM blocks)", 32, encryptedBoxID); nil != blocks {
		t.Fatalf("加密笔记本的写语句不应通过校验：%#v", blocks)
	}
	if blocks := SelectBlocksRawStmtNoParseInBox("SELECT * FROM blocks", 32, encryptedBoxID); 1 != len(blocks) {
		t.Fatalf("加密笔记本的只读语句不应被拒绝：%#v", blocks)
	}
}
