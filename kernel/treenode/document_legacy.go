// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"encoding/json"
	"path"
	"strings"

	"github.com/88250/gulu"
)

// LegacyDocumentCandidates separates exact display-path matches by their real ancestry.
// Unsupported includes slash titles, empty titles and empty-title placeholders.
type LegacyDocumentCandidates struct {
	Clean       []*BlockTree
	Unsupported []*BlockTree
}

// Seed from the already selected IDs rather than rescanning notebook paths.
// json_each avoids a SQL-variable limit on large legacy result sets; UNION
// bounds corrupt cycles. Joins retain the same identity indexes as structured paths.
const legacyAncestorMetadataQuery = `WITH RECURSIVE ancestors(id) AS (
	SELECT value FROM json_each(?)
	UNION SELECT m.parent_id FROM ancestors a JOIN document_metadata m ON m.id=a.id AND m.box_id=?
	WHERE m.parent_id IS NOT NULL)
	SELECT ` + documentMetadataColumns + ` FROM ancestors a
	LEFT JOIN document_metadata m ON m.id=a.id AND m.box_id=?
	LEFT JOIN blocktrees b INDEXED BY idx_blocktrees_id ON b.box_id=m.box_id AND b.id=m.id AND b.type='d'`

// ClassifyLegacyDocumentPaths reads readiness, candidates and all ancestors in one
// database snapshot. It never reads document sources or falls back to another box.
func ClassifyLegacyDocumentPaths(boxID string, hpaths []string) (map[string]*LegacyDocumentCandidates, error) {
	tx, err := beginTxForBox(boxID)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var state string
	var pending bool
	if err = tx.QueryRow("SELECT state FROM document_metadata_state WHERE box_id=? AND version=1", boxID).Scan(&state); err != nil || state != "ready" {
		return nil, ErrDocumentMetadataUnavailable
	}
	if err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM document_metadata_pending WHERE box_id=?)", boxID).Scan(&pending); err != nil || pending {
		return nil, ErrDocumentMetadataUnavailable
	}
	ret := map[string]*LegacyDocumentCandidates{}
	var candidates []*BlockTree
	seenCandidates := map[string]bool{}
	for _, hpath := range hpaths {
		if _, exists := ret[hpath]; exists {
			continue
		}
		ret[hpath] = &LegacyDocumentCandidates{Clean: []*BlockTree{}, Unsupported: []*BlockTree{}}
		rows, queryErr := tx.Query("SELECT * FROM blocktrees WHERE box_id=? AND hpath=? AND type='d' ORDER BY id", boxID, gulu.Str.RemoveInvisible(hpath))
		if queryErr != nil {
			return nil, queryErr
		}
		for rows.Next() {
			block := &BlockTree{}
			if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); err != nil {
				rows.Close()
				return nil, err
			}
			// Keep the requested lookup key separate from the stored display path.
			if !seenCandidates[block.ID] {
				candidates = append(candidates, block)
				seenCandidates[block.ID] = true
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	if len(candidates) == 0 {
		return ret, nil
	}
	ids := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		ids = append(ids, candidate.ID)
	}
	encodedIDs, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(legacyAncestorMetadataQuery, string(encodedIDs), boxID, boxID)
	if err != nil {
		return nil, err
	}
	metadata := map[string]*DocumentMetadata{}
	for rows.Next() {
		meta, scanErr := scanDocumentMetadata(rows)
		if scanErr != nil {
			rows.Close()
			return nil, ErrDocumentMetadataUnavailable
		}
		metadata[meta.ID] = meta
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, candidate := range candidates {
		unsupported := false
		seen := map[string]bool{}
		var titles []string
		currentID, childPath := candidate.ID, ""
		for {
			meta := metadata[currentID]
			if meta == nil || seen[currentID] || childPath != "" &&
				(currentID == boxID || strings.TrimSuffix(meta.Path, ".sy") != path.Dir(childPath)) {
				return nil, ErrDocumentMetadataUnavailable
			}
			seen[currentID] = true
			if meta.Title.Text == "" || meta.Title.Empty || strings.Contains(meta.Title.Text, "/") {
				unsupported = true
			}
			titles = append(titles, meta.Title.Text)
			if meta.ParentID == nil {
				if path.Dir(meta.Path) != "/" {
					return nil, ErrDocumentMetadataUnavailable
				}
				break
			}
			currentID, childPath = *meta.ParentID, meta.Path
		}
		if !unsupported {
			for i, j := 0, len(titles)-1; i < j; i, j = i+1, j-1 {
				titles[i], titles[j] = titles[j], titles[i]
			}
			if candidate.HPath != "/"+strings.Join(titles, "/") {
				return nil, ErrDocumentMetadataUnavailable
			}
		}
		for hpath := range ret {
			if candidate.HPath != gulu.Str.RemoveInvisible(hpath) {
				continue
			}
			if unsupported {
				ret[hpath].Unsupported = append(ret[hpath].Unsupported, candidate)
			} else {
				ret[hpath].Clean = append(ret[hpath].Clean, candidate)
			}
		}
	}
	return ret, nil
}
