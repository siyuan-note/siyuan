// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHistoryGroupPagination(t *testing.T) {
	const childEnv = "SIYUAN_TEST_HISTORY_GROUP_PAGINATION"
	if os.Getenv(childEnv) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestHistoryGroupPagination$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("history pagination failed: %v\n%s", err, output)
		}
		return
	}
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
	Conf.Editor.Store(conf.NewEditor())
	Conf.Export.Store(conf.NewExport())
	Conf.Search.Store(conf.NewSearch())
	Conf.FileTree.Store(conf.NewFileTree())
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync.Store(conf.NewSync())
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)

	const boxID = "20260101000000-box0001"
	created := strconv.FormatInt(time.Now().Unix(), 10)
	const count = 117
	histories := []*sql.History{}
	for i := count - 1; i >= 0; i-- {
		id := fmt.Sprintf("20260101000000-doc%04d", i)
		title := "Other"
		if i%2 == 0 {
			title = "Matching"
		}
		histories = append(histories, &sql.History{ID: id, Type: HistoryTypeDoc, Op: HistoryOpDelete, Title: title, Path: "2026-01-01-000000-delete/" + boxID + "/" + id + ".sy", Created: created})
	}
	sql.IndexHistoriesQueue(histories)
	sql.FlushHistoryQueue()
	groups, counts, pages, total := FullTextSearchHistoryGroups("", boxID, HistoryOpDelete, HistoryTypeDocName, 1)
	if len(groups) != 1 || counts[created] != count || pages != 1 || total != 1 {
		t.Fatalf("wrong group counts: %v %v %d %d", groups, counts, pages, total)
	}
	seen := map[string]bool{}
	previous := ""
	for page := 1; page <= (count+fileHistoryItemsPageSize-1)/fileHistoryItemsPageSize; page++ {
		items, pageCount, totalCount := FullTextSearchHistoryItemsPage(created, "", boxID, HistoryOpDelete, HistoryTypeDocName, page)
		if totalCount != count || pageCount != (count+fileHistoryItemsPageSize-1)/fileHistoryItemsPageSize {
			t.Fatalf("wrong totals: %d %d", pageCount, totalCount)
		}
		for _, item := range items {
			if seen[item.ID] || previous >= item.ID {
				t.Fatalf("duplicate or unstable order: %s after %s", item.ID, previous)
			}
			seen[item.ID] = true
			previous = item.ID
		}
	}
	if len(seen) != count {
		t.Fatalf("missing entries: %d", len(seen))
	}
	_, counts, _, _ = FullTextSearchHistoryGroups("Matching", boxID, HistoryOpDelete, HistoryTypeDocName, 1)
	_, _, total = FullTextSearchHistoryItemsPage(created, "Matching", boxID, HistoryOpDelete, HistoryTypeDocName, 1)
	if total != (count+1)/2 || counts[created] != total {
		t.Fatalf("filter count mismatch: %v %d", counts, total)
	}
	for _, op := range []string{HistoryOpUpdate, "invalid"} {
		items, _, total := FullTextSearchHistoryItemsPage(created, "", boxID, op, HistoryTypeDocName, 1)
		if len(items) != 0 || total != 0 {
			t.Fatal("operation filter bypassed")
		}
	}
	items, _, total := FullTextSearchHistoryItemsPage(created, "", "20260101000001-box0002", HistoryOpDelete, HistoryTypeDocName, 1)
	if len(items) != 0 || total != 0 {
		t.Fatal("notebook filter bypassed")
	}
	items, pages, total = FullTextSearchHistoryItemsPage(created, "", boxID, HistoryOpDelete, HistoryTypeDocName, 999)
	if len(items) != 0 || total != count || pages == 0 {
		t.Fatal("out-of-range page lost totals")
	}
	first, _, _ := FullTextSearchHistoryItemsPage(created, "", boxID, HistoryOpDelete, HistoryTypeDocName, 0)
	if len(first) != fileHistoryItemsPageSize {
		t.Fatal("invalid page must use first page")
	}
}
