// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"context"
	dbsql "database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
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

type relationDetailAPIFixture struct {
	*attributeViewContextFilterAPIFixture
	target  *av.AttributeView
	context model.AttributeViewRelationContext
	rowIDs  []string
}

type relationDetailAPIResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data *struct {
		ID            string                         `json:"id"`
		ViewID        string                         `json:"viewID"`
		View          *av.Table                      `json:"view"`
		ContextFilter *av.AttributeViewContextFilter `json:"contextFilter"`
		Error         string                         `json:"error"`
	} `json:"data"`
}

type relationDetailCandidatesAPIResponse struct {
	Code int                                   `json:"code"`
	Msg  string                                `json:"msg"`
	Data *apicontract.AVRelationCandidatesData `json:"data"`
}

func setupRelationDetailAPITest(t *testing.T) *relationDetailAPIFixture {
	t.Helper()
	base := setupAttributeViewContextFilterAPITest(t)
	target := av.NewAttributeView(ast.NewNodeID())
	itemID := ast.NewNodeID()
	base.attrView.GetBlockKeyValues().Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: base.attrView.GetBlockKey().ID,
		BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Source entry"}}}
	base.attrView.Views[0].ItemIDs = []string{itemID}
	rows := []string{ast.NewNodeID(), ast.NewNodeID()}
	for index, id := range rows {
		content := "related target"
		if index == 1 {
			content = "unrelated target"
		}
		target.GetBlockKeyValues().Values = append(target.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(),
			KeyID: target.GetBlockKey().ID, BlockID: id, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: content}})
	}
	target.Views[0].ItemIDs = append([]string(nil), rows...)
	relation, err := base.attrView.GetKeyValues(base.relationKeyID)
	if err != nil {
		t.Fatal(err)
	}
	relation.Key.Relation = &av.Relation{AvID: target.ID, DetailView: &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: target.Views[0].ID},
		CandidateFilters: []*av.ViewFilter{{Column: target.GetBlockKey().ID, Operator: av.FilterOperatorContains,
			Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "not eligible"}}}}}
	relation.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: base.relationKeyID, BlockID: itemID, Type: av.KeyTypeRelation,
		Relation: &av.ValueRelation{BlockIDs: []string{rows[0]}}}}
	for _, database := range []*av.AttributeView{base.attrView, target} {
		if err = av.SaveAttributeView(database); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { av.SetAVBoxID(target.ID, "") })
	return &relationDetailAPIFixture{attributeViewContextFilterAPIFixture: base, target: target, rowIDs: rows,
		context: model.AttributeViewRelationContext{SourceAvID: base.attrView.ID, SourceItemID: itemID, RelationKeyID: base.relationKeyID}}
}

func (fixture *relationDetailAPIFixture) payload() map[string]any {
	return map[string]any{"id": fixture.target.ID, "blockID": fixture.databaseID, "viewID": fixture.target.Views[0].ID,
		"page": 1, "pageSize": -1, "createIfNotExist": false, "relationContext": fixture.context}
}

func callRelationDetailContract(t *testing.T, payload map[string]any, role model.Role) (*httptest.ResponseRecorder, relationDetailAPIResponse) {
	t.Helper()
	const path = "/api/av/renderAttributeView"
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
	engine.POST(path, renderAttributeView)
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, http.MethodPost, path, recorder)
	var response relationDetailAPIResponse
	decodeAttributeViewContextFilterAPIResponse(t, recorder, &response)
	return recorder, response
}

func requireRelationDetailRows(t *testing.T, recorder *httptest.ResponseRecorder, response relationDetailAPIResponse, ids ...string) {
	t.Helper()
	if response.Code != 0 || response.Data == nil || response.Data.View == nil ||
		response.Data.View.RowCount != len(ids) || len(response.Data.View.Rows) != len(ids) {
		t.Fatalf("unexpected relation detail membership: %s", recorder.Body.String())
	}
	for i, id := range ids {
		if response.Data.View.Rows[i].ID != id {
			t.Fatalf("relation detail returned an unrelated row: %s", recorder.Body.String())
		}
	}
}

func requireRelationDetailRejected(t *testing.T, payload map[string]any, role model.Role) relationDetailAPIResponse {
	t.Helper()
	recorder, response := callRelationDetailContract(t, payload, role)
	if response.Code != -1 || response.Data != nil && response.Data.View != nil {
		t.Fatalf("invalid relation detail request exposed a view: %s", recorder.Body.String())
	}
	return response
}

