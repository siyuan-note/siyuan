// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
)

func TestLegacyMapLayoutPreservesStorageAsTable(t *testing.T) {
	const rawMap = `{"spec":0,"id":"layout","showIcon":true,"columns":[{"id":"location","hidden":false,"width":"180px"}],"rowIds":["item"],"settings":{"locationKeyID":"location","height":640,"future":{"preserve":true}}}`
	const rawLocation = `{"id":"location","keyID":"location","blockID":"item","type":"location","location":{"name":"Office","latitude":0,"longitude":120,"originalInput":"120,0"}}`
	input := []byte(`{"id":"database","spec":13,"keyValues":[{"key":{"id":"location","type":"location"},"values":[` + rawLocation + `]}],"views":[{"id":"view","type":"map","map":` + rawMap + `,"itemIds":["item"],"groups":[{"id":"nested","type":"map","map":` + rawMap + `}]}]}`)
	original := bytes.Clone(input)
	database, err := ParseAttributeViewData("database", input)
	if err != nil {
		t.Fatal(err)
	}
	for _, view := range []*View{database.Views[0], database.Views[0].Groups[0]} {
		if view.LayoutType != LayoutTypeTable || view.Table == nil || len(view.Table.Columns) != 1 || view.Table.Columns[0].ID != "location" {
			t.Fatalf("legacy records did not open as a table: %+v", view)
		}
		if string(view.LegacyMap) != rawMap {
			t.Fatalf("legacy map settings changed: %s", view.LegacyMap)
		}
	}
	locationBefore := *database.KeyValues[0].Values[0].Location
	for range 2 {
		data, marshalErr := json.Marshal(database)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		database, err = ParseAttributeViewData("database", data)
		if err != nil {
			t.Fatal(err)
		}
		if string(database.Views[0].LegacyMap) != rawMap || string(database.Views[0].Groups[0].LegacyMap) != rawMap ||
			!reflect.DeepEqual(locationBefore, *database.KeyValues[0].Values[0].Location) || database.Views[0].ItemIDs[0] != "item" {
			t.Fatal("round trip lost legacy configuration, records, or coordinates")
		}
	}
	if !bytes.Equal(input, original) {
		t.Fatal("reading modified the input bytes")
	}
}

func TestLegacyMapFallbackRetainsUnsupportedSettingsAndOtherLayouts(t *testing.T) {
	for _, rawMap := range []string{`{"spec":99,"settings":{"provider":"unknown"}}`, `{"columns":[null]}`, `null`, `{}`, `[]`} {
		for _, layout := range []string{"map", "table", "list", "calendar", "gallery", "kanban"} {
			var view View
			data := []byte(`{"type":"` + layout + `","table":{"spec":0,"id":"existing-table","showIcon":true,"columns":[]},"map":` + rawMap + `}`)
			if err := json.Unmarshal(data, &view); err != nil {
				t.Fatal(err)
			}
			if view.Table.ID != "existing-table" || string(view.LegacyMap) != rawMap {
				t.Fatal("existing table or unknown map settings changed")
			}
			wantLayout := LayoutType(layout)
			if layout == "map" {
				wantLayout = LayoutTypeTable
			}
			if view.LayoutType != wantLayout {
				t.Fatalf("unrelated layout changed: %s", view.LayoutType)
			}
		}
		var view View
		if err := json.Unmarshal([]byte(`{"type":"map","map":`+rawMap+`}`), &view); err != nil || view.Table == nil || view.Table.BaseLayout == nil {
			t.Fatalf("unsupported map settings prevented a safe table fallback: %v", err)
		}
	}
}

func TestLegacyMapSearchMetadataUsesTable(t *testing.T) {
	info, err := parseAttributeViewSearchInfo([]byte(`{"spec":13,"views":[null,{"id":"legacy","name":"Places","type":"map"},{"id":"calendar","type":"calendar"}]}`))
	if err != nil || info.Views[1].LayoutType != LayoutTypeTable || info.Views[2].LayoutType != LayoutTypeCalendar {
		t.Fatalf("legacy search metadata did not use the table fallback: %+v, %v", info, err)
	}
}

func TestLegacyMapRejectsCorruptStoredTableWithoutMutatingSource(t *testing.T) {
	for _, table := range []string{`{}`, `{"spec":0,"columns":[null]}`, `{"spec":99,"columns":[]}`} {
		input := []byte(`{"spec":13,"views":[{"id":"legacy","type":"map","map":{"spec":0,"settings":{"height":640}},"table":` + table + `}]}`)
		before := bytes.Clone(input)
		if _, err := ParseAttributeViewData("database", input); err == nil {
			t.Fatalf("corrupt stored table accepted: %s", table)
		}
		if !bytes.Equal(input, before) {
			t.Fatal("rejected read changed source bytes")
		}
	}
}

func TestLegacyMapUnknownLayoutKeepsDatabaseFieldsReadable(t *testing.T) {
	input := []byte(`{"spec":13,"keyValues":[{"key":{"id":"title","type":"block"},"values":[{"keyID":"title","blockID":"item","type":"block","isDetached":true,"block":{"content":"Office"}}]},{"key":{"id":"location","type":"location"},"values":[{"keyID":"location","blockID":"item","type":"location","location":{"name":"Office","latitude":0,"longitude":120}}]}],"views":[{"type":"map","map":{"spec":99,"settings":{"future":true}},"itemIds":["item"]}]}`)
	database, err := ParseAttributeViewData("database", input)
	if err != nil {
		t.Fatal(err)
	}
	view := database.Views[0]
	if view.LayoutType != LayoutTypeTable || len(view.Table.Columns) != 2 ||
		view.Table.Columns[0].ID != "title" || view.Table.Columns[1].ID != "location" ||
		database.GetValue("location", "item").Location.Name != "Office" || len(view.LegacyMap) == 0 {
		t.Fatal("unknown retired map settings hid records or database fields")
	}
}
