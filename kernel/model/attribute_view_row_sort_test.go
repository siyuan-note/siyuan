package model

import (
	"bytes"
	"os"
	"reflect"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func newAttributeViewRowSortTestData(layout av.LayoutType) (*av.AttributeView, *av.View, []string) {
	attrView := av.NewAttributeView(ast.NewNodeID())
	view := attrView.Views[0]
	block := attrView.GetBlockKeyValues()
	number := attrView.KeyValues[1]
	number.Key.Type = av.KeyTypeNumber
	number.Key.NumberFormat = av.NumberFormatNone
	view.LayoutType = layout
	view.Gallery = av.NewLayoutGallery()
	view.Gallery.CoverFrom = av.CoverFromNone
	view.Kanban = av.NewLayoutKanban()
	view.Kanban.CoverFrom = av.CoverFromNone
	for _, key := range []string{block.Key.ID, number.Key.ID} {
		view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: &av.BaseField{ID: key}})
		view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: &av.BaseField{ID: key}})
	}
	view.Sorts = []*av.ViewSort{{Column: number.Key.ID, Order: av.SortOrderAsc}}
	var ids []string
	for i, value := range []float64{1, 1, 2, 3} {
		id := ast.NewNodeID()
		ids = append(ids, id)
		block.Values = append(block.Values, &av.Value{
			ID: ast.NewNodeID(), KeyID: block.Key.ID, BlockID: id, Type: av.KeyTypeBlock,
			IsDetached: true, CreatedAt: int64(i + 1), Block: &av.ValueBlock{Content: id},
		})
		number.Values = append(number.Values, &av.Value{
			ID: ast.NewNodeID(), KeyID: number.Key.ID, BlockID: id, Type: av.KeyTypeNumber,
			Number: &av.ValueNumber{Content: value, IsNotEmpty: true},
		})
	}
	view.ItemIDs = []string{ids[3], ids[2], ids[1], ids[0]}
	return attrView, view, ids
}

func TestAttributeViewRowSortPreviewPersistenceAndUndo(t *testing.T) {
	setupAttributeViewValidationTest(t)
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		t.Run(string(layout), func(t *testing.T) {
			attrView, view, ids := newAttributeViewRowSortTestData(layout)
			// 用单页和过滤规则验证预览仍然保存完整条目顺序。
			view.PageSize = 1
			view.Filters = []*av.ViewFilter{{Column: attrView.KeyValues[1].Key.ID, Operator: av.FilterOperatorIsEqual,
				Value: &av.Value{Type: av.KeyTypeNumber, Number: &av.ValueNumber{Content: 1, IsNotEmpty: true}}}}
			other := av.NewTableView()
			other.ItemIDs = slices.Clone(ids)
			attrView.Views = append(attrView.Views, other)
			if err := av.SaveAttributeView(attrView); nil != err {
				t.Fatal(err)
			}
			before := getAttributeViewRowOrder(view)
			request := &AttributeViewRowSortRequest{AvID: attrView.ID, ViewID: view.ID, ItemIDs: []string{ids[0]}, NextID: ids[1]}
			preview, err := PrepareAttributeViewRowSort(request)
			if nil != err || preview.Conflict {
				t.Fatalf("equal values should allow dragging: preview %+v, error %v", preview, err)
			}
			stored, err := av.ParseAttributeView(attrView.ID)
			if nil != err || !reflect.DeepEqual(before, getAttributeViewRowOrder(stored.GetView(view.ID))) {
				t.Fatalf("preview changed persisted order: %v", err)
			}
			if err = sortAttributeViewRow(preview.DoOperations[0]); nil != err {
				t.Fatal(err)
			}
			stored, err = av.ParseAttributeView(attrView.ID)
			if nil != err {
				t.Fatal(err)
			}
			got := stored.GetView(view.ID)
			if !slices.Equal(got.ItemIDs, ids) || len(got.Sorts) != 1 || !slices.Equal(stored.GetView(other.ID).ItemIDs, ids) {
				t.Fatalf("unexpected saved order: %+v", got)
			}
			if err = sortAttributeViewRow(preview.UndoOperations[0]); nil != err {
				t.Fatal(err)
			}
			stored, _ = av.ParseAttributeView(attrView.ID)
			if !reflect.DeepEqual(before, getAttributeViewRowOrder(stored.GetView(view.ID))) {
				t.Fatal("undo did not restore the original manual order and rules")
			}
			if err = sortAttributeViewRow(preview.DoOperations[0]); nil != err {
				t.Fatalf("redo failed: %v", err)
			}
			request.ItemIDs, request.NextID = []string{ids[3]}, ids[0]
			preview, err = PrepareAttributeViewRowSort(request)
			if nil != err || !preview.Conflict {
				t.Fatalf("different values should require confirmation: %+v, %v", preview, err)
			}
			if err = sortAttributeViewRow(preview.DoOperations[0]); nil != err {
				t.Fatal(err)
			}
			stored, _ = av.ParseAttributeView(attrView.ID)
			got = stored.GetView(view.ID)
			if len(got.Sorts) != 0 || !slices.Equal(got.ItemIDs, []string{ids[3], ids[0], ids[1], ids[2]}) {
				t.Fatalf("confirmation lost the complete visible order: %+v", got)
			}
			if err = sortAttributeViewRow(preview.UndoOperations[0]); nil != err {
				t.Fatal(err)
			}
			stored, _ = av.ParseAttributeView(attrView.ID)
			if len(stored.GetView(view.ID).Sorts) != 1 || !slices.Equal(stored.GetView(view.ID).ItemIDs, ids) {
				t.Fatal("undo did not restore removed sort rules")
			}
		})
	}
}

