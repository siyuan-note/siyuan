// SiYuan - Refactor your thinking
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
	"github.com/siyuan-note/logging"
)

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
	refIDs = []string{}
	rows, err := query("SELECT block_id FROM file_annotation_refs WHERE annotation_id = ?", annotationID)
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
