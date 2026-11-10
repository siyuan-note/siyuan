// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"testing"
)

func TestEditorDatabaseIconDefaults(t *testing.T) {
	for _, raw := range []string{`{}`, `{"databaseShowIcon":null,"databaseShowRelationIcon":null}`, `{"databaseShowIcon":false,"databaseShowRelationIcon":false}`} {
		var editor Editor
		if err := json.Unmarshal([]byte(raw), &editor); err != nil {
			t.Fatal(err)
		}
		want := raw != `{"databaseShowIcon":false,"databaseShowRelationIcon":false}`
		got := NormalizeEditor(&editor)
		if got.DatabaseShowIcon == nil || got.DatabaseShowRelationIcon == nil || *got.DatabaseShowIcon != want || *got.DatabaseShowRelationIcon != want {
			t.Fatalf("unexpected defaults for %s", raw)
		}
	}
	for _, editor := range []*Editor{NewEditor(), NormalizeEditor(nil)} {
		if !*editor.DatabaseShowIcon || !*editor.DatabaseShowRelationIcon {
			t.Fatal("new editor defaults must enable both icons")
		}
	}
}