func callRelationDetailCandidatesContract(t *testing.T, payload map[string]any, role model.Role) (*httptest.ResponseRecorder, relationDetailCandidatesAPIResponse) {
	t.Helper()
	const path = "/api/av/getAttributeViewRelationCandidates"
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
	engine.POST(path, contractRouteHandlers(apicontract.GetAttributeViewRelationCandidates, getAttributeViewRelationCandidates)...)
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	var response relationDetailCandidatesAPIResponse
	// 权限中间件的空 403 响应不属于候选处理函数的 JSON 契约。
	if recorder.Code == http.StatusForbidden {
		if recorder.Body.Len() != 0 {
			t.Fatalf("candidate permission guard exposed response data: %s", recorder.Body.String())
		}
		return recorder, response
	}
	requireAPIContract(t, http.MethodPost, path, recorder)
	decodeAttributeViewContextFilterAPIResponse(t, recorder, &response)
	return recorder, response
}

func (fixture *relationDetailAPIFixture) candidatesPayload() map[string]any {
	return map[string]any{"avID": fixture.attrView.ID, "keyID": fixture.relationKeyID, "blockID": fixture.databaseID,
		"page": 1, "pageSize": -1, "selectedBlockIDs": []string{fixture.rowIDs[0]}, "relationContext": fixture.context}
}

func TestAPIContractRelationDetailCandidates(t *testing.T) {
	fixture := setupRelationDetailAPITest(t)
	payload := fixture.candidatesPayload()
	recorder, response := callRelationDetailCandidatesContract(t, payload, model.RoleAdministrator)
	if response.Code != 0 || response.Data == nil || response.Data.Total != 0 || len(response.Data.Rows) != 0 ||
		len(response.Data.SelectedRows) != 1 || response.Data.SelectedRows[0].ID != fixture.rowIDs[0] {
		t.Fatalf("candidate filters did not preserve the selected relation independently: %s", recorder.Body.String())
	}
	key, _ := fixture.attrView.GetKey(fixture.relationKeyID)
	key.Relation.CandidateFilters[0].Value.Block.Content = "unrelated"
	fixture.target.NewItemTemplates = []*av.NewItemTemplate{{ID: ast.NewNodeID(), Name: "Default",
		TargetType: av.NewItemTargetDetached, PrimaryKeyTemplate: "Scoped target task"}}
	fixture.target.DefaultTemplateID = fixture.target.NewItemTemplates[0].ID
	before := map[string][]byte{}
	for _, database := range []*av.AttributeView{fixture.attrView, fixture.target} {
		if err := av.SaveAttributeView(database); err != nil {
			t.Fatal(err)
		}
		data, err := av.ReadAttributeViewData(database.ID)
		if err != nil {
			t.Fatal(err)
		}
		before[database.ID] = data
	}
	payload["includeNewItemPreview"] = true
	for _, carrier := range []string{fixture.databaseID, ""} {
		payload["blockID"] = carrier
		recorder, response = callRelationDetailCandidatesContract(t, payload, model.RoleAdministrator)
		if response.Code != 0 || response.Data == nil || response.Data.Total != 1 || len(response.Data.Rows) != 1 ||
			response.Data.Rows[0].ID != fixture.rowIDs[1] || len(response.Data.SelectedRows) != 1 || response.Data.SelectedRows[0].ID != fixture.rowIDs[0] {
			t.Fatalf("scoped candidates were expanded or limited to existing membership: %s", recorder.Body.String())
		}
		if preview := response.Data.NewItemPreview; preview == nil || preview.Error != "" ||
			preview.TemplateID != fixture.target.DefaultTemplateID || preview.PrimaryKey != "Scoped target task" || !preview.HasPrimaryKeyTemplate {
			t.Fatalf("scoped candidate preview used the wrong target configuration: %+v", preview)
		}
	}
	rendered, detail := callRelationDetailContract(t, fixture.payload(), model.RoleAdministrator)
	requireRelationDetailRows(t, rendered, detail, fixture.rowIDs[0])
	for id, expected := range before {
		actual, err := av.ReadAttributeViewData(id)
		if err != nil || !bytes.Equal(expected, actual) {
			t.Fatalf("candidate/preview read changed database %s: %v", id, err)
		}
	}
}

