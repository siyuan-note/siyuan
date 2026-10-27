// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func documentAddressingFailure(err error) (apicontract.DocumentAddressingFailure, bool) {
	var addressingErr *model.DocumentAddressingError
	if errors.As(err, &addressingErr) {
		return apicontract.DocumentAddressingFailure{Reason: addressingErr.Reason}, true
	}
	return apicontract.DocumentAddressingFailure{}, false
}

func documentPathContract(document *treenode.DocumentPath) apicontract.DocumentPath {
	segments := make([]apicontract.DocumentPathSegment, 0, len(document.Segments))
	for _, segment := range document.Segments {
		segments = append(segments, apicontract.DocumentPathSegment{ID: segment.ID, Text: segment.Text, Empty: segment.Empty})
	}
	return apicontract.DocumentPath{
		Notebook: document.Notebook, ID: document.ID, ParentID: document.ParentID, Path: document.Path,
		Title:    apicontract.DocumentTitle{Format: document.Title.Format, Text: document.Title.Text, Empty: document.Title.Empty},
		Segments: segments, Depth: document.Depth, DisplayPath: document.DisplayPath,
		Revision: document.Revision,
	}
}

func documentTargetContract(target *conf.DocumentTarget) *apicontract.StructuredDocumentTarget {
	if target == nil {
		return nil
	}
	return &apicontract.StructuredDocumentTarget{Version: target.Version, Notebook: target.Notebook,
		Anchor: apicontract.DocumentTargetAnchor{Kind: target.Anchor.Kind, ID: target.Anchor.ID},
		Up:     target.Up, Parents: target.Parents, Title: target.Title, OnMissingParent: target.OnMissingParent}
}

func documentTargetModel(target *apicontract.StructuredDocumentTarget) *conf.DocumentTarget {
	if target == nil {
		return nil
	}
	return &conf.DocumentTarget{Version: target.Version, Notebook: target.Notebook,
		Anchor: conf.DocumentTargetAnchor{Kind: target.Anchor.Kind, ID: target.Anchor.ID},
		Up:     target.Up, Parents: target.Parents, Title: target.Title, OnMissingParent: target.OnMissingParent}
}

var getDocPaths = contractHandler(apicontract.GetDocPaths, func(c *gin.Context, request apicontract.GetDocPathsRequest) apicontract.Response[apicontract.DocumentPathsResult] {
	if err := holdEncryptedBoxRequest(c, request.Notebook); err != nil {
		return apicontract.Failure[apicontract.DocumentPathsResult](-1, err.Error())
	}
	documents, missing, err := model.GetDocPaths(request.Notebook, request.IDs)
	if err != nil {
		if failure, ok := documentAddressingFailure(err); ok {
			return apicontract.GetDocPaths.FailureWithData(-1, err.Error(), apicontract.NewDocumentPathsFailure(failure))
		}
		return apicontract.Failure[apicontract.DocumentPathsResult](-1, err.Error())
	}
	data := apicontract.DocumentPathsData{Documents: []apicontract.DocumentPath{}, MissingIDs: missing}
	for _, document := range documents {
		data.Documents = append(data.Documents, documentPathContract(document))
	}
	return apicontract.Success(apicontract.NewDocumentPathsResult(data))
})

var resolveDocPath = contractHandler(apicontract.ResolveDocPath, func(c *gin.Context, request apicontract.ResolveDocPathRequest) apicontract.Response[apicontract.ResolveDocPathResult] {
	if err := holdEncryptedBoxRequest(c, request.Notebook); err != nil {
		return apicontract.Failure[apicontract.ResolveDocPathResult](-1, err.Error())
	}
	resolved, err := model.ResolveDocPath(request.Notebook, request.Start.Kind, request.Start.ID, request.Segments)
	if err != nil {
		if failure, ok := documentAddressingFailure(err); ok {
			return apicontract.ResolveDocPath.FailureWithData(-1, err.Error(), apicontract.NewResolveDocPathFailure(failure))
		}
		return apicontract.Failure[apicontract.ResolveDocPathResult](-1, err.Error())
	}
	data := apicontract.ResolvedDocumentPathData{Status: resolved.Status, NextIndex: resolved.NextIndex,
		Start:               apicontract.DocumentLocation{Notebook: resolved.Start.Notebook, ID: resolved.Start.ID, Revision: resolved.Start.Revision},
		CandidatesTruncated: resolved.CandidatesTruncated, Candidates: []apicontract.DocumentPath{},
		NameConditions: []apicontract.DocumentNameCondition{}}
	if resolved.Resolved != nil {
		document := documentPathContract(resolved.Resolved)
		data.Resolved = &document
	}
	for _, candidate := range resolved.Candidates {
		data.Candidates = append(data.Candidates, documentPathContract(candidate))
	}
	for _, condition := range resolved.NameConditions {
		data.NameConditions = append(data.NameConditions, apicontract.DocumentNameCondition{
			ParentID: condition.ParentID, Title: condition.Title, ExpectedID: condition.ExpectedID})
	}
	return apicontract.Success(apicontract.NewResolveDocPathResult(data))
})

