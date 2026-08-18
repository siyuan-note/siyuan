// SiYuan - From thought to insight, with agents
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

package sql

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestRenderGroupViewWithSource(t *testing.T) {
	key := &av.Key{ID: "text", Name: "Text", Type: av.KeyTypeText}
	attrView := &av.AttributeView{
		ID:                "av",
		KeyValues:         []*av.KeyValues{{Key: key}},
		RenderedViewables: map[string]av.Viewable{},
	}
	view := newGroupRenderTestView("view", nil)
	view.Table.Columns = []*av.ViewTableColumn{{
		BaseField: &av.BaseField{ID: key.ID},
		Calc:      &av.FieldCalc{Operator: av.CalcOperatorCountAll},
	}}

	rows := []*av.TableRow{
		newGroupRenderTestRow("a", key.ID),
		newGroupRenderTestRow("b", key.ID),
		newGroupRenderTestRow("c", key.ID),
	}
	parent := &av.Table{BaseInstance: av.NewViewBaseInstance(view), Rows: rows}
	source := NewGroupViewRenderSource(parent, "query")

	// 模拟父视图后续被分页，分组源仍须保留分页前的全部行。
	parent.Rows = parent.Rows[:1]
	firstGroup := newGroupRenderTestView("first", []string{"c", "b", "c", "missing"})
	first := RenderGroupViewWithSource(attrView, view, firstGroup, "query", source, false).(*av.Table)
	if 2 != len(first.Rows) || "b" != first.Rows[0].ID || "c" != first.Rows[1].ID {
		t.Fatalf("unexpected first group rows: %+v", first.Rows)
	}

	// 同一行可以进入多个分组，但同一分组内的重复 ID 只生成一行。
	secondGroup := newGroupRenderTestView("second", []string{"b", "a", "b"})
	second := RenderGroupViewWithSource(attrView, view, secondGroup, "query", source, false).(*av.Table)
	if 2 != len(second.Rows) || "a" != second.Rows[0].ID || "b" != second.Rows[1].ID {
		t.Fatalf("unexpected second group rows: %+v", second.Rows)
	}
	if first.Rows[0] != second.Rows[1] {
		t.Fatal("the same item should be reusable across groups")
	}
	if first.Columns[0].Calc == second.Columns[0].Calc || first.Columns[0].Calc == view.Table.Columns[0].Calc {
		t.Fatal("group field calculations should use independent instances")
	}
}

func TestRenderGroupViewIgnoreRowsBypassesCachedRows(t *testing.T) {
	key := &av.Key{ID: "text", Name: "Text", Type: av.KeyTypeText}
	group := newGroupRenderTestView("group", []string{"a"})
	attrView := &av.AttributeView{
		ID:        "av",
		KeyValues: []*av.KeyValues{{Key: key}},
		RenderedViewables: map[string]av.Viewable{
			group.ID: &av.Table{
				BaseInstance: av.NewViewBaseInstance(group),
				Rows:         []*av.TableRow{newGroupRenderTestRow("cached", key.ID)},
			},
		},
	}
	view := newGroupRenderTestView("view", nil)
	view.Table.Columns = []*av.ViewTableColumn{{BaseField: &av.BaseField{ID: key.ID}}}

	metadata := RenderGroupViewWithSource(attrView, view, group, "", nil, true).(*av.Table)
	if 0 != len(metadata.Rows) {
		t.Fatalf("metadata render returned rows: %+v", metadata.Rows)
	}
	if 1 != len(metadata.Columns) || key.ID != metadata.Columns[0].ID {
		t.Fatalf("metadata render lost columns: %+v", metadata.Columns)
	}
}

func TestRenderViewIgnoreRowsBypassesCachedItemsForEveryLayout(t *testing.T) {
	key := &av.Key{ID: "text", Name: "Text", Type: av.KeyTypeText}
	tableView := newGroupRenderTestView("table", nil)
	tableView.Table.Columns = []*av.ViewTableColumn{{BaseField: &av.BaseField{ID: key.ID}}}
	galleryView := &av.View{
		ID:         "gallery",
		LayoutType: av.LayoutTypeGallery,
		Gallery:    av.NewLayoutGallery(),
	}
	galleryView.Gallery.CardFields = []*av.ViewGalleryCardField{{BaseField: &av.BaseField{ID: key.ID}}}
	kanbanView := &av.View{
		ID:         "kanban",
		LayoutType: av.LayoutTypeKanban,
		Kanban:     av.NewLayoutKanban(),
	}
	kanbanView.Kanban.Fields = []*av.ViewKanbanField{{BaseField: &av.BaseField{ID: key.ID}}}

	tests := []struct {
		name     string
		view     *av.View
		cached   av.Viewable
		validate func(t *testing.T, viewable av.Viewable)
	}{
		{
			name:   "table",
			view:   tableView,
			cached: &av.Table{BaseInstance: av.NewViewBaseInstance(tableView), Rows: []*av.TableRow{{ID: "cached"}}},
			validate: func(t *testing.T, viewable av.Viewable) {
				table := viewable.(*av.Table)
				if 0 != len(table.Rows) || 1 != len(table.Columns) {
					t.Fatalf("unexpected table metadata: %+v", table)
				}
			},
		},
		{
			name:   "gallery",
			view:   galleryView,
			cached: &av.Gallery{BaseInstance: av.NewViewBaseInstance(galleryView), Cards: []*av.GalleryCard{{ID: "cached"}}},
			validate: func(t *testing.T, viewable av.Viewable) {
				gallery := viewable.(*av.Gallery)
				if 0 != len(gallery.Cards) || 1 != len(gallery.Fields) {
					t.Fatalf("unexpected gallery metadata: %+v", gallery)
				}
			},
		},
		{
			name:   "kanban",
			view:   kanbanView,
			cached: &av.Kanban{BaseInstance: av.NewViewBaseInstance(kanbanView), Cards: []*av.KanbanCard{{ID: "cached"}}},
			validate: func(t *testing.T, viewable av.Viewable) {
				kanban := viewable.(*av.Kanban)
				if 0 != len(kanban.Cards) || 1 != len(kanban.Fields) {
					t.Fatalf("unexpected kanban metadata: %+v", kanban)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			attrView := &av.AttributeView{
				ID:                "av",
				KeyValues:         []*av.KeyValues{{Key: key}},
				RenderedViewables: map[string]av.Viewable{test.view.ID: test.cached},
			}
			test.validate(t, RenderView(attrView, test.view, "", true))
		})
	}
}

func newGroupRenderTestView(id string, itemIDs []string) *av.View {
	return &av.View{
		ID:           id,
		LayoutType:   av.LayoutTypeTable,
		Table:        av.NewLayoutTable(),
		GroupItemIDs: itemIDs,
	}
}

func newGroupRenderTestRow(id, keyID string) *av.TableRow {
	value := &av.Value{
		ID:      id + "-value",
		KeyID:   keyID,
		BlockID: id,
		Type:    av.KeyTypeText,
		Text:    &av.ValueText{Content: id},
	}
	return &av.TableRow{
		ID: id,
		Cells: []*av.TableCell{{
			BaseValue: &av.BaseValue{ID: value.ID, Value: value, ValueType: value.Type},
		}},
	}
}
