// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"unicode/utf8"

	"github.com/siyuan-note/logging"
)

const fileAnnotationRefQuery = "SELECT block_id FROM file_annotation_refs WHERE annotation_id = ? " +
	"OR (annotation_id >= ? AND annotation_id < ?) OR (annotation_id >= ? AND annotation_id < ?)"

type FileAnnotationRef struct {
	ID           string
	FilePath     string
	AnnotationID string
	BlockID      string
	RootID       string
	Box          string
	Path         string
	Content      string
	Type         string
}

func QueryRefIDsByAnnotationID(annotationID string) (refIDs []string) {
	return QueryRefIDsByAnnotationIDInBox(annotationID, "")
}

func QueryRefIDsByAnnotationIDInBox(annotationID, boxID string) (refIDs []string) {
	refIDs = []string{}
	// 兼容已持久化的带查询参数或片段的标注索引，新建索引只保存纯标注 ID。
	stmt := fileAnnotationRefQuery
	args := []any{annotationID, annotationID + "?", annotationID + "@", annotationID + "#", annotationID + "$"}
	// 非 ASCII 参数保留按字节长度截取的既有查询语义，标准标注 ID 使用可索引的范围条件。
	if len(annotationID) != utf8.RuneCountInString(annotationID) {
		stmt = "SELECT block_id FROM file_annotation_refs WHERE annotation_id = ? OR substr(annotation_id, 1, ?) IN (?, ?)"
		args = []any{annotationID, len(annotationID) + 1, annotationID + "?", annotationID + "#"}
	}
	rows, err := queryForBox(boxID, stmt, args...)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	// 同一块中的多个格式片段可以引用同一标注，按首次出现顺序返回引用块。
	seen := map[string]bool{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		refIDs = append(refIDs, id)
	}
	return
}
