// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type relationCellAPIFixture struct {
	*relationDetailAPIFixture
	third    *av.AttributeView
	keyID    string
	thirdIDs []string
}

func setupRelationCellAPITest(t *testing.T) *relationCellAPIFixture {
	t.Helper()
	f := setupRelationDetailAPITest(t)
	third := av.NewAttributeView(ast.NewNodeID())
	ids := []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}
	for i, content := range []string{"Selected outside filter", "Allowed A", "Allowed B"} {
		third.GetBlockKeyValues().Values = append(third.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(), KeyID: third.GetBlockKey().ID,
			BlockID: ids[i], Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: content}})
	}
	third.Views[0].ItemIDs = slices.Clone(ids)
	third.NewItemTemplates = []*av.NewItemTemplate{{ID: ast.NewNodeID(), Name: "U default", TargetType: av.NewItemTargetDetached,
		PrimaryKeyTemplate: "U template task"}}
	third.DefaultTemplateID = third.NewItemTemplates[0].ID
	keyID := ast.NewNodeID()
	f.target.KeyValues = append(f.target.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Name: "Member relation", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: third.ID, CandidateFilters: []*av.ViewFilter{{Column: third.GetBlockKey().ID,
			Operator: av.FilterOperatorContains, Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Allowed"}}}}}},
		Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: keyID, BlockID: f.rowIDs[0], Type: av.KeyTypeRelation,
			Relation: &av.ValueRelation{BlockIDs: []string{ids[0]}}}}})
	for _, database := range []*av.AttributeView{f.target, third} {
		if err := database.SetStorageContext(""); err != nil {
			t.Fatal(err)
		}
		if err := av.SaveAttributeView(database); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { av.SetAVBoxID(third.ID, "") })
	return &relationCellAPIFixture{relationDetailAPIFixture: f, third: third, keyID: keyID, thirdIDs: ids}
}

func (f *relationCellAPIFixture) cellContext() map[string]any {
	return map[string]any{"relationContext": f.context, "sourceItemIDs": []string{f.rowIDs[0]}}
}

func (f *relationCellAPIFixture) cellPayload() map[string]any {
	return map[string]any{"avID": f.target.ID, "keyID": f.keyID, "blockID": f.databaseID,
		"page": 1, "pageSize": 1, "selectedBlockIDs": []string{f.thirdIDs[0]}, "relationCellContext": f.cellContext(),
		"includeNewItemPreview": true, "sort": map[string]any{"column": f.third.GetBlockKey().ID, "order": "ASC"}}
}

func callRelationCellContract(t *testing.T, create bool, payload map[string]any, role model.Role) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/av/getAttributeViewRelationCandidates"
	if create {
		path = "/api/av/createAttributeViewRelationItem"
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
	if create {
		engine.POST(path, contractRouteHandlers(apicontract.CreateAttributeViewRelationItem, createAttributeViewRelationItem)...)
	} else {
		engine.POST(path, contractRouteHandlers(apicontract.GetAttributeViewRelationCandidates, getAttributeViewRelationCandidates)...)
	}
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.RemoteAddr = "198.51.100.1:12345"
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	if recorder.Code == http.StatusOK {
		requireAPIContract(t, http.MethodPost, path, recorder)
	}
	return recorder
}

func requireRelationCellAPIRejected(t *testing.T, create bool, payload map[string]any) {
	t.Helper()
	r := callRelationCellContract(t, create, payload, model.RoleAdministrator)
	var result struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, r, &result)
	if result.Code != -1 || len(result.Data) != 0 && string(result.Data) != "null" {
		t.Fatalf("invalid relation cell request exposed data: %s", r.Body.String())
	}
}

