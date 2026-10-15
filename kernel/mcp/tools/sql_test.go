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

import (
	"strings"
	"testing"
)

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

	if got := formatSQLRows(rows, false); got != want {
		t.Fatalf("unexpected SQL rows:\n%s\nwant:\n%s", got, want)
	}
}

func TestFormatSQLRowsReportsPossibleTruncation(t *testing.T) {
	rows := make([]map[string]any, sqlQueryDefaultLimit)
	for i := range rows {
		rows[i] = map[string]any{"id": i}
	}

	got := formatSQLRows(rows, true)
	wantPrefix := "Query results (100 rows; the 100-row limit may have truncated the result. " +
		"Use an explicit LIMIT with OFFSET to paginate):\n\n"
	if !strings.HasPrefix(got, wantPrefix) {
		t.Fatalf("missing SQL result truncation warning:\n%s", got)
	}
}

func TestSQLSchemaActionAndEmptyStructuredResult(t *testing.T) {
	validator, err := CompileToolValidator(SQLTool)
	if err != nil {
		t.Fatal(err)
	}
	if err = validator.ValidateInput(map[string]any{"action": "schema"}); err != nil {
		t.Fatalf("schema must not require stmt: %v", err)
	}
	result, err := sqlHandler(map[string]any{"action": "schema"})
	if err != nil || result.IsError || len(result.Content) != 1 {
		t.Fatalf("schema result: %+v, %v", result, err)
	}
	for _, text := range []string{"spans", "parent_id", "textmark code", "WITH RECURSIVE", "SELECT b.*", "LIMIT/OFFSET"} {
		if !strings.Contains(result.Content[0].Text, text) {
			t.Fatalf("schema missing %q", text)
		}
	}
	empty := sqlQueryResult(nil, false, "")
	output := empty.StructuredContent.(map[string]any)
	if empty.Content[0].Text != "no results" || output["rows"] == nil || output["rowCount"] != 0 {
		t.Fatalf("empty SQL result: %+v", empty)
	}
}

func TestSQLResultPreservesRawValuesAndEscapesTable(t *testing.T) {
	rows := []map[string]any{{"text": "a|b\nc", "total": int64(4)}}
	result := sqlQueryResult(rows, false, "")
	output := result.StructuredContent.(map[string]any)
	if output["rows"].([]map[string]any)[0]["text"] != "a|b\nc" ||
		!strings.Contains(result.Content[0].Text, "a\\|b<br>c") {
		t.Fatalf("SQL values were corrupted: %+v", result)
	}
}
