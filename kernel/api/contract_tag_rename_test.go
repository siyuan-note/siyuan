// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractTagRenameTransaction(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_TAG_RENAME_CONTRACT") == "" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractTagRenameTransaction$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_TAG_RENAME_CONTRACT=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("tag rename API subprocess failed: %v\n%s", err, output)
		}
		return
	}
	fixture := setupAttributeViewContextFilterAPITest(t)
	util.TempDir, util.ConfDir, util.HistoryDir, util.QueueDir = t.TempDir(), t.TempDir(), t.TempDir(), t.TempDir()
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	languageData, err := os.ReadFile("../../app/appearance/langs/en.json")
	if err != nil {
		t.Fatal(err)
	}
	var language struct {
		Time map[string]any `json:"_time"`
	}
	if err = json.Unmarshal(languageData, &language); err != nil {
		t.Fatal(err)
	}
	util.TimeLangs["en"] = language.Time
	tree, err := model.LoadTreeByBlockID(fixture.paragraphID)
	if err != nil {
		t.Fatal(err)
	}
	util.DBPath, util.HistoryDBPath, util.AssetContentDBPath = filepath.Join(t.TempDir(), "siyuan.db"), filepath.Join(t.TempDir(), "history.db"), filepath.Join(t.TempDir(), "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer func() { sql.FlushQueue(); sql.CloseDatabase() }()
	tree.Root.SetIALAttr("tags", "review,review/child,review-more")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.UpsertTreeQueue(tree)
	sql.FlushQueue()
	const path = "/api/tag/renameTag"
	for _, body := range []map[string]any{
		{"oldLabel": "review", "newLabel": "/done/"},
		{"oldLabel": "missing", "newLabel": "done"},
		{"oldLabel": "done", "newLabel": "done"},
	} {
		response := callAttributeViewContextFilterAPI(t, path, body, renameTag)
		requireAPIContract(t, http.MethodPost, path, response)
		var result struct {
			Code int
			Data any
		}
		decodeAttributeViewContextFilterAPIResponse(t, response, &result)
		if result.Code != 0 || result.Data != nil {
			t.Fatalf("rename compatibility: %s", response.Body.String())
		}
	}
	stored, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil || stored.Root.IALAttr("tags") != "done,done/child,review-more" {
		t.Fatal("HTTP rename did not retain tag boundaries", err)
	}
}
