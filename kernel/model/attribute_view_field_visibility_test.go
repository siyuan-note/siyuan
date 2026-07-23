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

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestSetAttributeViewFieldsHidden(t *testing.T) {
	const keyID = "20260723120000-field"

	table := &av.View{
		ID:         "20260723120001-table",
		LayoutType: av.LayoutTypeTable,
		Table: &av.LayoutTable{Columns: []*av.ViewTableColumn{{
			BaseField: &av.BaseField{ID: keyID},
		}}},
	}

	gallery := &av.View{
		ID:         "20260723120002-gallery",
		LayoutType: av.LayoutTypeGallery,
		Gallery: &av.LayoutGallery{CardFields: []*av.ViewGalleryCardField{{
			BaseField: &av.BaseField{ID: keyID},
		}}},
	}

	kanban := &av.View{
		ID:         "20260723120003-kanban",
		LayoutType: av.LayoutTypeKanban,
		Kanban: &av.LayoutKanban{Fields: []*av.ViewKanbanField{{
			BaseField: &av.BaseField{ID: keyID},
		}}},
	}

	attrView := &av.AttributeView{Views: []*av.View{table, gallery, kanban}}
	if err := setAttributeViewFieldsHidden(attrView, keyID, []string{table.ID, kanban.ID, table.ID}, true); nil != err {
		t.Fatalf("set fields hidden failed: %s", err)
	}
	if !table.Table.Columns[0].Hidden {
		t.Fatal("table field should be hidden")
	}
	if gallery.Gallery.CardFields[0].Hidden {
		t.Fatal("gallery field should remain visible")
	}
	if !kanban.Kanban.Fields[0].Hidden {
		t.Fatal("kanban field should be hidden")
	}

	if err := setAttributeViewFieldsHidden(attrView, keyID, []string{table.ID, "20260723120004-missing"}, false); nil == err {
		t.Fatal("missing view should return an error")
	}
	if !table.Table.Columns[0].Hidden {
		t.Fatal("validation failure should not partially update fields")
	}

	if err := setAttributeViewFieldsHidden(attrView, "20260723120005-missing", []string{table.ID}, false); nil == err {
		t.Fatal("missing field should return an error")
	}
}