func TestAPIContractRelationCellCandidates(t *testing.T) {
	f := setupRelationCellAPITest(t)
	before := map[string][]byte{}
	for _, id := range []string{f.attrView.ID, f.target.ID, f.third.ID} {
		data, err := av.ReadAttributeViewData(id)
		if err != nil {
			t.Fatal(err)
		}
		before[id] = data
	}
	for page := 1; page <= 2; page++ {
		payload := f.cellPayload()
		payload["page"] = page
		r := callRelationCellContract(t, false, payload, model.RoleAdministrator)
		var result relationDetailCandidatesAPIResponse
		decodeAttributeViewContextFilterAPIResponse(t, r, &result)
		if result.Code != 0 || result.Data == nil || result.Data.Total != 2 || len(result.Data.Rows) != 1 ||
			result.Data.Rows[0].ID != f.thirdIDs[page] || len(result.Data.SelectedRows) != 1 || result.Data.SelectedRows[0].ID != f.thirdIDs[0] {
			t.Fatalf("cell candidate paging/filter/selection contract failed: %s", r.Body.String())
		}
		if preview := result.Data.NewItemPreview; preview == nil || preview.Error != "" || preview.PrimaryKey != "U template task" || preview.TemplateID != f.third.DefaultTemplateID {
			t.Fatalf("cell preview resolved S or T instead of U: %+v", preview)
		}
		if len(result.Data.BlockIDs) != 0 {
			t.Fatalf("carrierless U invented a root or target carrier: %s", r.Body.String())
		}
	}
	for id, expected := range before {
		actual, err := av.ReadAttributeViewData(id)
		if err != nil || !bytes.Equal(expected, actual) {
			t.Fatalf("candidate/preview mutated %s: %v", id, err)
		}
	}
}

func TestAPIContractRelationCellRejectsInvalidScopeAndCells(t *testing.T) {
	f := setupRelationCellAPITest(t)
	preview := model.PreviewAttributeViewRelationCellItem(f.target.ID, f.databaseID, f.keyID, "Input",
		&model.AttributeViewRelationCellContext{RelationContext: f.context, SourceItemIDs: []string{f.rowIDs[0]}})
	if preview.Error != "" {
		t.Fatal(preview.Error)
	}
	for _, test := range []struct {
		name   string
		modify func(map[string]any)
	}{
		{"root and cell contexts", func(p map[string]any) { p["relationContext"] = f.context }},
		{"wrong request table", func(p map[string]any) { p["avID"] = f.attrView.ID }},
		{"wrong request key", func(p map[string]any) { p["keyID"] = f.target.GetBlockKey().ID }},
		{"missing member set", func(p map[string]any) { p["relationCellContext"].(map[string]any)["sourceItemIDs"] = []string{} }},
		{"duplicate member set", func(p map[string]any) {
			p["relationCellContext"].(map[string]any)["sourceItemIDs"] = []string{f.rowIDs[0], f.rowIDs[0]}
		}},
		{"nonmember source", func(p map[string]any) {
			p["relationCellContext"].(map[string]any)["sourceItemIDs"] = []string{f.rowIDs[1]}
		}},
		{"unrelated real block", func(p map[string]any) { p["blockID"] = f.paragraphID }},
		{"missing block", func(p map[string]any) { p["blockID"] = ast.NewNodeID() }},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, create := range []bool{false, true} {
				payload := f.cellPayload()
				if create {
					payload["preview"] = map[string]any{"templateID": preview.TemplateID, "primaryKey": preview.PrimaryKey, "createdAt": preview.CreatedAt}
					payload["cells"] = []map[string]any{{"itemID": f.rowIDs[0], "relatedItemIDs": []string{}}}
				}
				test.modify(payload)
				requireRelationCellAPIRejected(t, create, payload)
			}
		})
	}
	for _, cells := range []any{
		[]map[string]any{},
		[]map[string]any{{"itemID": f.rowIDs[1], "relatedItemIDs": []string{}}},
		[]map[string]any{{"itemID": f.rowIDs[0], "relatedItemIDs": []string{}}, {"itemID": f.rowIDs[0], "relatedItemIDs": []string{}}},
		[]any{nil},
	} {
		payload := f.cellPayload()
		payload["cells"], payload["preview"] = cells, map[string]any{"templateID": preview.TemplateID, "primaryKey": preview.PrimaryKey, "createdAt": preview.CreatedAt}
		requireRelationCellAPIRejected(t, true, payload)
	}
	key, _ := f.attrView.GetKeyValues(f.relationKeyID)
	key.Values[0].Relation.BlockIDs = nil
	if err := av.SaveAttributeView(f.attrView); err != nil {
		t.Fatal(err)
	}
	payload := f.cellPayload()
	payload["cells"], payload["preview"] = []map[string]any{{"itemID": f.rowIDs[0], "relatedItemIDs": []string{}}}, map[string]any{"templateID": preview.TemplateID, "primaryKey": preview.PrimaryKey, "createdAt": preview.CreatedAt}
	requireRelationCellAPIRejected(t, false, payload)
	requireRelationCellAPIRejected(t, true, payload)
}

