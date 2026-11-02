// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"slices"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type DailyNoteInfo struct {
	ID      string
	HPath   string
	Title   string
	Existed bool
}

func resolveDailyNotePlan(box *Box, now time.Time, findByDate bool, selections ...*DocumentSelection) (plan *DocumentCreatePlan, tree *parse.Tree, err error) {
	boxConf := box.GetConf()
	if boxConf.DailyNoteTarget == nil && (boxConf.DailyNoteSavePath == "" || boxConf.DailyNoteSavePath == "/") {
		return nil, nil, errors.New(Conf.Language(49))
	}
	FlushTxQueue()
	if treenode.DocumentMetadataState(box.ID) != "ready" {
		if err = recoverDocumentMetadata(box.ID); err != nil {
			return
		}
	}
	request := DocumentPlanRequest{Notebook: box.ID, Purpose: "dailyNote", ID: ast.NewNodeID(),
		Now: now, Reuse: true, SkipContentTemplateCheck: true}
	if len(selections) > 0 {
		selections[0].apply(&request)
	}
	plan, err = PlanDocumentCreation(request)
	if err != nil {
		var ambiguity *DocumentAncestorAmbiguity
		if findByDate && errors.As(err, &ambiguity) {
			sql.FlushQueue()
			date := now.Format("20060102")
			ids, queryErr := sql.QueryDailyNoteRootIDsInBox(ambiguity.Notebook, DailyNoteAttrPrefix+date, date)
			if queryErr != nil {
				return nil, nil, queryErr
			}
			if len(ids) > 0 {
				tree, err = LoadTreeByBlockID(ids[0])
				if err != nil {
					return nil, nil, err
				}
				if tree.Box != ambiguity.Notebook || tree.Root.IALAttr(DailyNoteAttrPrefix+date) != date {
					return nil, nil, ErrBlockNotFound
				}
				plan = &DocumentCreatePlan{Notebook: ambiguity.Notebook, ExistingID: tree.ID, Title: treenode.ReadDocumentTitle(tree.Root).Text, DisplayPath: tree.HPath}
				return plan, tree, nil
			}
		}
		return
	}
	rootID := plan.ExistingID
	fromDate := false
	date := now.Format("20060102")
	if findByDate {
		sql.FlushQueue()
		var ids []string
		ids, err = sql.QueryDailyNoteRootIDsInBox(plan.Notebook, DailyNoteAttrPrefix+date, date)
		if err != nil {
			return
		}
		if len(ids) > 0 {
			matched := slices.Contains(ids, rootID)
			if !matched {
				rootID = ids[0]
			}
			fromDate = true
		}
	}
	if rootID == "" {
		return
	}
	tree, err = LoadTreeByBlockID(rootID)
	if err != nil {
		return
	}
	if tree.Box != plan.Notebook || (fromDate && tree.Root.IALAttr(DailyNoteAttrPrefix+date) != date) {
		return nil, nil, ErrBlockNotFound
	}
	plan.ExistingID, plan.Steps = tree.ID, nil
	return
}

// GetDailyNoteInfo 仅解析命名模板并读取已有文档，不创建文档或添加日记属性。
func GetDailyNoteInfo(boxID string, date time.Time) (info *DailyNoteInfo, err error) {
	box := Conf.Box(boxID)
	if box == nil {
		return nil, ErrBoxNotFound
	}
	plan, tree, err := resolveDailyNotePlan(box, date, true)
	if err != nil {
		var ambiguity *DocumentAncestorAmbiguity
		if errors.As(err, &ambiguity) {
			return &DailyNoteInfo{HPath: ambiguity.DisplayPath, Title: ambiguity.DocumentTitle}, nil
		}
		return nil, err
	}
	info = &DailyNoteInfo{HPath: plan.DisplayPath, Title: plan.Title}
	if tree != nil {
		info.ID, info.HPath, info.Title, info.Existed = tree.Root.ID, tree.HPath, treenode.ReadDocumentTitle(tree.Root).Text, true
	}
	return
}
