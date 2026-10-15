// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		refIDs = append(refIDs, id)
	}
	return
}
