package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAVRelationItemContract(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	av.BatchUpsertBlockRel([]*ast.Node{{ID: fixture.databaseID, Type: ast.NodeAttributeView, AttributeViewID: fixture.attrView.ID}})
	const candidatesPath = "/api/av/getAttributeViewRelationCandidates"
	for _, include := range []bool{false, true} {
		response := callAttributeViewContextFilterAPI(t, candidatesPath, map[string]any{
			"avID": fixture.attrView.ID, "blockID": fixture.databaseID, "keyID": fixture.relationKeyID,
			"keyword": "Task A", "includeNewItemPreview": include,
		}, getAttributeViewRelationCandidates)
		requireAPIContract(t, http.MethodPost, candidatesPath, response)
		var result struct {
			Code int                                  `json:"code"`
			Data apicontract.AVRelationCandidatesData `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != 0 {
			t.Fatalf("candidate preview: %s %v", response.Body.String(), err)
		}
		if include {
			if p := result.Data.NewItemPreview; p == nil || p.Error != "" || p.PrimaryKey != "Task A" || p.TemplateID != "" {
				t.Fatalf("unexpected blank-template preview: %+v", p)
			}
		} else if result.Data.NewItemPreview != nil {
			t.Fatal("legacy candidate query unexpectedly returned a preview")
		}
	}
	fixture.attrView.NewItemTemplates = []*av.NewItemTemplate{{ID: ast.NewNodeID(), Name: "Default",
		TargetType: av.NewItemTargetDetached, PrimaryKeyTemplate: "Task from template"}}
	fixture.attrView.DefaultTemplateID = fixture.attrView.NewItemTemplates[0].ID
	if err := av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	response := callAttributeViewContextFilterAPI(t, candidatesPath, map[string]any{
		"avID": fixture.attrView.ID, "blockID": fixture.databaseID, "keyID": fixture.relationKeyID,
		"keyword": "Task A", "includeNewItemPreview": true,
	}, getAttributeViewRelationCandidates)
	requireAPIContract(t, http.MethodPost, candidatesPath, response)
	var result struct {
		Data apicontract.AVRelationCandidatesData `json:"data"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if p := result.Data.NewItemPreview; p == nil || p.PrimaryKey != "Task from template" || p.Error != "" {
		t.Fatalf("template did not take precedence: %+v", p)
	}
	const createPath = "/api/av/createAttributeViewRelationItem"
	before, _ := json.Marshal(fixture.attrView)
	response = callAttributeViewContextFilterAPI(t, createPath, map[string]any{
		"avID": fixture.attrView.ID, "blockID": fixture.databaseID, "keyID": fixture.relationKeyID,
		"keyword": "Task A", "preview": result.Data.NewItemPreview,
		"cells": []map[string]any{{"itemID": "missing", "relatedItemIDs": []string{}}},
	}, createAttributeViewRelationItem)
	requireAPIContract(t, http.MethodPost, createPath, response)
	var failure struct {
		Code int `json:"code"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &failure)
	if failure.Code != -1 {
		t.Fatalf("invalid creation accepted: %s", response.Body.String())
	}
	stored, err := av.ParseAttributeView(fixture.attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(stored)
	if string(before) != string(after) {
		t.Fatal("failed creation changed the database")
	}
}
