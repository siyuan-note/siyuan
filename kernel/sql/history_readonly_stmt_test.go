package sql

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestHistoryReadonlyStatementGuard 覆盖历史查询 sink 的「单条 + 只读」校验
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-4hjx-84f6-gr7c
func TestHistoryReadonlyStatementGuard(t *testing.T) {
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir = filepath.Join(root, "data")
	util.TempDir = filepath.Join(root, "temp")
	util.ConfDir = filepath.Join(root, "conf")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.QueueDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	InitDatabase(true)
	InitHistoryDatabase(true)
	InitAssetContentDatabase(true)
	t.Cleanup(CloseDatabase)

	countRows := func() int {
		t.Helper()
		result, err := QueryHistory("SELECT COUNT(*) AS total FROM histories_fts_case_insensitive")
		if nil != err || 1 > len(result) {
			t.Fatalf("count history rows failed: %s", err)
		}
		return int(result[0]["total"].(int64))
	}

	valid := []string{
		"SELECT DISTINCT created FROM histories_fts_case_insensitive WHERE 1=1 AND op = 'update'",
		"SELECT * FROM histories_fts_case_insensitive WHERE histories_fts_case_insensitive MATCH '{title content}:(foo)'",
		"SELECT * FROM histories_fts_case_insensitive WHERE  id = '20260101000000-aaaaaaa' AND created = '1700000000' ORDER BY created DESC LIMIT 32",
	}
	for _, stmt := range valid {
		if err := CheckHistoryReadonlyStatement(stmt); nil != err {
			t.Fatalf("valid history statement [%s] rejected: %s", stmt, err)
		}
	}

	invalid := []string{
		"DELETE FROM histories_fts_case_insensitive",
		"INSERT INTO histories_fts_case_insensitive (id) VALUES ('20260101000000-aaaaaaa')",
		"SELECT * FROM histories_fts_case_insensitive; DELETE FROM histories_fts_case_insensitive",
		"SELECT * FROM histories_fts_case_insensitive WHERE 1=1; INSERT INTO histories_fts_case_insensitive SELECT * FROM histories_fts_case_insensitive",
		"PRAGMA journal_mode=DELETE",
		"ATTACH DATABASE 'attached.db' AS attached",
	}
	for _, stmt := range invalid {
		if err := CheckHistoryReadonlyStatement(stmt); nil == err {
			t.Fatalf("statement [%s] was not rejected", stmt)
		}
	}

	IndexHistoriesQueue([]*History{{ID: "20260101000000-aaaaaaa", Type: 1, Op: "update", Title: "t", Content: "c",
		Path: "2026-01-01-000000-update/box/20260101000000-aaaaaaa.sy", Created: "1700000000"}})
	FlushHistoryQueue()
	if 1 != countRows() {
		t.Fatalf("history seed failed: %d rows", countRows())
	}

	SelectHistoriesRawStmt("SELECT * FROM histories_fts_case_insensitive WHERE 1=0; DELETE FROM histories_fts_case_insensitive")
	if 1 != countRows() {
		t.Fatal("SelectHistoriesRawStmt executed a non-readonly statement")
	}

	if _, err := QueryHistory("SELECT * FROM histories_fts_case_insensitive; DELETE FROM histories_fts_case_insensitive"); nil == err {
		t.Fatal("QueryHistory accepted a multi-statement query")
	}
	if 1 != countRows() {
		t.Fatal("QueryHistory executed a non-readonly statement")
	}
}