var createDocByParent = contractHandler(apicontract.CreateDocByParent, func(c *gin.Context, request apicontract.CreateDocByParentRequest) apicontract.Response[apicontract.CreateDocByParentResult] {
	if err := holdEncryptedBoxRequest(c, request.Notebook); err != nil {
		return apicontract.Failure[apicontract.CreateDocByParentResult](-1, err.Error())
	}
	input := model.DocumentCreateRequest{Notebook: request.Notebook, ParentID: request.ParentID, ID: request.ID,
		TitleFormat: request.Title.Format, Title: request.Title.Text, Markdown: request.Markdown,
		ExpectedParentRevision: request.ExpectedParentRevision, Tags: request.Tags, WithMath: request.WithMath,
		ClippingHref: request.ClippingHref, Sorts: request.Sorts, SortTargetID: request.SortTargetID,
		SortPosition: request.SortPosition, DocCreateTemplatePath: request.DocCreateTemplatePath, ListDocTree: request.ListDocTree}
	if expected := request.ExpectedTarget; expected != nil {
		if err := holdEncryptedBoxRequest(c, expected.Notebook); err != nil {
			return apicontract.Failure[apicontract.CreateDocByParentResult](-1, err.Error())
		}
		input.ExpectedTarget = &model.DocumentTargetRevision{Notebook: expected.Notebook, Purpose: expected.Purpose, Revision: expected.Revision}
	}
	for _, condition := range request.NameConditions {
		input.NameConditions = append(input.NameConditions, treenode.DocumentNameCondition{
			ParentID: condition.ParentID, Title: condition.Title, ExpectedID: condition.ExpectedID})
	}
	document, err := model.CreateDocByParent(input)
	if err != nil {
		var failure *model.DocumentCreateFailure
		if errors.As(err, &failure) {
			return apicontract.CreateDocByParent.FailureWithData(-1, err.Error(), apicontract.NewCreateDocByParentFailure(
				apicontract.DocumentCreateFailure{Reason: failure.Reason, CommitState: failure.CommitState,
					ID: failure.ID, Stage: failure.Stage, Completed: failure.Completed}))
		}
		return apicontract.Failure[apicontract.CreateDocByParentResult](-1, err.Error())
	}
	return apicontract.Success(apicontract.NewCreateDocByParentResult(apicontract.CreatedDocumentData{
		ID: document.ID, Document: documentPathContract(document)}))
})

var getDocCreateTarget = contractHandler(apicontract.GetDocCreateTarget, func(c *gin.Context, request apicontract.GetDocCreateTargetRequest) apicontract.Response[apicontract.DocumentCreateTargetData] {
	if err := holdEncryptedBoxRequest(c, request.Notebook); err != nil {
		return apicontract.Failure[apicontract.DocumentCreateTargetData](-1, err.Error())
	}
	value, err := model.GetDocCreateTarget(request.Notebook, request.Purpose)
	if err != nil {
		return apicontract.Failure[apicontract.DocumentCreateTargetData](-1, err.Error())
	}
	target := apicontract.LegacyCreateTarget(value.Notebook, value.Path)
	if structured := value.Structured; structured != nil {
		target = apicontract.StructuredCreateTarget(*documentTargetContract(structured))
	}
	return apicontract.Success(apicontract.DocumentCreateTargetData{
		Target: target, DocCreateTemplatePath: value.DocCreateTemplatePath, Revision: value.Revision})
})

var planDocCreate = contractHandler(apicontract.PlanDocCreate, func(c *gin.Context, request apicontract.PlanDocCreateRequest) apicontract.Response[apicontract.DocumentCreatePlan] {
	if err := holdEncryptedBoxRequest(c, request.Notebook); err != nil {
		return apicontract.Failure[apicontract.DocumentCreatePlan](-1, err.Error())
	}
	target, err := model.GetDocCreateTarget(request.Notebook, request.Purpose)
	if err != nil {
		return apicontract.Failure[apicontract.DocumentCreatePlan](-1, err.Error())
	}
	if err = holdEncryptedBoxRequest(c, target.Notebook); err != nil {
		return apicontract.Failure[apicontract.DocumentCreatePlan](-1, err.Error())
	}
	input := model.DocumentPlanRequest{Notebook: request.Notebook, Purpose: request.Purpose, ContextID: request.ContextID,
		Title: request.Title, ID: request.ID, Placement: request.Placement, Reuse: request.Reuse}
	if request.Date != nil {
		input.Now, err = time.ParseInLocation("2006-01-02", *request.Date, time.Local)
		if err != nil {
			return apicontract.Failure[apicontract.DocumentCreatePlan](-1, err.Error())
		}
	}
	plan, err := model.PlanDocumentCreation(input)
	if err != nil {
		return apicontract.Failure[apicontract.DocumentCreatePlan](-1, err.Error())
	}
	// 配置可能在读取期间改变，响应实际目标仍须持有租约。
	if err = holdEncryptedBoxRequest(c, plan.Notebook); err != nil {
		return apicontract.Failure[apicontract.DocumentCreatePlan](-1, err.Error())
	}
	result := apicontract.DocumentCreatePlan{Notebook: plan.Notebook, Title: plan.Title, ExistingID: plan.ExistingID,
		Steps: []apicontract.CreateDocByParentRequest{}}
	for _, step := range plan.Steps {
		value := apicontract.CreateDocByParentRequest{Notebook: step.Notebook, ParentID: step.ParentID, ID: step.ID,
			Title: apicontract.DocumentCreateTitle{Format: step.TitleFormat, Text: step.Title}, Markdown: step.Markdown,
			ExpectedParentRevision: step.ExpectedParentRevision, DocCreateTemplatePath: step.DocCreateTemplatePath}
		if expected := step.ExpectedTarget; expected != nil {
			value.ExpectedTarget = &apicontract.DocumentTargetRevision{Notebook: expected.Notebook, Purpose: expected.Purpose, Revision: expected.Revision}
		}
		for _, condition := range step.NameConditions {
			value.NameConditions = append(value.NameConditions, apicontract.DocumentNameCondition{
				ParentID: condition.ParentID, Title: condition.Title, ExpectedID: condition.ExpectedID})
		}
		result.Steps = append(result.Steps, value)
	}
	return apicontract.Success(result)
})
