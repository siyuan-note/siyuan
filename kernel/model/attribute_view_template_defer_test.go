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
)

func TestShouldDeferAttributeViewTemplateValues(t *testing.T) {
	tests := []struct {
		name      string
		query     string
		configure func(attrView *av.AttributeView, view *av.View)
		expected  bool
	}{
		{name: "display only", expected: true},
		{name: "query", query: "keyword", expected: false},
		{
			name: "filter",
			configure: func(_ *av.AttributeView, view *av.View) {
				view.Filters = []*av.ViewFilter{{Filters: []*av.ViewFilter{{Column: "template"}}}}
			},
			expected: false,
		},
		{
			name: "sort",
			configure: func(_ *av.AttributeView, view *av.View) {
				view.Sorts = []*av.ViewSort{{Column: "template"}}
			},
			expected: false,
		},
		{
			name: "stored filter on display template",
			configure: func(attrView *av.AttributeView, view *av.View) {
				textKey, _ := attrView.GetKey("text")
				textKey.RenderTemplate = "render"
				view.Filters = []*av.ViewFilter{{Filters: []*av.ViewFilter{{Column: "text"}}}}
			},
			expected: true,
		},
		{
			name: "rendered filter on display template",
			configure: func(attrView *av.AttributeView, view *av.View) {
				textKey, _ := attrView.GetKey("text")
				textKey.RenderTemplate = "render"
				view.Filters = []*av.ViewFilter{{Filters: []*av.ViewFilter{{
					Column: "text", ValueSource: av.ValueSourceRendered,
				}}}}
			},
			expected: false,
		},
		{
			name: "stored sort on display template",
			configure: func(attrView *av.AttributeView, view *av.View) {
				textKey, _ := attrView.GetKey("text")
				textKey.RenderTemplate = "render"
				view.Sorts = []*av.ViewSort{{Column: "text"}}
			},
			expected: true,
		},
		{
			name: "rendered sort on display template",
			configure: func(attrView *av.AttributeView, view *av.View) {
				textKey, _ := attrView.GetKey("text")
				textKey.RenderTemplate = "render"
				view.Sorts = []*av.ViewSort{{Column: "text", ValueSource: av.ValueSourceRendered}}
			},
			expected: false,
		},
		{
			name: "field calculation",
			configure: func(_ *av.AttributeView, view *av.View) {
				view.Table.Columns[2].Calc = &av.FieldCalc{Operator: av.CalcOperatorCountValues}
			},
			expected: false,
		},
		{
			name: "group calculation",
			configure: func(_ *av.AttributeView, view *av.View) {
				view.GroupCalc = &av.GroupCalc{
					Field: "template", FieldCalc: &av.FieldCalc{Operator: av.CalcOperatorCountValues},
				}
			},
			expected: false,
		},
		{
			name: "group view",
			configure: func(_ *av.AttributeView, view *av.View) {
				view.Group = &av.ViewGroup{Field: "text"}
			},
			expected: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			attrView, view := newDeferredTemplateTestAttributeView()
			if nil != test.configure {
				test.configure(attrView, view)
			}
			if actual := shouldDeferAttributeViewTemplateValues(attrView, view, test.query, false); test.expected != actual {
				t.Fatalf("expected %v, got %v", test.expected, actual)
			}
		})
	}
}

func TestRenderAttributeViewDefersDisplayOnlyTemplatesUntilAfterPagination(t *testing.T) {
	attrView, view := newDeferredTemplateTestAttributeView()
	renderContext := sql.NewAttributeViewRenderContext()
	viewable := sql.RenderViewWithDeferredTemplatesContext(attrView, view, "", false, renderContext)
	table := viewable.(*av.Table)
	templateKey, _ := attrView.GetKey("template")
	if 2 != len(table.Rows) {
		t.Fatalf("expected two rows before pagination, got %d", len(table.Rows))
	}
	for _, row := range table.Rows {
		if content := row.GetValue("template").Template.Content; templateKey.Template != content {
			t.Fatalf("template was evaluated before pagination: %q", content)
		}
	}

	if _, _, err := renderViewableInstance(table, view, attrView, 1, 1, false, "", renderContext); nil != err {
		t.Fatal(err)
	}
	sql.FillAttributeViewTemplateValuesWithContext(attrView, view, table, renderContext)
	if 1 != len(table.Rows) || "20260824000000-aaaaaaa" != table.Rows[0].ID {
		t.Fatalf("unexpected page rows: %+v", table.Rows)
	}
	if content := table.Rows[0].GetValue("template").Template.Content; "Alpha" != content {
		t.Fatalf("unexpected rendered template content: %q", content)
	}

	templateValues, _ := attrView.GetKeyValues("template")
	for _, value := range templateValues.Values {
		if "20260824000000-bbbbbbb" == value.BlockID && templateKey.Template != value.Template.Content {
			t.Fatalf("template outside the current page was evaluated: %q", value.Template.Content)
		}
	}
}

func newDeferredTemplateTestAttributeView() (attrView *av.AttributeView, view *av.View) {
	blockKey := av.NewKey("block", "Block", "", av.KeyTypeBlock)
	textKey := av.NewKey("text", "Text", "", av.KeyTypeText)
	templateKey := av.NewKey("template", "Template", "", av.KeyTypeTemplate)
	templateKey.Template = ".action{index . \"Text\"}"
	itemIDs := []string{"20260824000000-aaaaaaa", "20260824000000-bbbbbbb"}
	textContents := []string{"Alpha", "Beta"}
	blockValues := make([]*av.Value, 0, len(itemIDs))
	textValues := make([]*av.Value, 0, len(itemIDs))
	for i, itemID := range itemIDs {
		blockValues = append(blockValues, &av.Value{
			ID: itemID + "-block", KeyID: blockKey.ID, BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: true,
			Block: &av.ValueBlock{Content: textContents[i]},
		})
		textValues = append(textValues, &av.Value{
			ID: itemID + "-text", KeyID: textKey.ID, BlockID: itemID, Type: av.KeyTypeText,
			Text: &av.ValueText{Content: textContents[i]},
		})
	}

	view = &av.View{
		ID:         "view",
		LayoutType: av.LayoutTypeTable,
		PageSize:   1,
		ItemIDs:    itemIDs,
		Table:      av.NewLayoutTable(),
	}
	view.Table.Columns = []*av.ViewTableColumn{
		{BaseField: &av.BaseField{ID: blockKey.ID}},
		{BaseField: &av.BaseField{ID: textKey.ID}},
		{BaseField: &av.BaseField{ID: templateKey.ID}},
	}
	attrView = &av.AttributeView{
		ID: "av",
		KeyValues: []*av.KeyValues{
			{Key: blockKey, Values: blockValues},
			{Key: textKey, Values: textValues},
			{Key: templateKey},
		},
		Views:             []*av.View{view},
		RenderedViewables: map[string]av.Viewable{},
	}
	return
}
