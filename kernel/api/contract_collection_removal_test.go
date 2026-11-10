// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
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

func TestAPIContractCollectionRemovalPreview(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	tree, err := model.LoadTreeByBlockID(fixture.paragraphID)
	if err != nil {
		t.Fatal(err)
	}
	paragraph := treenode.GetNodeInTree(tree, fixture.paragraphID)
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: tree.ID,
		TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Target"})
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	view := fixture.attrView
	ruleID, itemID := ast.NewNodeID(), ast.NewNodeID()
	view.Automations = &av.AutomationConfig{Spec: 8, Rules: []*av.AutomationRule{{
		ID: ruleID, Name: "Reference collection", Enabled: true, Trigger: "block",
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{tree.ID}, ReferenceID: tree.ID},
		Actions:     []*av.AutomationAction{{Type: "collect", Target: "current"}},
	}}}
	key := view.GetBlockKeyValues()
	key.Values = append(key.Values, &av.Value{KeyID: key.Key.ID, Type: av.KeyTypeBlock, BlockID: itemID,
		Block: &av.ValueBlock{ID: paragraph.ID, CollectionRuleID: ruleID}})
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	docPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
	viewPath, _ := view.StoragePath()
	beforeDoc, err := os.ReadFile(docPath)
	if err != nil {
		t.Fatal(err)
	}
	beforeView, err := os.ReadFile(viewPath)
	if err != nil {
		t.Fatal(err)
	}
	const path = "/api/av/previewCollectionRemoval"
	for _, mode := range []string{"removed", "anchorOnly", "deletedBlock"} {
		t.Run(mode, func(t *testing.T) {
			content := "Source"
			if mode == "anchorOnly" {
				content += fmt.Sprintf(` <span data-type="block-ref" data-id="%s" data-subtype="s">New anchor</span>`, tree.ID)
			}
			op := map[string]any{"action": "update", "id": paragraph.ID,
				"data": fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">%s</div></div>`, paragraph.ID, content)}
			if mode == "deletedBlock" {
				op = map[string]any{"action": "delete", "id": paragraph.ID}
			}
			response := callAttributeViewContextFilterAPI(t, path, map[string]any{"operations": []any{op}}, previewCollectionRemoval)
			requireAPIContract(t, http.MethodPost, path, response)
			var result struct {
				Code int
				Data *apicontract.CollectionRemovalPreview
			}
			decodeAttributeViewContextFilterAPIResponse(t, response, &result)
			want := 0
			if mode == "removed" {
				want = 1
			}
			if result.Code != 0 || result.Data == nil || len(result.Data.Collections) != want || len(result.Data.SourceVersions[tree.ID]) != 64 {
				t.Fatalf("preview: %s", response.Body.String())
			}
			if want == 1 {
				group := result.Data.Collections[0]
				if group.AvID != view.ID || !group.Cleanup.AutomaticOnly || len(group.Cleanup.Items) != 1 ||
					group.Cleanup.Items[0].ItemID != itemID {
					t.Fatalf("incomplete cleanup contract: %s", response.Body.String())
				}
			}
		})
	}
	afterDoc, err := os.ReadFile(docPath)
	if err != nil || !bytes.Equal(beforeDoc, afterDoc) {
		t.Fatal("HTTP preview modified the document", err)
	}
	afterView, err := os.ReadFile(viewPath)
	if err != nil || !bytes.Equal(beforeView, afterView) {
		t.Fatal("HTTP preview modified the database", err)
	}
}

