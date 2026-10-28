// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"reflect"
	"strings"
	"testing"
)

func TestAVContractRetiredMapRoutesAndLayout(t *testing.T) {
	for _, definition := range Definitions() {
		if strings.HasPrefix(definition.Path, "/api/map/") || definition.Path == "/api/av/getAttributeViewMapUnplaced" {
			t.Fatalf("retired map route is registered: %s", definition.Path)
		}
	}
	field, ok := reflect.TypeFor[AVArchiveRenderData]().FieldByName("ViewType")
	if !ok || strings.Contains(field.Tag.Get("api"), "|map") {
		t.Fatal("retired map layout remains in the render response contract")
	}
	for _, layout := range []string{"table", "list", "calendar", "gallery", "kanban"} {
		if _, err := RenderAttributeView.Decode(strings.NewReader(`{"id":"database","initialLayout":"` + layout + `"}`)); err != nil {
			t.Fatalf("supported layout %s rejected: %v", layout, err)
		}
	}
	for _, operation := range transactionActionPayloads {
		if operation.action == "setAttrViewMap" {
			t.Fatal("retired map settings still have a transaction contract")
		}
	}
}
