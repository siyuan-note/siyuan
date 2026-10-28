// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type DocumentPlanRequest struct {
	Notebook                 string
	Purpose                  string
	ContextID                *string
	Title                    *string
	ID                       string
	Placement                string
	Reuse                    bool
	Now                      time.Time
	SkipContentTemplateCheck bool
	// Target 供有独立保存配置的内核业务使用，不接受 HTTP 输入。
	Target *EffectiveDocumentTarget
}

type DocumentCreatePlan struct {
	Notebook    string
	Title       string
	ExistingID  string
	DisplayPath string
	Steps       []DocumentCreateRequest
}

type renderedDocumentTarget struct {
	parentID *string
	parents  []string
	title    string
	missing  string
}

func documentParentLocation(boxID string, id *string) (*string, error) {
	if id == nil || IsBoxDoc(boxID, *id) {
		return nil, nil
	}
	document, err := getDocumentPath(boxID, *id)
	if err != nil {
		return nil, documentAddressingError("parentUnavailable", err)
	}
	return document.ParentID, nil
}

// renderDocumentTarget 只对旧模板拆分渲染结果；版本 2 的每一段在同一时间快照独立求值。
func renderDocumentTarget(target *EffectiveDocumentTarget, request DocumentPlanRequest) (ret renderedDocumentTarget, err error) {
	ret.missing = "create"
	if request.Now.IsZero() {
		request.Now = time.Now()
	}
	render := func(text string) (string, error) {
		if target.Rendered {
			return text, nil
		}
		return RenderGoTemplateAtInBox(text, request.Now, target.Notebook)
	}
	if target.Structured != nil {
		value := target.Structured
		if err = value.Validate(); err != nil {
			return
		}
		ret.missing = value.OnMissingParent
		if request.Placement == "child" {
			ret.parentID = request.ContextID
			if request.Title != nil {
				ret.title = *request.Title
			} else {
				ret.title, err = render(value.Title)
			}
			return
		}
		switch value.Anchor.Kind {
		case "document":
			ret.parentID = &value.Anchor.ID
		case "context":
			if target.Notebook != request.Notebook || request.ContextID == nil {
				return ret, errors.New("document target requires context in the target notebook")
			}
			ret.parentID = request.ContextID
		}
		for i := 0; i < value.Up; i++ {
			if ret.parentID == nil || IsBoxDoc(target.Notebook, *ret.parentID) {
				return ret, errors.New("document target goes above the notebook root")
			}
			if ret.parentID, err = documentParentLocation(target.Notebook, ret.parentID); err != nil {
				return
			}
		}
		for _, segment := range value.Parents {
			var rendered string
			if rendered, err = render(segment); err != nil {
				return
			}
			ret.parents = append(ret.parents, rendered)
		}
		if request.Title != nil {
			ret.title = *request.Title
		} else {
			ret.title, err = render(value.Title)
		}
	} else {
		var rendered string
		if rendered, err = render(target.Path); err != nil {
			return
		}
		rendered = strings.TrimSpace(strings.TrimSuffix(rendered, ".sy"))
		if target.Notebook == request.Notebook && !strings.HasPrefix(rendered, "/") {
			ret.parentID = request.ContextID
		}
		parts := strings.FieldsFunc(rendered, func(char rune) bool { return char == '/' })
		if rendered != "" && !strings.HasSuffix(rendered, "/") && len(parts) > 0 {
			ret.title, parts = parts[len(parts)-1], parts[:len(parts)-1]
		}
		if request.Title != nil {
			ret.title = *request.Title
		}
		ret.title = normalizeDocumentTitle(ret.title)
		if request.Placement == "child" {
			ret.parentID, ret.parents = request.ContextID, nil
			return
		}
		for _, segment := range parts {
			switch strings.TrimSpace(segment) {
			case ".", "":
				continue
			case "..":
				if len(ret.parents) > 0 {
					ret.parents = ret.parents[:len(ret.parents)-1]
				} else if ret.parentID, err = documentParentLocation(target.Notebook, ret.parentID); err != nil {
					return
				}
			default:
				ret.parents = append(ret.parents, normalizeDocumentTitle(segment))
			}
		}
	}
	if ret.parentID != nil && IsBoxDoc(target.Notebook, *ret.parentID) {
		ret.parentID = nil
	}
	return
}

