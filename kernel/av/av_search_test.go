// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"fmt"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
)

func TestParseAttributeViewSearchInfo(t *testing.T) {
	data := []byte(`{
		"spec": 6,
		"name": "Schedule",
		"keyValues": [{"key": {"name": "Ignored"}}],
		"views": [
			{"id": "view-1", "name": "状态：进行", "type": "table", "table": {"columns": []}},
			{"id": "view-2", "name": "分类：项目", "type": "gallery", "gallery": {"fields": []}}
		]
	}`)

	info, err := parseAttributeViewSearchInfo(data)
	if err != nil {
		t.Fatalf("parse search info failed: %s", err)
	}
	if info.Name != "Schedule" || len(info.Views) != 2 {
		t.Fatalf("unexpected search info: %+v", info)
	}
	if info.Views[0].ID != "view-1" || info.Views[0].Name != "状态：进行" ||
		info.Views[0].LayoutType != LayoutTypeTable {
		t.Fatalf("unexpected first view: %+v", info.Views[0])
	}
	if info.Views[1].LayoutType != LayoutTypeGallery {
		t.Fatalf("unexpected second view: %+v", info.Views[1])
	}

	if _, err = parseAttributeViewSearchInfo(fmt.Appendf(nil, `{"spec": %d}`, CurrentSpec+1)); err != ErrSpecTooNew {
		t.Fatalf("expected newer spec error, got %v", err)
	}
}

func TestNewAttributeViewSearchInfo(t *testing.T) {
	view := &View{ID: "view-1", Name: "状态：进行", LayoutType: LayoutTypeTable}
	attrView := &AttributeView{
		ID:    "20260801120000-search",
		Spec:  CurrentSpec,
		Name:  "Schedule",
		Views: []*View{view, nil},
	}

	info := newAttributeViewSearchInfo(attrView)
	if info.Spec != CurrentSpec || info.Name != "Schedule" || len(info.Views) != 1 {
		t.Fatalf("unexpected search info: %+v", info)
	}
	if info.Views[0].ID != "view-1" || info.Views[0].Name != "状态：进行" ||
		info.Views[0].LayoutType != LayoutTypeTable {
		t.Fatalf("unexpected search view: %+v", info.Views[0])
	}

	view.Name = "Changed"
	if info.Views[0].Name != "状态：进行" {
		t.Fatalf("search info should not retain mutable view data: %+v", info.Views[0])
	}

	const boxID = "20260801120000-box"
	cacheAttributeViewData(attrView, boxID, []byte(`{"name":"Schedule"}`))
	cached, ok := cache.GetAVSearchDataInBox[*AttributeViewSearchInfo](attrView.ID, boxID)
	if !ok || cached.Name != "Schedule" || len(cached.Views) != 1 || cached.Views[0].Name != "Changed" {
		t.Fatalf("unexpected cached search info: %+v, %v", cached, ok)
	}
	view.Name = "Changed again"
	if cached.Views[0].Name != "Changed" {
		t.Fatalf("cached search info should remain immutable: %+v", cached.Views[0])
	}
}
