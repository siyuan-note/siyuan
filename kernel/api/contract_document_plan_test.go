// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestAPIContractDocumentPlanAncestorChoices(t *testing.T) {
	boxID := documentPathAPIWorkspace(t)
	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed, boxConf.DocCreateSavePath = "Plans", false, `/Same/Missing/{{now | date "20060102150405"}}`
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	// 笔记本文档表示逻辑根，即使标题相同，也不能作为普通祖先候选。
	treenode.UpsertBlockTree(treenode.NewTree(boxID, "/"+boxID+".sy", "/Same", "Same"))
	var lastID string
	for i := 0; i < 130; i++ {
		lastID = fmt.Sprintf("20261023020000-%07d", i)
		tree := treenode.NewTree(boxID, "/"+lastID+".sy", "/Same", "Same")
		treenode.UpsertBlockTree(tree)
	}
	if err := treenode.SetDocumentMetadataState(boxID, "ready"); err != nil {
		t.Fatal(err)
	}
	request := apicontract.PlanDocCreateRequest{Notebook: boxID, Purpose: "document", ID: "20261023030000-created",
		Time: "2026-10-23T23:59:59+08:00"}
	call := func(request apicontract.PlanDocCreateRequest) (int, apicontract.DocumentCreatePlan) {
		t.Helper()
		response := documentPathAPIRequest(t, "/api/filetree/planDocCreate", planDocCreate, request)
		var result struct {
			Code int
			Data apicontract.DocumentCreatePlan
		}
		if err := json.Unmarshal(response, &result); err != nil {
			t.Fatal(err)
		}
		return result.Code, result.Data
	}
	code, data := call(request)
	if code != -1 || data.Ambiguity == nil || len(data.Steps) != 0 || data.Notebook != boxID || data.Ambiguity.ParentID != nil {
		t.Fatalf("ambiguity lost its typed failure: %d %+v", code, data)
	}
	ambiguity := data.Ambiguity
	if len(ambiguity.Candidates) != 128 || !ambiguity.CandidatesTruncated || ambiguity.Index != 0 || ambiguity.Title != "Same" || ambiguity.TargetRevision == "" {
		t.Fatalf("wrong candidates: %+v", ambiguity)
	}
	if _, err := time.Parse(time.RFC3339Nano, ambiguity.Time); err != nil {
		t.Fatal(err)
	}
	// 截断只限制展示数量，用户仍可通过文档树选择未展示的同级候选。
	paths, _, err := model.GetDocPaths(boxID, []string{lastID})
	if err != nil {
		t.Fatal(err)
	}
	request.Time, request.TargetRevision = ambiguity.Time, ambiguity.TargetRevision
	request.AncestorChoices = []apicontract.DocumentAncestorChoice{{Index: 0, ID: lastID, Revision: paths[0].Revision}}
	code, data = call(request)
	if code != 0 || data.Ambiguity != nil || len(data.Steps) != 2 || *data.Steps[0].ParentID != lastID ||
		data.Steps[0].Title.Text != "Missing" || data.Steps[1].ID != request.ID {
		t.Fatalf("explicit choice changed identity or remaining path: %d %+v", code, data)
	}
	if treenode.GetBlockTree(request.ID) != nil {
		t.Fatal("planning created a document")
	}
	for _, mutate := range []func(*apicontract.PlanDocCreateRequest){
		func(r *apicontract.PlanDocCreateRequest) { r.Time = "invalid" },
		func(r *apicontract.PlanDocCreateRequest) { r.AncestorChoices[0].Revision = "stale" },
		func(r *apicontract.PlanDocCreateRequest) { r.AncestorChoices[0].ID = boxID },
		func(r *apicontract.PlanDocCreateRequest) { r.AncestorChoices[0].Index = -1 },
		func(r *apicontract.PlanDocCreateRequest) { r.TargetRevision = "stale" },
		func(r *apicontract.PlanDocCreateRequest) { r.TargetRevision = "" },
	} {
		invalid := request
		invalid.AncestorChoices = append([]apicontract.DocumentAncestorChoice{}, request.AncestorChoices...)
		mutate(&invalid)
		if code, _ := call(invalid); code != -1 {
			t.Fatal("invalid continuation accepted", invalid)
		}
	}
}
