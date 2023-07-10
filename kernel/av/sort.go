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

package av

import "sort"

type AttributeViewSort struct {
	Column string    `json:"column"` // 列 ID
	Order  SortOrder `json:"order"`  // 排序顺序
}

type SortOrder string

const (
	SortOrderAsc  SortOrder = "ASC"
	SortOrderDesc SortOrder = "DESC"
)

func (av *AttributeView) SortRows() {
	if 1 > len(av.Sorts) {
		return
	}

	type ColIndexSort struct {
		Index int
		Order SortOrder
	}

	var colIndexSorts []*ColIndexSort
	for _, s := range av.Sorts {
		for i, c := range av.Columns {
			if c.ID == s.Column {
				colIndexSorts = append(colIndexSorts, &ColIndexSort{Index: i, Order: s.Order})
				break
			}
		}
	}

	sort.Slice(av.Rows, func(i, j int) bool {
		for _, colIndexSort := range colIndexSorts {
			c := av.Columns[colIndexSort.Index]
			if c.Type == ColumnTypeBlock {
				continue
			}

			result := av.Rows[i].Cells[colIndexSort.Index].Value.Compare(av.Rows[j].Cells[colIndexSort.Index].Value)
			if 0 == result {
				continue
			}

			if colIndexSort.Order == SortOrderAsc {
				return 0 > result
			}
			return 0 < result
		}
		return false
	})
}