func TestAPIContractRelationDetailCandidatesRejectInvalidScope(t *testing.T) {
	fixture := setupRelationDetailAPITest(t)
	if recorder, _ := callRelationDetailCandidatesContract(t, fixture.candidatesPayload(), model.RoleReader); recorder.Code != http.StatusForbidden {
		t.Fatalf("reader reached scoped candidates: %d %s", recorder.Code, recorder.Body.String())
	}
	for _, test := range []struct {
		name   string
		modify func(map[string]any)
	}{
		{"fake carrier", func(payload map[string]any) { payload["blockID"] = ast.NewNodeID() }},
		{"unrelated real carrier", func(payload map[string]any) { payload["blockID"] = fixture.paragraphID }},
		{"mismatched request source", func(payload map[string]any) { payload["avID"] = fixture.target.ID }},
		{"mismatched request key", func(payload map[string]any) { payload["keyID"] = fixture.textKeyID }},
		{"mismatched context source", func(payload map[string]any) {
			context := fixture.context
			context.SourceAvID = fixture.target.ID
			payload["relationContext"] = context
		}},
		{"mismatched context key", func(payload map[string]any) {
			context := fixture.context
			context.RelationKeyID = fixture.textKeyID
			payload["relationContext"] = context
		}},
		{"missing source entry", func(payload map[string]any) {
			context := fixture.context
			context.SourceItemID = ast.NewNodeID()
			payload["relationContext"] = context
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload := fixture.candidatesPayload()
			payload["includeNewItemPreview"] = true
			test.modify(payload)
			recorder, response := callRelationDetailCandidatesContract(t, payload, model.RoleAdministrator)
			if response.Code != -1 || response.Data != nil {
				t.Fatalf("invalid relation scope exposed candidates or preview: %s", recorder.Body.String())
			}
		})
	}
	key, _ := fixture.attrView.GetKey(fixture.relationKeyID)
	key.Relation.AvID = ast.NewNodeID()
	if err := av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	recorder, response := callRelationDetailCandidatesContract(t, fixture.candidatesPayload(), model.RoleAdministrator)
	if response.Code != -1 || response.Data != nil {
		t.Fatalf("missing target returned scoped candidates: %s", recorder.Body.String())
	}
}

func TestAPIContractRelationDetailRenderMembership(t *testing.T) {
	fixture := setupRelationDetailAPITest(t)
	sourceBefore, err := av.ReadAttributeViewData(fixture.attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	targetBefore, err := av.ReadAttributeViewData(fixture.target.ID)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		recorder, response := callRelationDetailContract(t, fixture.payload(), model.RoleAdministrator)
		requireRelationDetailRows(t, recorder, response, fixture.rowIDs[0])
		if response.Data.ID != fixture.target.ID || response.Data.ViewID != fixture.target.Views[0].ID || response.Data.ContextFilter != nil {
			t.Fatalf("source carrier was treated as target context-filter metadata: %s", recorder.Body.String())
		}
	}
	for id, before := range map[string][]byte{fixture.attrView.ID: sourceBefore, fixture.target.ID: targetBefore} {
		after, err := av.ReadAttributeViewData(id)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatalf("relation detail render changed database %s: %v", id, err)
		}
	}

	relation, _ := fixture.attrView.GetKeyValues(fixture.relationKeyID)
	relation.Values[0].Relation.BlockIDs = []string{}
	if err = av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	recorder, response := callRelationDetailContract(t, fixture.payload(), model.RoleAdministrator)
	requireRelationDetailRows(t, recorder, response)

	relation.Values[0].Relation.BlockIDs = []string{fixture.rowIDs[0]}
	item := fixture.attrView.GetBlockValue(fixture.context.SourceItemID)
	item.IsDetached, item.Block.ID = false, fixture.paragraphID
	if err = av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	payload := fixture.payload()
	payload["blockID"] = fixture.paragraphID
	recorder, response = callRelationDetailContract(t, payload, model.RoleAdministrator)
	requireRelationDetailRows(t, recorder, response, fixture.rowIDs[0])
}