func TestAPIContractRelationCellAuthorizationAndLockedRoot(t *testing.T) {
	f := setupRelationCellAPITest(t)
	for _, create := range []bool{false, true} {
		for _, role := range []model.Role{model.RoleReader, model.RoleVisitor} {
			r := callRelationCellContract(t, create, f.cellPayload(), role)
			want := http.StatusForbidden
			if role == model.RoleVisitor {
				want = http.StatusUnauthorized
			}
			if r.Code != want {
				t.Fatalf("role %v reached relation cell handler: %d %s", role, r.Code, r.Body.String())
			}
		}
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
		t.Fatal("fixture must be a locked encrypted notebook")
	}
	av.SetAVBoxID(f.attrView.ID, boxID)
	payload := f.cellPayload()
	delete(payload, "blockID")
	r := callRelationCellContract(t, false, payload, model.RoleAdministrator)
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, r, &response)
	if response.Code != -1 || response.Msg != "encrypted notebook is locked, please unlock it first" {
		t.Fatalf("cell request did not acquire the root source lease: %s", r.Body.String())
	}
}

func assertEncryptedRelationCell(t *testing.T, f *relationDetailAPIFixture, source, target *av.AttributeView,
	rootContext model.AttributeViewRelationContext, rootCarrier, boxID, foreignBoxID string) func() {
	t.Helper()
	ordinary := av.NewAttributeView(ast.NewNodeID())
	ids := []string{ast.NewNodeID(), ast.NewNodeID()}
	for _, id := range ids {
		ordinary.GetBlockKeyValues().Values = append(ordinary.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(), KeyID: ordinary.GetBlockKey().ID,
			BlockID: id, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Ordinary third-table twin"}})
	}
	ordinary.Views[0].ItemIDs = slices.Clone(ids)
	if err := ordinary.SetStorageContext(""); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(ordinary); err != nil {
		t.Fatal(err)
	}
	ordinaryPath, _ := ordinary.StoragePath()
	ordinaryBefore, err := os.ReadFile(ordinaryPath)
	if err != nil {
		t.Fatal(err)
	}
	private, err := av.ParseAttributeViewWithStorageContext(ordinary.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if err = private.SetStorageContext(boxID); err != nil {
		t.Fatal(err)
	}
	private.GetBlockValue(ids[0]).Block.Content = "Private selected U"
	private.GetBlockValue(ids[1]).Block.Content = "Private allowed U"
	private.NewItemTemplates = []*av.NewItemTemplate{{ID: ast.NewNodeID(), Name: "Private U template",
		TargetType: av.NewItemTargetDetached, PrimaryKeyTemplate: "Private allowed created U"}}
	private.DefaultTemplateID = private.NewItemTemplates[0].ID
	if err = av.SaveAttributeView(private); err != nil {
		t.Fatal(err)
	}
	keyID := ast.NewNodeID()
	key := &av.Key{ID: keyID, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: private.ID,
		CandidateFilters: []*av.ViewFilter{{Column: private.GetBlockKey().ID, Operator: av.FilterOperatorContains,
			Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "allowed"}}}}}}
	values := &av.KeyValues{Key: key, Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: keyID, BlockID: f.rowIDs[0], Type: av.KeyTypeRelation,
		Relation: &av.ValueRelation{BlockIDs: []string{ids[0]}}}}}
	target.KeyValues = append(target.KeyValues, values)
	if err = av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	av.SetAVBoxID(target.ID, "")
	av.SetAVBoxID(private.ID, "")
	defer av.SetAVBoxID(private.ID, "")
	payload := map[string]any{"avID": target.ID, "keyID": keyID, "selectedBlockIDs": []string{ids[0]}, "includeNewItemPreview": true,
		"relationCellContext": map[string]any{"relationContext": rootContext, "sourceItemIDs": []string{f.rowIDs[0]}}}
	var candidates relationDetailCandidatesAPIResponse
	for _, carrier := range []string{rootCarrier, ""} {
		payload["blockID"] = carrier
		r := callRelationCellContract(t, false, payload, model.RoleAdministrator)
		decodeAttributeViewContextFilterAPIResponse(t, r, &candidates)
		if candidates.Code != 0 || candidates.Data == nil || candidates.Data.NotebookID != boxID || candidates.Data.Total != 1 ||
			len(candidates.Data.Rows) != 1 || candidates.Data.Rows[0].ID != ids[1] || len(candidates.Data.SelectedRows) != 1 ||
			candidates.Data.SelectedRows[0].ID != ids[0] || bytes.Contains(r.Body.Bytes(), []byte("Ordinary third-table twin")) {
			t.Fatalf("third hop escaped the pinned root domain: %s", r.Body.String())
		}
		if p := candidates.Data.NewItemPreview; p == nil || p.Error != "" || p.TemplateID != private.DefaultTemplateID || p.PrimaryKey != "Private allowed created U" {
			t.Fatalf("encrypted third-table preview used an ordinary twin: %+v", p)
		}
	}
	foreign := av.NewAttributeView(ast.NewNodeID())
	if err = foreign.SetStorageContext(foreignBoxID); err != nil {
		t.Fatal(err)
	}
	if err = av.SaveAttributeView(foreign); err != nil {
		t.Fatal(err)
	}
	av.SetAVBoxID(foreign.ID, foreignBoxID)
	defer av.SetAVBoxID(foreign.ID, "")
	key.Relation.AvID = foreign.ID
	if err = av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	requireRelationCellAPIRejected(t, false, payload)
	key.Relation.AvID = private.ID
	values.Values[0].Relation.BlockIDs = []string{ids[1]}
	if err = av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	payload["blockID"], payload["preview"] = rootCarrier, candidates.Data.NewItemPreview
	payload["cells"] = []map[string]any{{"itemID": f.rowIDs[0], "relatedItemIDs": []string{ids[0], ast.NewNodeID()}}}
	r := callRelationCellContract(t, true, payload, model.RoleAdministrator)
	var result struct {
		Code int                                          `json:"code"`
		Data *apicontract.AVCreateAttributeViewItemResult `json:"data"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, r, &result)
	if result.Code != 0 || result.Data == nil || result.Data.ItemID == "" || !result.Data.IsDetached || result.Data.Content != "Private allowed created U" {
		t.Fatalf("encrypted scoped cell create failed: %s", r.Body.String())
	}
	current, err := av.ParseAttributeViewWithStorageContext(target.ID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	if got := current.GetValue(keyID, f.rowIDs[0]).Relation.BlockIDs; !slices.Equal(got, []string{ids[1], result.Data.ItemID}) {
		t.Fatalf("encrypted cell create restored stale client values: %v", got)
	}
	createdTarget, err := av.ParseAttributeViewWithStorageContext(private.ID, boxID)
	if err != nil || createdTarget.GetBlockValue(result.Data.ItemID) == nil || len(createdTarget.GetBlockKeyValues().Values) != 3 {
		t.Fatalf("encrypted cell create did not create exactly one private U entry: %v", err)
	}
	ordinaryAfter, err := os.ReadFile(ordinaryPath)
	if err != nil || !bytes.Equal(ordinaryBefore, ordinaryAfter) {
		t.Fatalf("encrypted cell creation changed ordinary same-ID U: %v", err)
	}
	if source.ID != rootContext.SourceAvID {
		t.Fatal("encrypted helper used the wrong root fixture")
	}
	return func() {
		t.Helper()
		if model.IsBoxUnlocked(boxID) {
			t.Fatal("encrypted cell admission must be checked after locking the root notebook")
		}
		for _, create := range []bool{false, true} {
			payload["blockID"] = ""
			want := "encrypted notebook is locked, please unlock it first"
			if create {
				payload["blockID"] = rootCarrier
				want = "block not found or its encrypted notebook is locked"
				encoded, err := json.Marshal(payload)
				if err != nil {
					t.Fatal(err)
				}
				if _, err = apicontract.CreateAttributeViewRelationItem.Decode(bytes.NewReader(encoded)); err != nil {
					t.Fatalf("locked creation fixture must reach encrypted admission: %v", err)
				}
			}
			r := callRelationCellContract(t, create, payload, model.RoleAdministrator)
			var response struct {
				Code int             `json:"code"`
				Msg  string          `json:"msg"`
				Data json.RawMessage `json:"data"`
			}
			decodeAttributeViewContextFilterAPIResponse(t, r, &response)
			if response.Code != -1 || response.Msg != want || len(response.Data) != 0 && string(response.Data) != "null" {
				t.Fatalf("locked root exposed relation cell candidates or creation: create=%v %s", create, r.Body.String())
			}
		}
	}
}
