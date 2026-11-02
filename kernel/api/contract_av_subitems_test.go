// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAVSubItemsGroupOrderContractRoundTrip(t *testing.T) {
	for _, order := range [][]string{nil, {"child-b", "child-a"}} {
		original := &av.View{ID: "main", Groups: []*av.View{{ID: "group", GroupItemIDs: []string{"parent"}, SubItemsItemIDs: order}}}
		encoded, err := json.Marshal(toContractAVView(original))
		if err != nil {
			t.Fatal(err)
		}
		var restored av.View
		if err = json.Unmarshal(encoded, &restored); err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(restored.Groups[0].SubItemsItemIDs, order) || !slices.Equal(restored.Groups[0].GroupItemIDs, original.Groups[0].GroupItemIDs) {
			t.Fatal("full database view contract dropped or mixed group orders")
		}
	}
}

func TestAVSubItemsRenderAndCandidateContract(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	database := fixture.attrView
	database.Spec = av.SubItemsSpec
	database.SubItems = &av.SubItemsConfig{Enabled: true, ParentKeyID: ast.NewNodeID(), ChildrenKeyID: ast.NewNodeID()}
	ids := []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}
	primary := database.GetBlockKeyValues()
	for _, id := range ids {
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: id, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: id}})
	}
	database.KeyValues = append(database.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: database.SubItems.ParentKeyID, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: database.ID, IsTwoWay: true, BackKeyID: database.SubItems.ChildrenKeyID}}},
		&av.KeyValues{Key: &av.Key{ID: database.SubItems.ChildrenKeyID, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: database.ID, IsTwoWay: true, BackKeyID: database.SubItems.ParentKeyID}}})
	view := database.Views[0]
	view.SubItemsDisplay, view.ItemIDs = "nested", ids
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	path := "/api/av/renderAttributeView"
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{"id": database.ID, "nested": map[string]any{"expandedIDs": []string{ids[0]}}}, renderAttributeView)
	requireAPIContract(t, http.MethodPost, path, response)
	var result struct {
		Code int
		Data struct {
			View     *av.Table
			SubItems *av.SubItemsConfig
			Target   *model.AttributeViewRenderTarget
		}
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code == 0 && (result.Data.View.Sorts == nil || result.Data.View.Filters == nil) {
		t.Fatal("nested render returned null rules; desktop controls require arrays")
	}
	if result.Code != 0 || result.Data.SubItems == nil || len(result.Data.View.Rows) != 3 || result.Data.View.Rows[1].Hierarchy.ParentID != ids[0] {
		t.Fatalf("nested response: %s", response.Body.String())
	}
	path = "/api/av/getAttributeViewRelationCandidates"
	response = callAttributeViewContextFilterAPI(t, path, map[string]any{"avID": database.ID, "excludeItemIDs": []string{ids[0]}}, getAttributeViewRelationCandidates)
	requireAPIContract(t, http.MethodPost, path, response)
	var candidates struct {
		Code int
		Data struct {
			Rows  []*av.TableRow
			Total int
		}
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &candidates)
	if candidates.Code != 0 || candidates.Data.Total != 1 || len(candidates.Data.Rows) != 1 || candidates.Data.Rows[0].ID != ids[2] {
		t.Fatalf("descendants still selectable: %s", response.Body.String())
	}
	path = "/api/av/getAttributeViewItemStatuses"
	response = callAttributeViewContextFilterAPI(t, path, map[string]any{"id": database.ID, "nested": map[string]any{}, "itemIDs": []string{ids[1]}}, getAttributeViewItemStatuses)
	requireAPIContract(t, http.MethodPost, path, response)
	var statuses struct {
		Code int
		Data map[string]string
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &statuses)
	if statuses.Code != 0 || statuses.Data[ids[1]] != "visible" {
		t.Fatalf("collapsed item reported filtered: %s", response.Body.String())
	}
	path = "/api/av/getAttributeViewPasteRows"
	response = callAttributeViewContextFilterAPI(t, path, map[string]any{"avID": database.ID, "blockID": fixture.databaseID, "viewID": view.ID, "startItemID": ids[2], "count": 2, "itemIDs": []string{ids[2], ids[0]}}, getAttributeViewPasteRows)
	requireAPIContract(t, http.MethodPost, path, response)
	var paste struct {
		Code int
		Data struct{ View *av.Table }
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &paste)
	if paste.Code != 0 || len(paste.Data.View.Rows) != 2 || paste.Data.View.Rows[0].ID != ids[2] || paste.Data.View.Rows[1].ID != ids[0] {
		t.Fatalf("paste ignored visible item order: %s", response.Body.String())
	}
	response = callAttributeViewContextFilterAPI(t, path, map[string]any{"avID": database.ID, "blockID": fixture.databaseID, "viewID": view.ID, "startItemID": ids[2], "count": 2, "itemIDs": []string{ids[2], ids[2]}}, getAttributeViewPasteRows)
	decodeAttributeViewContextFilterAPIResponse(t, response, &paste)
	if paste.Code == 0 {
		t.Fatal("duplicate paste target accepted")
	}
	filter := func(instance av.Viewable) av.Viewable {
		table := av.TableFromViewable(instance)
		table.Rows = slices.DeleteFunc(table.Rows, func(row *av.TableRow) bool { return row.ID == ids[0] })
		return instance
	}
	for _, targetID := range []string{ids[0], ids[1]} {
		filtered := renderAttrView("", database.ID, view.ID, "", 1, 50, nil, av.LayoutTypeTable, false, false, targetID, "", filter, true, model.AttributeViewRenderOptions{Nested: &av.NestedRequest{}})
		body, err := json.Marshal(filtered)
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		recorder.Header().Set("Content-Type", "application/json")
		_, _ = recorder.Write(body)
		requireAPIContract(t, http.MethodPost, "/api/av/renderAttributeView", recorder)
		decodeAttributeViewContextFilterAPIResponse(t, recorder, &result)
		if result.Code != 0 || result.Data.View.RowCount != 2 || result.Data.View.Nested.RootCount != 2 || len(result.Data.Target.AncestorIDs) != 0 {
			t.Fatalf("scope metadata leaked: %s", body)
		}
		if targetID == ids[0] && result.Data.Target.Status != "itemNotFound" {
			t.Fatal("hidden target existence leaked")
		}
	}
}