func TestAPIContractRelationDetailRejectsInvalidScope(t *testing.T) {
	fixture := setupRelationDetailAPITest(t)
	targetCarrierID := ast.NewNodeID()
	tree, err := model.LoadTreeByBlockID(fixture.databaseID)
	if err != nil {
		t.Fatal(err)
	}
	targetCarrier := &ast.Node{ID: targetCarrierID, Type: ast.NodeAttributeView, AttributeViewID: fixture.target.ID,
		AttributeViewType: string(av.LayoutTypeTable)}
	targetCarrier.SetIALAttr("id", targetCarrierID)
	tree.Root.AppendChild(targetCarrier)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	for _, test := range []struct {
		name   string
		role   model.Role
		modify func(map[string]any)
	}{
		{"publish reader", model.RoleReader, func(map[string]any) {}},
		{"fake carrier", model.RoleAdministrator, func(payload map[string]any) { payload["blockID"] = ast.NewNodeID() }},
		{"unrelated real paragraph", model.RoleAdministrator, func(payload map[string]any) { payload["blockID"] = fixture.paragraphID }},
		{"target database carrier", model.RoleAdministrator, func(payload map[string]any) { payload["blockID"] = targetCarrierID }},
		{"mismatched target", model.RoleAdministrator, func(payload map[string]any) { payload["id"] = fixture.attrView.ID }},
		{"missing runtime view", model.RoleAdministrator, func(payload map[string]any) { payload["viewID"] = ast.NewNodeID() }},
		{"missing source entry", model.RoleAdministrator, func(payload map[string]any) {
			context := fixture.context
			context.SourceItemID = ast.NewNodeID()
			payload["relationContext"] = context
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload := fixture.payload()
			test.modify(payload)
			requireRelationDetailRejected(t, payload, test.role)
		})
	}
	key, _ := fixture.attrView.GetKey(fixture.relationKeyID)
	key.Relation.DetailView.ViewID = ast.NewNodeID()
	if err = av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	response := requireRelationDetailRejected(t, fixture.payload(), model.RoleAdministrator)
	if response.Data == nil || response.Data.Error != "viewNotFound" {
		t.Fatalf("deleted configured view omitted its repairable error: %+v", response)
	}
}

func TestAPIContractRelationDetailLockedSourceLease(t *testing.T) {
	fixture := setupRelationDetailAPITest(t)
	boxID := ast.NewNodeID()
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(confPath), 0700); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(confPath, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	if !model.IsEncryptedBox(boxID) || model.IsBoxUnlocked(boxID) {
		t.Fatal("fixture must be a locked encrypted notebook")
	}
	av.SetAVBoxID(fixture.attrView.ID, boxID)
	payload := fixture.payload()
	delete(payload, "blockID")
	response := requireRelationDetailRejected(t, payload, model.RoleAdministrator)
	if response.Msg != model.Conf.Language(314) {
		t.Fatalf("handler did not reject the locked source lease before rendering: %+v", response)
	}
	candidatesPayload := fixture.candidatesPayload()
	delete(candidatesPayload, "blockID")
	recorder, candidates := callRelationDetailCandidatesContract(t, candidatesPayload, model.RoleAdministrator)
	if candidates.Code != -1 || candidates.Data != nil || candidates.Msg != "encrypted notebook is locked, please unlock it first" {
		t.Fatalf("candidate handler did not hold the carrierless encrypted source lease: %s", recorder.Body.String())
	}
}

