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

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTableColumnAlign(t *testing.T) {
	for _, align := range []TableColumnAlign{
		TableColumnAlignDefault,
		TableColumnAlignLeft,
		TableColumnAlignCenter,
		TableColumnAlignRight,
	} {
		if !align.IsValid() {
			t.Fatalf("expected valid table column align [%s]", align)
		}
	}
	if TableColumnAlign("invalid").IsValid() {
		t.Fatal("expected invalid table column align")
	}

	column := &ViewTableColumn{BaseField: &BaseField{ID: "column"}, Align: TableColumnAlignCenter}
	data, err := json.Marshal(column)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"align":"center"`) {
		t.Fatalf("expected serialized table column align, got [%s]", data)
	}

	column.Align = TableColumnAlignDefault
	data, err = json.Marshal(column)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), `"align"`) {
		t.Fatalf("expected default table column align to be omitted, got [%s]", data)
	}
}
