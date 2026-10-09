package model

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestHistorySearchInjection 覆盖历史搜索的注入回归
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-4hjx-84f6-gr7c
func TestHistorySearchInjection(t *testing.T) {
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir = filepath.Join(root, "data")
	util.TempDir = filepath.Join(root, "temp")
	util.ConfDir = filepath.Join(root, "conf")
	util.HistoryDir = filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir, util.QueueDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	Conf.Search = conf.NewSearch()
	Conf.FileTree = conf.NewFileTree()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)

	const boxID = "20260101000000-box0001"
	const docID = "20260101000000-doc0001"
	const deletedDocID = "20260101000001-doc0002"
	created := strconv.FormatInt(time.Now().Unix(), 10)
	deletedCreated := strconv.FormatInt(time.Now().Add(-time.Minute).Unix(), 10)
	sql.IndexHistoriesQueue([]*sql.History{
		{ID: docID, Type: HistoryTypeDoc, Op: HistoryOpUpdate, Title: "Canary", Content: "HISTORYCANARY",
			Path: "2026-01-01-000000-update/" + boxID + "/" + docID + ".sy", Created: created},
		{ID: deletedDocID, Type: HistoryTypeDoc, Op: HistoryOpDelete, Title: "Deleted title", Content: "DELETEDTEXT",
			Path: "2026-01-01-000000-delete/" + boxID + "/" + deletedDocID + ".sy", Created: deletedCreated},
	})
	sql.FlushHistoryQueue()

	countRows := func() int {
		t.Helper()
		result, err := sql.QueryHistory("SELECT COUNT(*) AS total FROM histories_fts_case_insensitive")
		if nil != err || 1 > len(result) {
			t.Fatalf("count history rows failed: %s", err)
		}
		return int(result[0]["total"].(int64))
	}
	if 2 != countRows() {
		t.Fatalf("history seed failed: %d rows", countRows())
	}

	// 正常查询不受影响
	if items := FullTextSearchHistoryItems(created, docID, "%", "", HistoryTypeDocID); 1 != len(items) || docID != items[0].ID {
		t.Fatalf("normal docID search broken: %+v", items)
	}
	if _, _, total := FullTextSearchHistory("", "%", HistoryOpUpdate, HistoryTypeDoc, 1); 1 != total {
		t.Fatalf("normal op filter broken: %d", total)
	}
	if _, _, total := FullTextSearchHistory("Canary", "%", "all", HistoryTypeDoc, 1); 1 != total {
		t.Fatalf("normal content search broken: %d", total)
	}

	// type=3 的 query 注入不再泄漏其他历史记录
	union := "x' UNION SELECT id, type, op, title, content, path, created FROM histories_fts_case_insensitive --"
	if items := FullTextSearchHistoryItems(created, union, "%", "", HistoryTypeDocID); 0 != len(items) {
		t.Fatalf("UNION injection leaked %d items", len(items))
	}
	if items := FullTextSearchHistoryItems(created, docID+"' OR '1'='1", "%", "", HistoryTypeDocID); 0 != len(items) {
		t.Fatalf("quote injection leaked %d items", len(items))
	}

	// op 注入不再绕过过滤条件
	if _, _, total := FullTextSearchHistory("", "%", "delete' OR '1'='1", HistoryTypeDoc, 1); 0 != total {
		t.Fatalf("op injection bypassed the filter: %d", total)
	}

	// 堆叠写语句被拒绝
	before := countRows()
	write := "x'; INSERT INTO histories_fts_case_insensitive (id, type, op, title, content, path, created) " +
		"SELECT '20260101000002-doc0003', '1', 'update', 'INJECTED', 'PWNED', '/box/evil.sy', '" + created + "' FROM histories_fts_case_insensitive WHERE '1'='1"
	FullTextSearchHistoryItems(created, write, "%", "", HistoryTypeDocID)
	if after := countRows(); before != after {
		t.Fatalf("stacked INSERT was executed: %d -> %d rows", before, after)
	}
	if items := FullTextSearchHistoryItems(created, "20260101000002-doc0003", "%", "", HistoryTypeDocID); 0 != len(items) {
		t.Fatal("the injected history row is retrievable")
	}
}
