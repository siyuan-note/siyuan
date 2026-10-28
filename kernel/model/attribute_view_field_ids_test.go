// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

// attributeViewFieldIDs 是切换布局和新建视图时唯一的字段顺序来源。
// 这两种操作都改为「先取一次字段顺序，再按目标布局重新包装」，
// 因此五种布局必须给出同一顺序，否则切换后字段会错位。
func TestAttributeViewFieldIDsAgreesAcrossLayouts(t *testing.T) {
	want := []string{"a", "b", "c"}

	table := &av.LayoutTable{BaseLayout: &av.BaseLayout{}}
	for _, id := range want {
		table.Columns = append(table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: id}})
	}
	gallery := &av.LayoutGallery{BaseLayout: &av.BaseLayout{}}
	for _, id := range want {
		gallery.CardFields = append(gallery.CardFields, &av.ViewGalleryCardField{BaseField: &av.BaseField{ID: id}})
	}
	kanban := &av.LayoutKanban{BaseLayout: &av.BaseLayout{}}
	for _, id := range want {
		kanban.Fields = append(kanban.Fields, &av.ViewKanbanField{BaseField: &av.BaseField{ID: id}})
	}

	for _, test := range []struct {
		name string
		view *av.View
	}{
		{"table", &av.View{LayoutType: av.LayoutTypeTable, Table: table}},
		{"list", &av.View{LayoutType: av.LayoutTypeList, List: table}},
		{"calendar", &av.View{LayoutType: av.LayoutTypeCalendar, Calendar: &av.LayoutCalendar{LayoutTable: table}}},
		{"gallery", &av.View{LayoutType: av.LayoutTypeGallery, Gallery: gallery}},
		{"kanban", &av.View{LayoutType: av.LayoutTypeKanban, Kanban: kanban}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := attributeViewFieldIDs(test.view); !reflect.DeepEqual(got, want) {
				t.Fatalf("字段顺序 = %v，期望 %v", got, want)
			}
		})
	}

	// 布局数据缺失时返回 nil，调用方据此得到空字段列表而不是崩溃。
	if got := attributeViewFieldIDs(&av.View{LayoutType: av.LayoutTypeGallery}); 0 != len(got) {
		t.Fatalf("缺少布局数据时应返回空列表，实际 %v", got)
	}
}
