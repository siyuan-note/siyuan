// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractTagRemovalPreview(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	tree, err := model.LoadTreeByBlockID(fixture.paragraphID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("tags", "todo")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	view := fixture.attrView
	ruleID := "20261102000000-rule001"
	view.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{ID: ruleID, Enabled: true, Trigger: "block",
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{tree.ID}, Tags: []string{"todo"}, Types: []string{"d"}},
		Actions:     []*av.AutomationAction{{Type: "collect", Target: "current"}},
	}}}
	key := view.GetBlockKeyValues()
	key.Values = append(key.Values, &av.Value{KeyID: key.Key.ID, Type: av.KeyTypeBlock, BlockID: "20261102000000-item001",
		Block: &av.ValueBlock{ID: tree.ID, CollectionRuleID: ruleID}})
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	const path = "/api/tag/previewTagRemoval"
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{"changes": []map[string]any{{"id": tree.ID, "tags": []string{"todo"}}}}, previewTagRemoval)
	requireAPIContract(t, http.MethodPost, path, response)
	var envelope struct {
		Code int
		Data []*apicontract.TagRemovalCollection
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &envelope)
	if envelope.Code != 0 || len(envelope.Data) != 1 || !envelope.Data[0].Cleanup.AutomaticOnly || len(envelope.Data[0].Cleanup.Items) != 1 {
		t.Fatalf("unexpected preview: %s", response.Body.String())
	}
	stored, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil || stored.Root.IALAttr("tags") != "todo" {
		t.Fatal("preview changed source", err)
	}
	treenode.UpsertBlockTree(stored)
}

func TestAPIContractTagRemovalWrites(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_TAG_REMOVAL_CONTRACT") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractTagRemovalWrites$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_TAG_REMOVAL_CONTRACT=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("tag removal API subprocess failed: %v\n%s", err, output)
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
	tree.Root.SetIALAttr("tags", "todo")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.UpsertTreeQueue(tree)
	sql.FlushQueue()
	view := fixture.attrView
	ruleID := "20261102000000-rule001"
	view.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{ID: ruleID, Enabled: true, Trigger: "block",
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{tree.ID}, Tags: []string{"todo"}, Types: []string{"d"}},
		Actions:     []*av.AutomationAction{{Type: "collect", Target: "current"}},
	}}}
	key := view.GetBlockKeyValues()
	key.Values = append(key.Values, &av.Value{KeyID: key.Key.ID, Type: av.KeyTypeBlock, BlockID: "20261102000000-item001",
		Block: &av.ValueBlock{ID: tree.ID, CollectionRuleID: ruleID}})
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	groups, err := model.PreviewTagRemoval(apicontract.TagRemovalPreviewRequest{Label: "todo"})
	if err != nil || len(groups) != 1 {
		t.Fatalf("preview: %+v, %v", groups, err)
	}
	const path = "/api/tag/removeTagWithCollections"
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{"label": "todo", "collections": groups}, removeTagWithCollections)
	requireAPIContract(t, http.MethodPost, path, response)
	var result struct {
		Code int
		Data any
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 || result.Data != nil {
		t.Fatalf("remove: %s", response.Body.String())
	}
	stored, err := av.ParseAttributeView(view.ID)
	if err != nil || stored.GetBlockValue("20261102000000-item001") != nil {
		t.Fatal("HTTP write did not remove confirmed entry", err)
	}
	tree, err = model.LoadTreeByBlockID(tree.ID)
	if err != nil || tree.Root.IALAttr("tags") != "" {
		t.Fatal("HTTP write did not remove tag", err)
	}
}

func TestAPIContractTagRemovalInvalidRequestsAndRoles(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, entry := range []struct {
		path, body string
		handler    gin.HandlerFunc
	}{
		{"/api/tag/previewTagRemoval", `{}`, previewTagRemoval},
		{"/api/tag/previewTagRemoval", `{"changes":[null]}`, previewTagRemoval},
		{"/api/tag/previewTagRemoval", `{"label":"todo","changes":[{"id":"invalid","tags":["todo"]}]}`, previewTagRemoval},
		{"/api/tag/removeTagWithCollections", `{"label":"","collections":[]}`, removeTagWithCollections},
	} {
		engine := gin.New()
		engine.POST(entry.path, entry.handler)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, entry.path, strings.NewReader(entry.body)))
		requireAPIContract(t, http.MethodPost, entry.path, recorder)
		var result struct{ Code int }
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != -1 {
			t.Fatalf("invalid request accepted: %s (%v)", recorder.Body.String(), err)
		}
	}
	for _, endpoint := range []struct {
		path    string
		handler gin.HandlerFunc
	}{
		{"/api/tag/previewTagRemoval", previewTagRemoval}, {"/api/tag/removeTagWithCollections", removeTagWithCollections},
	} {
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader) })
		engine.POST(endpoint.path, model.CheckAdminRole, endpoint.handler)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, endpoint.path, strings.NewReader(`{}`)))
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("reader accessed tag removal: status %d", recorder.Code)
		}
	}
}