// PlanDocumentCreation 预先验证整组标题并分配全部 ID，不创建源文件或目录。
// 各类模板均逐级拒绝歧义；执行仍按单篇提交并保留已完成结果。
func PlanDocumentCreation(request DocumentPlanRequest) (*DocumentCreatePlan, error) {
	if !ast.IsNodeIDPattern(request.ID) || request.ContextID != nil && !ast.IsNodeIDPattern(*request.ContextID) ||
		request.Placement != "" && request.Placement != "configured" && request.Placement != "child" {
		return nil, errors.New("invalid document creation context")
	}
	if err := AcquireEncryptedBoxOperation(request.Notebook); err != nil {
		return nil, err
	}
	defer ReleaseEncryptedBoxOperation(request.Notebook)
	var target *EffectiveDocumentTarget
	var err error
	if request.Target != nil {
		copyTarget := *request.Target
		target = &copyTarget
	} else {
		target, err = GetDocCreateTarget(request.Notebook, request.Purpose)
		if err != nil {
			return nil, err
		}
	}
	if request.Placement == "child" {
		target.Notebook = request.Notebook
	}
	if err = AcquireEncryptedBoxOperation(target.Notebook); err != nil {
		return nil, err
	}
	defer ReleaseEncryptedBoxOperation(target.Notebook)
	if err = checkDocumentPathNotebook(target.Notebook); err != nil {
		return nil, err
	}
	rendered, err := renderDocumentTarget(target, request)
	if err != nil {
		return nil, err
	}
	if err = ValidateDocumentTitle("plain", rendered.title); err != nil {
		return nil, err
	}
	for _, title := range rendered.parents {
		if title == "" {
			return nil, errors.New("document ancestor title must not be empty")
		}
		if err = ValidateDocumentTitle("plain", title); err != nil {
			return nil, err
		}
	}
	if target.DocCreateTemplatePath != "" && !request.SkipContentTemplateCheck {
		if _, err = resolveDocContentTemplatePath(target.DocCreateTemplatePath); err != nil {
			return nil, err
		}
	}
	plan := &DocumentCreatePlan{Notebook: target.Notebook, Title: rendered.title, Steps: []DocumentCreateRequest{}}
	parentID, revision, depth := rendered.parentID, documentRootRevision(target.Notebook), 0
	displayParents := []string{}
	if parentID != nil {
		parent, readErr := getDocumentPath(target.Notebook, *parentID)
		if readErr != nil {
			return nil, documentAddressingError("parentUnavailable", readErr)
		}
		revision, depth = parent.Revision, parent.Depth
		for _, segment := range parent.Segments {
			displayParents = append(displayParents, segment.Text)
		}
	}
	plan.DisplayPath = "/" + strings.Join(append(append(displayParents, rendered.parents...), rendered.title), "/")
	conditions := []treenode.DocumentNameCondition{}
	expected := &DocumentTargetRevision{Notebook: request.Notebook, Purpose: request.Purpose, Revision: target.Revision}
	if request.Placement == "child" || target.Revision == "" {
		expected = nil
	}
	missing := false
	appendStep := func(id, title string, ancestor bool) {
		step := DocumentCreateRequest{Notebook: target.Notebook, ParentID: parentID, ID: id, TitleFormat: "plain", Title: title,
			ExpectedTarget: expected, NameConditions: append([]treenode.DocumentNameCondition{}, conditions...)}
		if !missing {
			value := revision
			step.ExpectedParentRevision = &value
		}
		if ancestor {
			step.NameConditions = append(step.NameConditions, treenode.DocumentNameCondition{ParentID: parentID, Title: title})
		} else {
			step.DocCreateTemplatePath = target.DocCreateTemplatePath
		}
		plan.Steps = append(plan.Steps, step)
	}
	for _, title := range rendered.parents {
		depth++
		if !missing {
			resolved, resolveErr := resolveDocumentPath(target.Notebook, parentID, []string{title})
			if resolveErr != nil {
				return nil, resolveErr
			}
			if resolved.Status == "ambiguous" {
				return nil, documentAddressingError("planChanged", fmt.Errorf("ambiguous document ancestor [%s]", title))
			}
			if resolved.Status == "resolved" {
				id := resolved.Resolved.ID
				conditions = append(conditions, treenode.DocumentNameCondition{ParentID: parentID, Title: title, ExpectedID: &id})
				parentID, revision = &id, resolved.Resolved.Revision
				continue
			}
		}
		if rendered.missing != "create" {
			return nil, documentAddressingError("parentUnavailable", fmt.Errorf("document ancestor [%s] does not exist", title))
		}
		id := ast.NewNodeID()
		appendStep(id, title, true)
		conditions = append(conditions, treenode.DocumentNameCondition{ParentID: parentID, Title: title, ExpectedID: &id})
		parentID, missing = &id, true
	}
	if depth+1 > 7 && !Conf.FileTree.Load().AllowCreateDeeper {
		return nil, errors.New(Conf.Language(118))
	}
	if request.Reuse && !missing && rendered.title != "" {
		resolved, resolveErr := resolveDocumentPath(target.Notebook, parentID, []string{rendered.title})
		if resolveErr != nil {
			return nil, resolveErr
		}
		if resolved.Status == "resolved" {
			plan.ExistingID = resolved.Resolved.ID
			return plan, nil
		}
		if resolved.Status == "ambiguous" {
			return nil, documentAddressingError("planChanged", errors.New("ambiguous document reuse target"))
		}
	}
	if request.ID == target.Notebook || treenode.GetBlockTree(request.ID) != nil ||
		treenode.GetBlockTreeInExactBox(request.ID, target.Notebook) != nil {
		return nil, documentAddressingError("documentIDConflict", errors.New("document ID already exists"))
	}
	appendStep(request.ID, rendered.title, false)
	plannedPaths, err := documentCreationPlanPaths(plan)
	if err != nil {
		return nil, err
	}
	for _, step := range plan.Steps {
		if _, statErr := os.Lstat(filepath.Join(util.DataDir, step.Notebook, plannedPaths[step.ID])); !os.IsNotExist(statErr) {
			if statErr != nil {
				return nil, statErr
			}
			return nil, documentAddressingError("documentIDConflict", errors.New("planned document file already exists"))
		}
	}
	return plan, nil
}

