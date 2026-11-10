// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestAPIContractHistoryGroupPagination(t *testing.T) {
	const childEnv = "SIYUAN_TEST_API_HISTORY_GROUP_PAGINATION"
	if os.Getenv(childEnv) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestAPIContractHistoryGroupPagination$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("history API test failed: %v\n%s", err, output)
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
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Sync.Store(conf.NewSync())
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)

	created := strconv.FormatInt(time.Now().Unix(), 10)
	entries := []*sql.History{}
	for i := 0; i < 100; i++ {
		id := fmt.Sprintf("20260101000000-doc%04d", i)
		entries = append(entries, &sql.History{ID: id, Type: model.HistoryTypeDoc, Op: "delete", Title: "History", Path: "2026-01-01-000000-delete/20260101000000-box0001/" + id + ".sy", Created: created})
	}
	sql.IndexHistoriesQueue(entries)
	sql.FlushHistoryQueue()
	engine := gin.New()
	engine.POST("/api/history/searchHistory", searchHistory)
	engine.POST("/api/history/getHistoryItems", getHistoryItems)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/history/searchHistory", strings.NewReader(`{"op":"delete","type":0}`)))
	requireAPIContract(t, "POST", "/api/history/searchHistory", recorder)
	var groups struct {
		Data apicontract.SearchHistoryData `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &groups); err != nil || groups.Data.TotalCount != 1 || groups.Data.ItemCounts[created] != 100 {
		t.Fatalf("groups: %s %v", recorder.Body.String(), err)
	}
	for _, page := range []string{"", `,"page":2`, `,"page":100`} {
		recorder = httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/history/getHistoryItems", strings.NewReader(`{"created":"`+created+`","op":"delete","type":0`+page+`}`)))
		requireAPIContract(t, "POST", "/api/history/getHistoryItems", recorder)
		var response struct {
			Data apicontract.HistoryItemsData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Data.TotalCount != 100 || response.Data.PageCount != 4 {
			t.Fatalf("items: %s %v", recorder.Body.String(), err)
		}
		if page == `,"page":100` {
			if len(response.Data.Items) != 0 {
				t.Fatal("unexpected out-of-range items")
			}
		} else if len(response.Data.Items) != 32 {
			t.Fatal("wrong page size")
		}
	}
}
