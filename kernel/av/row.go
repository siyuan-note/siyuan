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

import "github.com/88250/lute/ast"

type Row struct {
	ID    string  `json:"id"`
	Cells []*Cell `json:"cells"`
}

func NewRow() *Row {
	return &Row{ID: ast.NewNodeID()}
}

func (row *Row) GetBlockCell() *Cell {
	for _, cell := range row.Cells {
		if ColumnTypeBlock == cell.ValueType {
			return cell
		}
	}
	return nil
}
