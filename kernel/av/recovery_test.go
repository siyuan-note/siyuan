// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRecoveryReadOnlyAllowsMissingLayout(t *testing.T) {
	oldLang, oldLanguages := util.Lang, util.AttrViewLangs
	util.Lang, util.AttrViewLangs = "en", map[string]map[string]any{"en": {"table": "Table", "key": "Key", "select": "Select"}}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = oldLang, oldLanguages })
	for _, layout := range []LayoutType{LayoutTypeCalendar, LayoutTypeList} {
		view := NewAttributeView("20261102000000-recover")
		view.Views[0].LayoutType = layout
		data, _ := json.Marshal(view)
		var missing *MissingLayoutError
		if _, err := ParseAttributeViewData(view.ID, data); !errors.As(err, &missing) || missing.Type != layout {
			t.Fatalf("ordinary read must reject missing %s: %v", layout, err)
		}
		projection, err := ParseAttributeViewRecoveryData(view.ID, data)
		if err != nil || projection.Views[0].Calendar != nil || projection.Views[0].List != nil {
			t.Fatalf("recovery must preserve missing layout: %v", err)
		}
		if err = projection.ValidateLayouts(); !errors.As(err, &missing) {
			t.Fatalf("projection must remain invalid for normal use: %v", err)
		}
		for _, invalid := range []string{"version", "null field", "null value", "null group", "null column", "ID", "invalid calendar", "sub-items", "rich text"} {
			t.Run(string(layout)+"/"+invalid, func(t *testing.T) {
				candidate := NewAttributeView(view.ID)
				candidate.Views[0].LayoutType = layout
				switch invalid {
				case "version":
					candidate.Spec = CurrentSpec + 1
				case "null field":
					candidate.KeyValues = append(candidate.KeyValues, nil)
				case "null value":
					candidate.KeyValues[0].Values = append(candidate.KeyValues[0].Values, nil)
				case "null group":
					candidate.Views[0].Groups = []*View{nil}
				case "null column":
					candidate.Views[0].Table.Columns = append(candidate.Views[0].Table.Columns, nil)
				case "ID":
					candidate.ID = "20261102000001-another"
				case "invalid calendar":
					candidate.Views[0].Calendar = &LayoutCalendar{}
				case "sub-items":
					candidate.Views[0].SubItemsDisplay = "unknown"
				case "rich text":
					candidate.Spec = CurrentSpec
					candidate.KeyValues[0].Values = []*Value{{Type: KeyTypeText, Text: &ValueText{Rich: &ValueTextRich{Spec: 99}}}}
				}
				encoded, _ := json.Marshal(candidate)
				if _, err := ParseAttributeViewRecoveryData(view.ID, encoded); err == nil {
					t.Fatal("unrelated corruption was accepted")
				}
			})
		}
	}
}
