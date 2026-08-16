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

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSetAttributeViewGroupClearsPersistedGroups(t *testing.T) {
	view := &av.View{
		Group:        &av.ViewGroup{Field: "field"},
		GroupCreated: 123,
		Groups:       []*av.View{{ID: "stale"}},
	}
	setAttributeViewGroup(&av.AttributeView{}, view, &av.ViewGroup{})
	if nil != view.Group || nil != view.Groups || 0 != view.GroupCreated {
		t.Fatalf("group state was not cleared: %+v", view)
	}
}

func TestSetAttributeViewGroupRegeneratesOnlyCurrentView(t *testing.T) {
	oldLang, oldAttrViewLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"table": "Table"}}
	defer func() {
		util.Lang, util.AttrViewLangs = oldLang, oldAttrViewLangs
	}()

	key := &av.Key{ID: "field", Name: "Field", Type: av.KeyTypeText}
	current := newAttributeViewGroupTestView("current", key.ID)
	other := newAttributeViewGroupTestView("other", key.ID)
	other.Group = &av.ViewGroup{Field: key.ID}
	other.Groups = []*av.View{{ID: "preserved"}}
	other.GroupCreated = 456
	attrView := &av.AttributeView{
		ID:                "av",
		KeyValues:         []*av.KeyValues{{Key: key}},
		Views:             []*av.View{current, other},
		RenderedViewables: map[string]av.Viewable{},
	}

	setAttributeViewGroup(attrView, current, &av.ViewGroup{Field: key.ID})
	if 1 != len(other.Groups) || "preserved" != other.Groups[0].ID || 456 != other.GroupCreated {
		t.Fatalf("unrelated view groups changed: %+v", other.Groups)
	}
	if 0 == len(current.Groups) {
		t.Fatal("current view groups were not generated")
	}
}

func TestSyncAttrViewGroupHiddenStatesPreservesManualHidden(t *testing.T) {
	view := &av.View{
		Group:  &av.ViewGroup{Field: "field", HideEmpty: false},
		Groups: []*av.View{{GroupHidden: 1}, {GroupHidden: 2}},
	}
	syncAttrViewGroupHiddenStates(&av.AttributeView{}, view)
	if 0 != view.Groups[0].GroupHidden || 2 != view.Groups[1].GroupHidden {
		t.Fatalf("unexpected hidden states: %d, %d", view.Groups[0].GroupHidden, view.Groups[1].GroupHidden)
	}
}

func TestSyncAttrViewGroupHiddenStatesUsesFilteredParentItems(t *testing.T) {
	view := newAttributeViewGroupTestView("view", "field")
	view.Group = &av.ViewGroup{Field: "field", HideEmpty: true}
	view.Groups = []*av.View{
		{ID: "visible", GroupHidden: 1, GroupItemIDs: []string{"a"}},
		{ID: "empty", GroupHidden: 0, GroupItemIDs: []string{"b"}},
		{ID: "manual", GroupHidden: 2, GroupItemIDs: []string{"a"}},
	}
	attrView := &av.AttributeView{
		ID: "av",
		RenderedViewables: map[string]av.Viewable{
			view.ID: &av.Table{
				BaseInstance: av.NewViewBaseInstance(view),
				Rows:         []*av.TableRow{{ID: "a"}},
			},
		},
	}

	syncAttrViewGroupHiddenStates(attrView, view)
	if 0 != view.Groups[0].GroupHidden || 1 != view.Groups[1].GroupHidden || 2 != view.Groups[2].GroupHidden {
		t.Fatalf("unexpected hidden states: %d, %d, %d", view.Groups[0].GroupHidden, view.Groups[1].GroupHidden,
			view.Groups[2].GroupHidden)
	}
}

func TestRenderReusedGroupViewPreservesFilterSortCalcAndPagination(t *testing.T) {
	key := &av.Key{ID: "field", Name: "Field", Type: av.KeyTypeText}
	view := newAttributeViewGroupTestView("view", key.ID)
	view.PageSize = 1
	view.Filters = []*av.ViewFilter{{
		Combination: av.FilterCombinationAnd,
		Filters: []*av.ViewFilter{{
			Column:   key.ID,
			Operator: av.FilterOperatorIsNotEmpty,
			Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{}},
		}},
	}}
	view.Sorts = []*av.ViewSort{{Column: key.ID, Order: av.SortOrderDesc}}
	view.Table.Columns[0].Calc = &av.FieldCalc{Operator: av.CalcOperatorCountAll}
	group := newAttributeViewGroupTestView("group", key.ID)
	group.GroupItemIDs = []string{"empty", "bravo", "charlie"}
	attrView := &av.AttributeView{
		ID:                "av",
		KeyValues:         []*av.KeyValues{{Key: key}},
		RenderedViewables: map[string]av.Viewable{},
	}
	parent := &av.Table{
		BaseInstance: av.NewViewBaseInstance(view),
		Rows: []*av.TableRow{
			newAttributeViewGroupTestRow("empty", key.ID, ""),
			newAttributeViewGroupTestRow("bravo", key.ID, "bravo"),
			newAttributeViewGroupTestRow("charlie", key.ID, "charlie"),
		},
	}
	source := sql.NewGroupViewRenderSource(parent, "")
	table := sql.RenderGroupViewWithSource(attrView, view, group, "", source, false).(*av.Table)

	if _, _, err := renderViewableInstance(table, view, attrView, 1, 1, false, ""); nil != err {
		t.Fatal(err)
	}
	if 2 != table.RowCount || 1 != len(table.Rows) || "charlie" != table.Rows[0].ID {
		t.Fatalf("unexpected rendered group rows: count %d, rows %+v", table.RowCount, table.Rows)
	}
	calc := table.Columns[0].Calc
	if nil == calc || nil == calc.Result || nil == calc.Result.Number || 2 != calc.Result.Number.Content {
		t.Fatalf("unexpected group calculation: %+v", calc)
	}
}

func newAttributeViewGroupTestView(id, keyID string) *av.View {
	return &av.View{
		ID:         id,
		LayoutType: av.LayoutTypeTable,
		Table: &av.LayoutTable{
			BaseLayout: &av.BaseLayout{},
			Columns:    []*av.ViewTableColumn{{BaseField: &av.BaseField{ID: keyID}}},
		},
	}
}

func newAttributeViewGroupTestRow(id, keyID, content string) *av.TableRow {
	value := &av.Value{
		ID:      id + "-value",
		KeyID:   keyID,
		BlockID: id,
		Type:    av.KeyTypeText,
		Text:    &av.ValueText{Content: content},
	}
	return &av.TableRow{
		ID: id,
		Cells: []*av.TableCell{{
			BaseValue: &av.BaseValue{ID: value.ID, Value: value, ValueType: value.Type},
		}},
	}
}
