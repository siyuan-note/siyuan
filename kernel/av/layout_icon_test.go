// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"encoding/json"
	"testing"
)

func TestLayoutIconLegacyAndIndependentSettings(t *testing.T) {
	for _, raw := range []string{`{"showIcon":true}`, `{"showIcon":false}`} {
		var base BaseLayout
		if err := json.Unmarshal([]byte(raw), &base); err != nil {
			t.Fatal(err)
		}
		legacy := base.ShowIcon
		if base.EffectiveShowRelationIcon() != legacy {
			t.Fatal("legacy relation icons changed")
		}
		base.SetShowIcon(!legacy)
		if base.EffectiveShowRelationIcon() != legacy {
			t.Fatal("primary toggle changed relation icons")
		}
		base.ShowRelationIcon = new(!legacy)
		encoded, err := json.Marshal(base)
		if err != nil {
			t.Fatal(err)
		}
		var restored BaseLayout
		if err = json.Unmarshal(encoded, &restored); err != nil {
			t.Fatal(err)
		}
		if restored.ShowRelationIcon == nil || restored.EffectiveShowRelationIcon() != !legacy {
			t.Fatal("explicit setting did not round-trip")
		}
	}
}

func TestLayoutIconRenderedInstances(t *testing.T) {
	for _, kind := range []LayoutType{LayoutTypeTable, LayoutTypeList, LayoutTypeCalendar, LayoutTypeGallery, LayoutTypeKanban} {
		for _, primary := range []bool{false, true} {
			for _, relation := range []bool{false, true} {
				base := &BaseLayout{ShowIcon: primary, ShowRelationIcon: new(relation)}
				view := &View{LayoutType: kind, Table: &LayoutTable{BaseLayout: base}, List: &LayoutList{BaseLayout: base}, Calendar: &LayoutCalendar{LayoutTable: &LayoutTable{BaseLayout: base}}, Gallery: &LayoutGallery{BaseLayout: base}, Kanban: &LayoutKanban{BaseLayout: base}}
				instance := NewViewBaseInstance(view)
				if instance.ShowIcon != primary || instance.ShowRelationIcon != relation {
					t.Fatalf("incorrect %s icons: %+v", kind, instance)
				}
			}
		}
	}
}
