// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestDeprecatedLayoutFieldsRemainReadable(t *testing.T) {
	raw, err := os.ReadFile("testdata/spec1-deprecated-layouts.json")
	if err != nil {
		t.Fatal(err)
	}
	original := bytes.Clone(raw)
	database, err := ParseAttributeViewData("20261010120001-encav00", raw)
	if err != nil {
		t.Fatal(err)
	}
	UpgradeSpec(database)
	table, gallery := database.Views[0], database.Views[1]
	if !reflect.DeepEqual(table.ItemIDs, []string{"second", "first"}) ||
		!reflect.DeepEqual(gallery.ItemIDs, []string{"first", "second"}) || table.PageSize != 25 ||
		len(table.Filters) != 1 || len(table.Filters[0].Filters) != 1 || table.Filters[0].Filters[0].Column != "title" ||
		len(table.Sorts) != 1 || table.Sorts[0].Order != SortOrderDesc {
		t.Fatal("legacy ordering, filters, sorts or page size were lost")
	}
	encoded, err := json.Marshal(database)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := ParseAttributeViewData(database.ID, encoded)
	if err != nil || !reflect.DeepEqual(table.ItemIDs, reloaded.Views[0].ItemIDs) ||
		!reflect.DeepEqual(gallery.ItemIDs, reloaded.Views[1].ItemIDs) || !bytes.Equal(raw, original) {
		t.Fatalf("legacy layout round trip changed data: %v", err)
	}
}

func TestDeprecatedLayoutEmptyFieldsAreOmitted(t *testing.T) {
	for _, layout := range []any{
		&LayoutTable{BaseLayout: &BaseLayout{}}, &LayoutGallery{BaseLayout: &BaseLayout{}},
	} {
		encoded, err := json.Marshal(layout)
		if err != nil {
			t.Fatal(err)
		}
		for _, field := range []string{"rowIds", "cardIds", "filters", "sorts", "pageSize"} {
			if bytes.Contains(encoded, []byte(`"`+field+`"`)) {
				t.Fatalf("empty deprecated field %s was written: %s", field, encoded)
			}
		}
	}
}