func TestAPIContractCollectionRemovalInvalidRequestsAndRoles(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const path = "/api/av/previewCollectionRemoval"
	for _, body := range []string{
		`{}`, `{"operations":[]}`, `{"operations":[null]}`,
		`{"operations":[{"action":"unsupported","id":"20261106000000-source0"}]}`,
		`{"operations":[{"action":"update","id":"invalid","data":""}]}`,
		`{"operations":[{"action":"delete","id":"20261106000000-source0"}],"tagChanges":[null]}`,
	} {
		engine := gin.New()
		engine.POST(path, previewCollectionRemoval)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
		requireAPIContract(t, http.MethodPost, path, recorder)
		var result struct{ Code int }
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != -1 {
			t.Fatalf("invalid request accepted: %s (%v)", recorder.Body.String(), err)
		}
	}
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader) })
	engine.POST(path, model.CheckAdminRole, previewCollectionRemoval)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"operations":[]}`)))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("reader accessed collection removal preview: %d", recorder.Code)
	}
}

func TestAPIContractCollectionRemovalTransactionAcknowledgement(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_COLLECTION_REMOVAL_HTTP") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractCollectionRemovalTransactionAcknowledgement$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_COLLECTION_REMOVAL_HTTP=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("collection removal HTTP subprocess failed: %v\n%s", err, output)
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
	defer func() { model.FlushTxQueue(); sql.FlushQueue(); sql.CloseDatabase() }()
	model.GlobalUndoLog.Clear("")
	util.IncBootProgress(100-util.GetBootProgress(), "")
	paragraph := treenode.GetNodeInTree(tree, fixture.paragraphID)
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: tree.ID,
		TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Target"})
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.UpsertTreeQueue(tree)
	sql.FlushQueue()
	operation := &model.Operation{Action: "delete", ID: paragraph.ID}
	preview, err := model.PreviewCollectionRemoval([]*model.Operation{operation}, nil)
	if err != nil || len(preview.Collections) != 0 || len(preview.SourceVersions) != 1 {
		t.Fatalf("source-only preview: %+v, %v", preview, err)
	}
	transaction := map[string]any{
		"doOperations":                    []*model.Operation{operation},
		"undoOperations":                  []*model.Operation{{Action: "insert", ID: paragraph.ID, ParentID: tree.ID, PreviousID: fixture.databaseID, Data: util.NewLute().RenderNodeBlockDOM(paragraph)}},
		"collectionRemovalSourceVersions": preview.SourceVersions,
	}
	post := func(transactions []map[string]any) (int, string) {
		t.Helper()
		response := callAttributeViewContextFilterAPI(t, "/api/transactions",
			map[string]any{"transactions": transactions, "reqId": 123, "app": "contract", "session": "contract"}, performTransactions)
		requireAPIContract(t, http.MethodPost, "/api/transactions", response)
		var result struct{ Code int }
		decodeAttributeViewContextFilterAPIResponse(t, response, &result)
		return result.Code, response.Body.String()
	}
	tree.Root.SetIALAttr("custom-latest", "Preserve concurrent HTTP edit")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	docPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
	before, err := os.ReadFile(docPath)
	if err != nil {
		t.Fatal(err)
	}
	for index, transactions := range [][]map[string]any{
		{transaction},
		{{"doOperations": []*model.Operation{operation, {Action: "cleanupAttrViewBlocks", AvID: fixture.attrView.ID,
			Data: apicontract.AVCollectionCleanup{SourceVersions: preview.SourceVersions, Items: []*apicontract.AVCollectionCleanupItem{}}}}}},
		{transaction, {"doOperations": []*model.Operation{{Action: "delete", ID: fixture.databaseID}}}},
	} {
		if index == 2 {
			preview, err = model.PreviewCollectionRemoval([]*model.Operation{operation}, nil)
			if err != nil {
				t.Fatal(err)
			}
			transaction["collectionRemovalSourceVersions"] = preview.SourceVersions
		}
		if code, response := post(transactions); code == 0 {
			t.Fatalf("stale or batched confirmation acknowledged success: %s", response)
		}
		after, readErr := os.ReadFile(docPath)
		if readErr != nil || !bytes.Equal(before, after) {
			t.Fatal("rejected HTTP transaction changed source bytes", readErr)
		}
		if canUndo, canRedo, _ := model.GlobalUndoLog.State(tree.ID); canUndo || canRedo {
			t.Fatal("rejected HTTP transaction entered undo history")
		}
	}
	preview, err = model.PreviewCollectionRemoval([]*model.Operation{operation}, nil)
	if err != nil {
		t.Fatal(err)
	}
	transaction["collectionRemovalSourceVersions"] = preview.SourceVersions
	if code, response := post([]map[string]any{transaction}); code != 0 {
		t.Fatalf("fresh confirmation failed: %s", response)
	}
	stored, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil || treenode.GetNodeInTree(stored, paragraph.ID) != nil || stored.Root.IALAttr("custom-latest") != "Preserve concurrent HTTP edit" {
		t.Fatal("success response preceded the actual source-only commit", err)
	}
	if canUndo, _, _ := model.GlobalUndoLog.State(tree.ID); !canUndo {
		t.Fatal("successful source-only transaction did not enter undo history")
	}
}
