// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