func documentCreationPlanPaths(plan *DocumentCreatePlan) (map[string]string, error) {
	paths := map[string]string{}
	for _, step := range plan.Steps {
		folder := "/"
		if step.ParentID != nil && !IsBoxDoc(step.Notebook, *step.ParentID) {
			parent := paths[*step.ParentID]
			if parent == "" {
				bt := treenode.GetBlockTreeInExactBox(*step.ParentID, step.Notebook)
				if bt == nil {
					return nil, ErrBlockNotFound
				}
				parent = bt.Path
			}
			folder = strings.TrimSuffix(parent, ".sy")
		}
		paths[step.ID] = path.Join(folder, step.ID+".sy")
	}
	return paths, nil
}

// executeDocumentCreationPlan 保留已完成文档，下一步使用实际提交后的父版本，不重放正文副作用。
func executeDocumentCreationPlan(plan *DocumentCreatePlan, creationLocked bool) (*treenode.DocumentPath, error) {
	if plan.ExistingID != "" {
		return getDocumentPath(plan.Notebook, plan.ExistingID)
	}
	var last *treenode.DocumentPath
	for _, step := range plan.Steps {
		if last != nil && step.ParentID != nil && *step.ParentID == last.ID {
			step.ExpectedParentRevision = &last.Revision
		}
		document, err := createDocByParent(step, creationLocked)
		if err != nil {
			return last, err
		}
		last = document
	}
	return last, nil
}