func TestAttributeViewRowSortGroupsAndStalePreview(t *testing.T) {
	setupAttributeViewValidationTest(t)
	attrView, view, ids := newAttributeViewRowSortTestData(av.LayoutTypeTable)
	view.Group = &av.ViewGroup{Field: attrView.KeyValues[1].Key.ID}
	first, second := av.NewTableView(), av.NewTableView()
	first.GroupItemIDs = []string{ids[1], ids[0], ids[2]}
	second.GroupItemIDs = []string{ids[3], ids[2]}
	second.GroupHidden = 2
	view.Groups = []*av.View{first, second}
	request := &AttributeViewRowSortRequest{AvID: attrView.ID, ViewID: view.ID, GroupID: first.ID,
		ItemIDs: []string{ids[2]}, NextID: ids[1]}
	before := getAttributeViewRowOrder(view)
	preview, err := prepareAttributeViewRowSort(attrView, view, request)
	if nil != err || !preview.Conflict {
		t.Fatalf("expected group conflict: %+v, %v", preview, err)
	}
	if err = applyAttributeViewRowOrder(attrView, view, preview.DoOperations[0].Data); nil != err {
		t.Fatal(err)
	}
	if !slices.Equal(first.GroupItemIDs, []string{ids[2], ids[1], ids[0]}) ||
		!slices.Equal(second.GroupItemIDs, []string{ids[2], ids[3]}) || len(view.Sorts) != 0 {
		t.Fatal("removing sorts did not preserve all groups, including hidden groups")
	}
	if err = applyAttributeViewRowOrder(attrView, view, preview.UndoOperations[0].Data); nil != err {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, getAttributeViewRowOrder(view)) {
		t.Fatal("group undo did not restore all original orders")
	}
	view.Sorts = []*av.ViewSort{}
	changed := getAttributeViewRowOrder(view)
	if err = applyAttributeViewRowOrder(attrView, view, preview.DoOperations[0].Data); nil == err ||
		!reflect.DeepEqual(changed, getAttributeViewRowOrder(view)) {
		t.Fatal("stale confirmation changed the view")
	}
}

func TestAttributeViewRowSortRevalidatesChangedValues(t *testing.T) {
	setupAttributeViewValidationTest(t)
	attrView, view, ids := newAttributeViewRowSortTestData(av.LayoutTypeTable)
	request := &AttributeViewRowSortRequest{AvID: attrView.ID, ViewID: view.ID, ItemIDs: []string{ids[0]}, NextID: ids[1]}
	preview, err := prepareAttributeViewRowSort(attrView, view, request)
	if nil != err || preview.Conflict {
		t.Fatalf("unexpected preview: %+v, %v", preview, err)
	}
	attrView.KeyValues[1].Values[0].Number.Content = 10
	before := getAttributeViewRowOrder(view)
	if err = applyAttributeViewRowOrder(attrView, view, preview.DoOperations[0].Data); nil == err ||
		!reflect.DeepEqual(before, getAttributeViewRowOrder(view)) {
		t.Fatal("changed sort values must reject the move without writing the order")
	}
}

func TestAttributeViewRowSortMultiSelectionAndAnchors(t *testing.T) {
	for _, test := range []struct {
		name           string
		selected       []string
		previous, next string
		want           []string
		invalid        bool
	}{
		{name: "preserve selection order", selected: []string{"d", "b"}, next: "a", want: []string{"b", "d", "a", "c", "e"}},
		{name: "page starts at c", selected: []string{"e"}, next: "c", want: []string{"a", "b", "e", "c", "d"}},
		{name: "hidden b remains", selected: []string{"e"}, previous: "a", want: []string{"a", "e", "b", "c", "d"}},
		{name: "own selection", selected: []string{"b", "c"}, next: "c", want: []string{"a", "b", "c", "d", "e"}},
		{name: "missing selection", selected: []string{"a", "missing"}, invalid: true},
		{name: "missing target", selected: []string{"a"}, next: "missing", invalid: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := moveAttributeViewSortedRows([]string{"a", "b", "c", "d", "e"}, test.selected, test.previous, test.next)
			if (nil != err) != test.invalid || (!test.invalid && !slices.Equal(got, test.want)) {
				t.Fatalf("got %v, %v; want %v", got, err, test.want)
			}
		})
	}
}

func TestAttributeViewRowSortPreviewDoesNotSaveFieldRepairs(t *testing.T) {
	setupAttributeViewValidationTest(t)
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		t.Run(string(layout), func(t *testing.T) {
			attrView, view, ids := newAttributeViewRowSortTestData(layout)
			missing := &av.BaseField{ID: ast.NewNodeID()}
			view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: missing})
			view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: missing})
			view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: missing})
			if err := av.SaveAttributeView(attrView); nil != err {
				t.Fatal(err)
			}
			path := av.GetAttributeViewDataPath(attrView.ID)
			before, err := os.ReadFile(path)
			if nil != err {
				t.Fatal(err)
			}
			_, err = PrepareAttributeViewRowSort(&AttributeViewRowSortRequest{
				AvID: attrView.ID, ViewID: view.ID, ItemIDs: []string{ids[0]}, NextID: ids[1],
			})
			if nil != err {
				t.Fatal(err)
			}
			after, err := os.ReadFile(path)
			if nil != err || !bytes.Equal(before, after) {
				t.Fatalf("read-only preview saved field repairs: %v", err)
			}
		})
	}
}
