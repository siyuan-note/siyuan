// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestAPIContractDailyNoteSelectionFailure(t *testing.T) {

	if os.Getenv("SIYUAN_TEST_DAILY_SELECTION_CONTRACT") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractDailyNoteSelectionFailure$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_DAILY_SELECTION_CONTRACT=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("daily selection subprocess: %v\n%s", err, output)
		}
		return
	}
	boxID := documentPathAPIWorkspace(t)

	util.DBPath = filepath.Join(t.TempDir(), "siyuan.db")
	util.HistoryDBPath = filepath.Join(t.TempDir(), "history.db")
	util.AssetContentDBPath = filepath.Join(t.TempDir(), "asset_content.db")
	util.QueueDir = t.TempDir()
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)

	box := &model.Box{ID: boxID}
	config := conf.NewBoxConf()
	config.Name, config.Closed, config.DailyNoteSavePath = "Daily", false, "/Repeated/Daily"
	if err := box.SaveConf(config); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		id := fmt.Sprintf("20261031020000-%07d", i)
		treenode.UpsertBlockTree(treenode.NewTree(boxID, "/"+id+".sy", "/Repeated", "Repeated"))
	}
	if err := treenode.SetDocumentMetadataState(boxID, "ready"); err != nil {
		t.Fatal(err)
	}
	request := apicontract.FileTreeDailyNoteRequest{Notebook: boxID, Date: "2026-10-31"}
	response := documentPathAPIRequest(t, "/api/filetree/createDailyNote", createDailyNote, request)
	var result struct {
		Code int
		Data apicontract.DocumentSelectionFailure
	}
	if err := json.Unmarshal(response, &result); err != nil || result.Code != -1 || result.Data.Notebook != boxID || len(result.Data.Ambiguity.Candidates) != 2 {
		t.Fatalf("daily selection response invalid: %s %v", response, err)
	}
	preview := documentPathAPIRequest(t, "/api/filetree/getDailyNoteInfo", getDailyNoteInfo, apicontract.DailyNoteInfoRequest{Notebook: boxID, Date: "2026-10-31"})
	var info struct {
		Code int
		Data apicontract.DailyNoteInfo
	}
	if err := json.Unmarshal(preview, &info); err != nil || info.Code != 0 || info.Data.Title != "Daily" || info.Data.Existed {
		t.Fatalf("daily candidate disappeared: %s %v", preview, err)
	}
	request.Selection = &apicontract.DocumentSelection{Time: result.Data.Ambiguity.Time, TargetRevision: "stale",
		AncestorChoices: []apicontract.DocumentAncestorChoice{{Index: 0, ID: result.Data.Ambiguity.Candidates[0].ID, Revision: result.Data.Ambiguity.Candidates[0].Revision}}}
	response = documentPathAPIRequest(t, "/api/filetree/createDailyNote", createDailyNote, request)
	if err := json.Unmarshal(response, &result); err != nil || result.Code != -1 {
		t.Fatalf("stale selection accepted: %s %v", response, err)
	}
}