func TestAPIContractRelationDetailEncryptedBoundary(t *testing.T) {
	probe, err := dbsql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	var cipherVersion string
	err = probe.QueryRow("PRAGMA cipher_version").Scan(&cipherVersion)
	_ = probe.Close()
	if err != nil || cipherVersion == "" {
		t.Skip("actual encrypted notebook fixture requires sqlcipher or libsqlcipher")
	}
	const helper = "SIYUAN_TEST_RELATION_DETAIL_ENCRYPTED"
	if os.Getenv(helper) != "1" {
		// 密钥生命周期及异步索引在独立进程中初始化，避免污染其他 API 用例。
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractRelationDetailEncryptedBoundary$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		output, err := command.CombinedOutput()
		t.Logf("encrypted relation detail subprocess:\n%s", output)
		if err != nil {
			t.Fatalf("encrypted relation detail subprocess failed: %v", err)
		}
		return
	}
	fixture := setupRelationDetailAPITest(t)
	previousTimeLang, hadTimeLang := util.TimeLangs["en"]
	util.TimeLangs["en"] = map[string]any{}
	for _, key := range []string{"albl", "blbl", "now", "1s", "xs", "1m", "xm", "1h", "xh", "1d", "xd", "1w", "xw", "1M", "xM", "1y", "2y", "xy", "max"} {
		util.TimeLangs["en"][key] = "time"
	}
	t.Cleanup(func() {
		if hadTimeLang {
			util.TimeLangs["en"] = previousTimeLang
		} else {
			delete(util.TimeLangs, "en")
		}
	})
	root := t.TempDir()
	util.WorkspaceDir, util.TempDir, util.ConfDir, util.HistoryDir = root, filepath.Join(root, "temp"), filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath, util.AssetContentDBPath = filepath.Join(util.TempDir, util.DBName), filepath.Join(util.TempDir, "history.db"), filepath.Join(util.TempDir, "asset_content.db")
	for _, dir := range []string{util.TempDir, util.ConfDir, util.HistoryDir} {
		if err = os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.Search.Store(conf.NewSearch())
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	if err = sql.InitAssetContentDatabase(true); err != nil {
		t.Fatal(err)
	}
	defer sql.CloseDatabase()
	if err = model.EnableEncryptedNotebook("relation-detail-password"); err != nil {
		t.Fatal(err)
	}
	boxes := []string{}
	for range 2 {
		boxID, err := model.CreateEncryptedBox("Relation detail", "relation-detail-password")
		if err != nil {
			t.Fatal(err)
		}
		boxes = append(boxes, boxID)
		defer model.LockBox(boxID)
	}
	clone := func(source *av.AttributeView) *av.AttributeView {
		t.Helper()
		data, err := json.Marshal(source)
		if err != nil {
			t.Fatal(err)
		}
		copy := &av.AttributeView{}
		if err = json.Unmarshal(data, copy); err != nil {
			t.Fatal(err)
		}
		return copy
	}
	source, target := clone(fixture.attrView), clone(fixture.target)
	source.ID = ast.NewNodeID()
	target.GetBlockKeyValues().Values[0].Block.Content = "same-box private target"
	target.NewItemTemplates = []*av.NewItemTemplate{{ID: ast.NewNodeID(), Name: "Private default",
		TargetType: av.NewItemTargetDetached, PrimaryKeyTemplate: "Private scoped task"}}
	target.DefaultTemplateID = target.NewItemTemplates[0].ID
	sourceKey, _ := source.GetKey(fixture.relationKeyID)
	sourceKey.Relation.CandidateFilters[0].Value.Block.Content = "same-box private"
	for _, database := range []*av.AttributeView{source, target} {
		av.SetAVBoxID(database.ID, boxes[0])
		if err = av.SaveAttributeView(database); err != nil {
			t.Fatal(err)
		}
		defer av.SetAVBoxID(database.ID, "")
	}
	carrierID, documentID := ast.NewNodeID(), ast.NewNodeID()
	tree := treenode.NewTree(boxes[0], "/"+documentID+".sy", "/Private relation", "Private relation")
	carrier := &ast.Node{ID: carrierID, Type: ast.NodeAttributeView, AttributeViewID: source.ID, AttributeViewType: string(av.LayoutTypeTable)}
	carrier.SetIALAttr("id", carrierID)
	tree.Root.AppendChild(carrier)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	context := fixture.context
	context.SourceAvID = source.ID
	payload := fixture.payload()
	payload["blockID"], payload["relationContext"] = carrierID, context
	recorder, response := callRelationDetailContract(t, payload, model.RoleAdministrator)
	requireRelationDetailRows(t, recorder, response, fixture.rowIDs[0])
	if !bytes.Contains(recorder.Body.Bytes(), []byte("same-box private target")) {
		t.Fatalf("encrypted target fell back to the same-ID ordinary database: %s", recorder.Body.String())
	}
	assertLockedMetadata := assertEncryptedRelationMetadata(t, fixture, source, target, context, carrierID, boxes[0])
	assertLockedCells := assertEncryptedRelationCell(t, fixture, source, target, context, carrierID, boxes[0], boxes[1])
	// 无载体时仍由来源上下文取得租约，目标的全局映射不能改变候选或预览边界。
	av.SetAVBoxID(target.ID, "")
	candidatesPayload := fixture.candidatesPayload()
	candidatesPayload["avID"], candidatesPayload["relationContext"] = source.ID, context
	candidatesPayload["includeNewItemPreview"] = true
	delete(candidatesPayload, "blockID")
	candidateRecorder, candidates := callRelationDetailCandidatesContract(t, candidatesPayload, model.RoleAdministrator)
	if candidates.Code != 0 || candidates.Data == nil || candidates.Data.Total != 1 || len(candidates.Data.Rows) != 1 ||
		candidates.Data.Rows[0].ID != fixture.rowIDs[0] || !bytes.Contains(candidateRecorder.Body.Bytes(), []byte("same-box private target")) {
		t.Fatalf("carrierless encrypted candidates escaped the source boundary: %s", candidateRecorder.Body.String())
	}
	if preview := candidates.Data.NewItemPreview; preview == nil || preview.Error != "" ||
		preview.TemplateID != target.DefaultTemplateID || preview.PrimaryKey != "Private scoped task" || !preview.HasPrimaryKeyTemplate {
		t.Fatalf("carrierless encrypted preview used the ordinary same-ID target: %+v", preview)
	}
	candidatesPayload["blockID"] = fixture.databaseID
	candidateRecorder, candidates = callRelationDetailCandidatesContract(t, candidatesPayload, model.RoleAdministrator)
	if candidates.Code != -1 || candidates.Data != nil {
		t.Fatalf("ordinary source carrier exposed encrypted candidates: %s", candidateRecorder.Body.String())
	}
	delete(candidatesPayload, "blockID")
	if candidateRecorder, _ = callRelationDetailCandidatesContract(t, candidatesPayload, model.RoleReader); candidateRecorder.Code != http.StatusForbidden {
		t.Fatalf("reader exposed encrypted candidates: %s", candidateRecorder.Body.String())
	}
	payload["blockID"] = fixture.databaseID
	requireRelationDetailRejected(t, payload, model.RoleAdministrator)
	payload["blockID"] = carrierID
	requireRelationDetailRejected(t, payload, model.RoleReader)
	foreign := clone(target)
	foreign.ID = ast.NewNodeID()
	foreign.GetBlockKeyValues().Values[0].Block.Content = "other-box private target"
	av.SetAVBoxID(foreign.ID, boxes[1])
	defer av.SetAVBoxID(foreign.ID, "")
	if err = av.SaveAttributeView(foreign); err != nil {
		t.Fatal(err)
	}
	key, _ := source.GetKey(fixture.relationKeyID)
	key.Relation.AvID = foreign.ID
	if err = av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	payload["id"] = foreign.ID
	requireRelationDetailRejected(t, payload, model.RoleAdministrator)
	candidateRecorder, candidates = callRelationDetailCandidatesContract(t, candidatesPayload, model.RoleAdministrator)
	if candidates.Code != -1 || candidates.Data != nil {
		t.Fatalf("scoped candidates read a target in another encrypted notebook: %s", candidateRecorder.Body.String())
	}
	key.Relation.AvID = target.ID
	if err = av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	payload["id"] = target.ID
	model.LockBox(boxes[0])
	assertLockedMetadata()
	assertLockedCells()
	response = requireRelationDetailRejected(t, payload, model.RoleAdministrator)
	if response.Msg != model.Conf.Language(314) {
		t.Fatalf("locked encrypted render bypassed handler admission: %+v", response)
	}
	candidateRecorder, candidates = callRelationDetailCandidatesContract(t, candidatesPayload, model.RoleAdministrator)
	if candidates.Code != -1 || candidates.Data != nil || candidates.Msg != "encrypted notebook is locked, please unlock it first" {
		t.Fatalf("carrierless scoped candidates bypassed the locked source lease: %s", candidateRecorder.Body.String())
	}
}

func TestAPIContractRelationDetailMutationAdmission(t *testing.T) {
	const helper = "SIYUAN_TEST_RELATION_DETAIL_MUTATION_ADMISSION"
	if os.Getenv(helper) != "1" {
		// 启动标志是进程级状态，仅在子进程中启用事务 HTTP 入口。
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractRelationDetailMutationAdmission$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		output, err := command.CombinedOutput()
		t.Logf("relation detail mutation admission subprocess:\n%s", output)
		if err != nil {
			t.Fatalf("relation detail mutation admission subprocess failed: %v", err)
		}
		return
	}
	fixture := setupRelationDetailAPITest(t)
	util.SetBooted()
	oldReadonly := util.ReadOnly
	t.Cleanup(func() { util.ReadOnly = oldReadonly })
	paths := map[string][]byte{}
	for _, id := range []string{fixture.attrView.ID, fixture.target.ID} {
		path := av.GetAttributeViewDataPath(id)
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		paths[path] = data
	}
	operation := func(action string) map[string]any {
		if action == "updateAttrViewRelationItems" {
			return map[string]any{"action": action, "avID": fixture.attrView.ID, "blockID": fixture.databaseID,
				"rowID": fixture.context.SourceItemID, "keyID": fixture.relationKeyID,
				"data": map[string]any{"addItemIDs": []string{fixture.rowIDs[1]}, "removeItemIDs": []string{fixture.rowIDs[0]}}}
		}
		return map[string]any{"action": action, "avID": fixture.target.ID, "blockID": fixture.databaseID,
			"rowID": fixture.rowIDs[0], "keyID": fixture.target.GetBlockKey().ID, "relationContext": fixture.context,
			"data": map[string]any{"block": map[string]any{"content": "unauthorized edit"}}}
	}
	post := func(op map[string]any, role model.Role, readonly bool) *httptest.ResponseRecorder {
		t.Helper()
		util.ReadOnly = readonly
		engine := gin.New()
		engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		registerTransactionsRoutes(engine)
		payload := map[string]any{"transactions": []map[string]any{{"doOperations": []map[string]any{op}}},
			"reqId": 21172, "app": "relation-detail-contract", "session": "relation-detail-contract"}
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/transactions", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		// 管理员权限中间件的空 403 响应不属于事务处理函数的 JSON 契约。
		if recorder.Code == http.StatusForbidden {
			if len(recorder.Body.Bytes()) != 0 {
				t.Fatalf("administrator guard returned unexpected data: %s", recorder.Body.String())
			}
		} else {
			requireAPIContract(t, http.MethodPost, "/api/transactions", recorder)
		}
		for path, before := range paths {
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("rejected mutation changed source data: %s %v", path, err)
			}
		}
		return recorder
	}
	for _, action := range []string{"updateAttrViewRelationItems", "updateAttrViewCell"} {
		t.Run(action, func(t *testing.T) {
			if response := post(operation(action), model.RoleReader, false); response.Code != http.StatusForbidden {
				t.Fatalf("reader reached relation mutation handler: %d %s", response.Code, response.Body.String())
			}
			response := post(operation(action), model.RoleAdministrator, true)
			var denied struct {
				Code int `json:"code"`
				Data struct {
					CloseTimeout int `json:"closeTimeout"`
				} `json:"data"`
			}
			decodeAttributeViewContextFilterAPIResponse(t, response, &denied)
			if denied.Code != -1 || denied.Data.CloseTimeout != 5000 {
				t.Fatalf("readonly kernel reached relation mutation handler: %s", response.Body.String())
			}
			op := operation(action)
			op["blockID"] = ast.NewNodeID()
			response = post(op, model.RoleAdministrator, false)
			var invalid struct {
				Code int `json:"code"`
			}
			decodeAttributeViewContextFilterAPIResponse(t, response, &invalid)
			if invalid.Code != -1 {
				t.Fatalf("fake source carrier reached mutation queue: %s", response.Body.String())
			}
		})
	}
	boxID := ast.NewNodeID()
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	path := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if !model.IsEncryptedBox(boxID) || model.IsBoxUnlocked(boxID) {
		t.Fatal("mutation lease fixture must be locked")
	}
	av.SetAVBoxID(fixture.attrView.ID, boxID)
	for _, action := range []string{"updateAttrViewRelationItems", "updateAttrViewCell"} {
		op := operation(action)
		delete(op, "blockID")
		response := post(op, model.RoleAdministrator, false)
		var denied struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		decodeAttributeViewContextFilterAPIResponse(t, response, &denied)
		if denied.Code != -1 || denied.Msg != model.Conf.Language(314) {
			t.Fatalf("blank-carrier %s missed the encrypted source lease: %s", action, response.Body.String())
		}
	}
}
