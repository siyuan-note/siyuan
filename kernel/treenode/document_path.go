// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import "database/sql"

type DocumentLocation struct {
	Notebook string  `json:"notebook"`
	ID       *string `json:"id"`
	Revision string  `json:"revision"`
}

type DocumentNameCondition struct {
	ParentID   *string `json:"parentID"`
	Title      string  `json:"title"`
	ExpectedID *string `json:"expectedID"`
}

type ResolvedDocumentPath struct {
	Status              string                  `json:"status"`
	Start               DocumentLocation        `json:"start"`
	Resolved            *DocumentPath           `json:"resolved"`
	NextIndex           int                     `json:"nextIndex"`
	Candidates          []*DocumentPath         `json:"candidates"`
	CandidatesTruncated bool                    `json:"candidatesTruncated"`
	NameConditions      []DocumentNameCondition `json:"nameConditions"`
}

func ResolveDocumentPath(boxID string, parentID *string, segments []string, notebookDocumentID, rootRevision string, mode int) (*ResolvedDocumentPath, error) {
	tx, err := beginTxForBox(boxID)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ret := &ResolvedDocumentPath{Status: "resolved", Start: DocumentLocation{Notebook: boxID, ID: parentID, Revision: rootRevision},
		Candidates: []*DocumentPath{}, NameConditions: []DocumentNameCondition{}}
	if parentID != nil {
		if ret.Resolved, err = documentPathInTx(tx, boxID, *parentID, notebookDocumentID, mode); err != nil {
			return nil, err
		}
		ret.Start.Revision = ret.Resolved.Revision
	}
	for i, title := range segments {
		ret.NextIndex = i
		ids, queryErr := documentChildrenByTitle(tx, boxID, parentID, title, notebookDocumentID, 129)
		if queryErr != nil {
			return nil, queryErr
		}
		switch len(ids) {
		case 0:
			ret.Status = "missing"
			ret.NameConditions = append(ret.NameConditions, DocumentNameCondition{ParentID: parentID, Title: title})
			return ret, nil
		case 1:
			childID := ids[0]
			ret.NameConditions = append(ret.NameConditions, DocumentNameCondition{ParentID: parentID, Title: title, ExpectedID: &childID})
			parentID = &childID
			if ret.Resolved, err = documentPathInTx(tx, boxID, childID, notebookDocumentID, mode); err != nil {
				return nil, err
			}
		default:
			ret.Status = "ambiguous"
			ret.CandidatesTruncated = len(ids) > 128
			for _, id := range ids[:min(len(ids), 128)] {
				candidate, readErr := documentPathInTx(tx, boxID, id, notebookDocumentID, mode)
				if readErr != nil {
					return nil, readErr
				}
				ret.Candidates = append(ret.Candidates, candidate)
			}
			return ret, nil
		}
	}
	ret.NextIndex = len(segments)
	return ret, nil
}

func documentChildrenByTitle(tx *sql.Tx, boxID string, parentID *string, title, notebookDocumentID string, limit int) ([]string, error) {
	rows, err := tx.Query(`SELECT id FROM document_metadata
		WHERE box_id=? AND parent_id IS ? AND title_text=? COLLATE BINARY AND title_empty=0 AND id<>?
		ORDER BY id LIMIT ?`, boxID, parentID, title, notebookDocumentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ret := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ret = append(ret, id)
	}
	return ret, rows.Err()
}

// CheckDocumentNameConditions 在调用方持有文档变更协调范围时复核精确匹配集合。
func CheckDocumentNameConditions(boxID, notebookDocumentID string, conditions []DocumentNameCondition) (bool, error) {
	tx, err := beginTxForBox(boxID)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	for _, condition := range conditions {
		ids, queryErr := documentChildrenByTitle(tx, boxID, condition.ParentID, condition.Title, notebookDocumentID, 2)
		if queryErr != nil {
			return false, queryErr
		}
		if condition.ExpectedID == nil {
			if len(ids) != 0 {
				return false, nil
			}
		} else if len(ids) != 1 || ids[0] != *condition.ExpectedID {
			return false, nil
		}
	}
	return true, nil
}
