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

package tools

import "testing"

func TestFormatSQLRowsKeepsValuesAlignedWithColumns(t *testing.T) {
	rows := []map[string]any{
		{"id": "row-1", "label": "alpha", "quantity": 101},
		{"id": "row-2", "label": "beta", "quantity": 202},
		{"id": "row-3", "label": "gamma", "quantity": 303},
	}
	want := "Query results (3 rows):\n\n" +
		"| id | label | quantity |\n" +
		"|---|---|---|\n" +
		"| row-1 | alpha | 101 |\n" +
		"| row-2 | beta | 202 |\n" +
		"| row-3 | gamma | 303 |\n"

	if got := formatSQLRows(rows); got != want {
		t.Fatalf("unexpected SQL rows:\n%s\nwant:\n%s", got, want)
	}
}
