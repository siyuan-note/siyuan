package model

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func nestedFixture(t *testing.T, count int) (*av.AttributeView, []string) {
	t.Helper()
	setupAttributeViewValidationTest(t)
	database := av.NewAttributeView(ast.NewNodeID())
	database.Spec = av.SubItemsSpec
	database.SubItems = &av.SubItemsConfig{Enabled: true, ParentKeyID: ast.NewNodeID(), ChildrenKeyID: ast.NewNodeID()}
	primary := database.GetBlockKeyValues()
	ids := make([]string, count)
	for i := range ids {
		ids[i] = ast.NewNodeID()
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: ids[i], Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: fmt.Sprintf("Item %04d", i)}})
	}
	database.KeyValues = append(database.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: database.SubItems.ParentKeyID, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: database.ID, IsTwoWay: true, BackKeyID: database.SubItems.ChildrenKeyID}}},
		&av.KeyValues{Key: &av.Key{ID: database.SubItems.ChildrenKeyID, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: database.ID, IsTwoWay: true, BackKeyID: database.SubItems.ParentKeyID}}})
	database.Views[0].ItemIDs = slices.Clone(ids)
	database.Views[0].SubItemsDisplay = "nested"
	return database, ids
}

func nestedRender(t *testing.T, database *av.AttributeView, query string, page, size int, target *AttributeViewRenderTarget, options AttributeViewRenderOptions) *av.Table {
	t.Helper()
	if options.Nested == nil {
		options.Nested = &av.NestedRequest{}
	}
	instance, err := renderAttributeViewWithOptions(database, "", database.Views[0].ID, "", query, page, size, nil, false, false, target, "", options)
	if err != nil {
		t.Fatal(err)
	}
	return av.TableFromViewable(instance)
}

func TestNestedRenderingSearchAndScope(t *testing.T) {
	database, ids := nestedFixture(t, 4)
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[1]}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(util.DataDir, "storage", "av", database.ID+".json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	view := nestedRender(t, database, "0002", 1, 50, nil, AttributeViewRenderOptions{})
	if len(view.Rows) != 3 || view.RowCount != 1 || view.Nested.RootCount != 1 {
		t.Fatalf("search lost ancestor context: %+v", view)
	}
	for i, row := range view.Rows {
		if row.ID != ids[i] || row.Hierarchy.Depth != i || row.Hierarchy.Context != (i < 2) {
			t.Fatalf("unexpected hierarchy at %d: %+v", i, row.Hierarchy)
		}
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("nested render mutated persistent source")
	}
	target := &AttributeViewRenderTarget{ItemID: ids[2], Status: "filtered"}
	view = nestedRender(t, database, "", 1, 50, target, AttributeViewRenderOptions{ScopeFilter: func(value av.Viewable) av.Viewable {
		table := av.TableFromViewable(value)
		table.Rows = slices.DeleteFunc(table.Rows, func(row *av.TableRow) bool { return row.ID == ids[0] || row.ID == ids[1] })
		return value
	}})
	if len(view.Rows) != 2 || view.Rows[0].Hierarchy.Depth != 0 || view.Rows[0].Hierarchy.ParentID != "" || len(target.AncestorIDs) != 0 || view.Nested.MatchedCount != 2 {
		t.Fatalf("scope exposed hidden ancestry: %+v, %+v", view, target)
	}
}

func TestNestedRenderingPagesAndLocatesWideTrees(t *testing.T) {
	database, ids := nestedFixture(t, 5202)
	parents := map[string]string{}
	for _, id := range ids[1:] {
		parents[id] = ids[0]
	}
	if err := database.SetSubItemsParents(parents); err != nil {
		t.Fatal(err)
	}
	target := &AttributeViewRenderTarget{ItemID: ids[5101], Status: "filtered"}
	view := nestedRender(t, database, "", 1, 50, target, AttributeViewRenderOptions{})
	if target.Status != "visible" || target.Index < 1 || view.Rows[target.Index].ID != target.ItemID || target.Offset != 0 || len(view.Rows) > 51 {
		t.Fatalf("wide-tree locate failed: %+v (%d rows)", target, len(view.Rows))
	}
	if view.Nested.ChildPaging[ids[0]].Page != 103 {
		t.Fatalf("wrong child page: %+v", view.Nested.ChildPaging)
	}
	view = nestedRender(t, database, "", 1, 50, nil, AttributeViewRenderOptions{Nested: &av.NestedRequest{ExpandedIDs: []string{ids[0]}, ChildPaging: map[string]*av.NestedPage{ids[0]: {Page: 2, PageSize: 50}}}})
	if len(view.Rows) != 51 || view.Rows[1].ID != ids[51] || view.Nested.ChildPaging[ids[0]].Loaded != 50 {
		t.Fatal("child paging did not return one bounded page")
	}
	if nestedPageEnd(math.MaxInt, 200, 5202) != 5202 {
		t.Fatal("page arithmetic overflowed")
	}
}

func TestNestedRenderingLegacyFlatAndInvalidGraph(t *testing.T) {
	database, ids := nestedFixture(t, 3)
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	instance, err := renderAttributeView(database, "", database.Views[0].ID, "", "", 1, 50, nil, false, false, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	flat := av.TableFromViewable(instance)
	if len(flat.Rows) != 3 || flat.Nested != nil || flat.Rows[0].Hierarchy != nil {
		t.Fatal("legacy request changed shape")
	}
	nestedRender(t, database, "", 1, 1, nil, AttributeViewRenderOptions{})
	instance, err = renderAttributeView(database, "", database.Views[0].ID, "", "", 1, 50, nil, false, false, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	flat = av.TableFromViewable(instance)
	if len(flat.Rows) != 3 || flat.Nested != nil || flat.Rows[0].Hierarchy != nil {
		t.Fatal("nested page polluted later flat render cache")
	}
	database.KeyValues[len(database.KeyValues)-1].Values = nil
	_, err = renderAttributeViewWithOptions(database, "", database.Views[0].ID, "", "", 1, 50, nil, false, false, nil, "", AttributeViewRenderOptions{Nested: &av.NestedRequest{}})
	if err == nil {
		t.Fatal("invalid source graph was silently projected")
	}
}

func TestNestedProjectionOrdersSiblingsAndAncestors(t *testing.T) {
	index := &av.SubItemsIndex{Parents: map[string]string{"a": "", "b": "a", "c": "a", "d": "b", "e": ""}}
	rows := []*av.TableRow{{ID: "d"}, {ID: "c"}, {ID: "b"}, {ID: "a"}, {ID: "e"}}
	projection := projectNestedRows(index, rows, map[string]bool{"c": true, "d": true})
	if !reflect.DeepEqual(projection.roots, []string{"a"}) || !reflect.DeepEqual(projection.children["a"], []string{"c", "b"}) || projection.rootOf["d"] != "a" {
		t.Fatalf("invalid ordered projection: %+v", projection)
	}
}

func TestNestedGroupsFollowRootAndCountMatchesOnce(t *testing.T) {
	database, ids := nestedFixture(t, 3)
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	view := database.Views[0]
	key := database.KeyValues[1].Key
	key.Type = av.KeyTypeMSelect
	key.Options = []*av.SelectOption{{Name: "A"}, {Name: "B"}, {Name: "C"}}
	for i, choices := range [][]string{{"A", "B"}, {"C"}, {"C"}} {
		value := &av.Value{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: ids[i], Type: av.KeyTypeMSelect}
		for _, choice := range choices {
			value.MSelect = append(value.MSelect, &av.ValueSelect{Content: choice})
		}
		database.KeyValues[1].Values = append(database.KeyValues[1].Values, value)
	}
	view.Group = &av.ViewGroup{Field: key.ID, Method: av.GroupMethodValue}
	view.Table.Columns[0].Calc = &av.FieldCalc{Operator: av.CalcOperatorCountAll}
	result := nestedRender(t, database, "0001", 1, 50, nil, AttributeViewRenderOptions{})
	if result.RowCount != 1 || result.Nested.MatchedCount != 1 || result.Columns[0].Calc.Result.Number.Content != 1 {
		t.Fatalf("global count duplicated matches: %+v", result)
	}
	seen := map[string]bool{}
	for _, group := range result.Groups {
		table := av.TableFromViewable(group)
		if table.Name == "A" || table.Name == "B" {
			if len(table.Rows) != 2 || table.Rows[0].ID != ids[0] || table.Rows[1].ID != ids[1] || table.RowCount != 1 || table.Columns[0].Calc.Result.Number.Content != 1 {
				t.Fatalf("subtree did not follow root group: %+v", table)
			}
			seen[table.Name] = true
		} else if len(table.Rows) != 0 {
			t.Fatal("child own group leaked into nested projection")
		}
	}
	if !seen["A"] || !seen["B"] {
		t.Fatalf("multi-select groups missing: %+v", seen)
	}
}

func TestNestedHistoryUsesHistoricalHierarchy(t *testing.T) {
	database, ids := nestedFixture(t, 3)
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	oldHistory := util.HistoryDir
	util.HistoryDir = t.TempDir()
	t.Cleanup(func() { util.HistoryDir = oldHistory })
	created := time.Date(2026, 10, 28, 10, 20, 30, 0, time.Local)
	directory := filepath.Join(util.HistoryDir, created.Format("2006-01-02-150405")+"-update", "storage", "av")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(database)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, database.ID+".json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ""}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	instance, _, err := RenderHistoryAttributeViewWithOptions(database.ID, "", "", "", 1, 50, nil, strconv.FormatInt(created.Unix(), 10), AttributeViewRenderOptions{Nested: &av.NestedRequest{ExpandedIDs: []string{ids[0]}}})
	if err != nil {
		t.Fatal(err)
	}
	result := av.TableFromViewable(instance)
	if len(result.Rows) != 3 || result.Rows[1].Hierarchy.ParentID != ids[0] {
		t.Fatal("history used live hierarchy")
	}
	after, err := os.ReadFile(path)
	if err != nil || string(data) != string(after) {
		t.Fatal("history render changed archive")
	}
}

func TestNestedSnapshotUsesSnapshotHierarchyAndRootPage(t *testing.T) {
	database, ids := nestedFixture(t, 4)
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	index, err := repo.Index("nested snapshot", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ""}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	instance, _, err := RenderRepoSnapshotAttributeViewWithPagingOptions(index.ID, database.ID, "", "", "", 1, 1, nil, AttributeViewRenderOptions{Nested: &av.NestedRequest{ExpandedIDs: []string{ids[0]}}})
	if err != nil {
		t.Fatal(err)
	}
	result := av.TableFromViewable(instance)
	if len(result.Rows) != 2 || result.Rows[1].Hierarchy.ParentID != ids[0] || result.Nested.RootCount != 3 {
		t.Fatal("snapshot used live hierarchy")
	}
	instance, _, err = RenderRepoSnapshotAttributeViewWithPagingOptions(index.ID, database.ID, "", "", "", 2, 1, nil, AttributeViewRenderOptions{Nested: &av.NestedRequest{}})
	if err != nil {
		t.Fatal(err)
	}
	result = av.TableFromViewable(instance)
	if len(result.Rows) != 1 || result.Rows[0].ID != ids[2] || result.Nested.Page != 2 {
		t.Fatal("snapshot root paging ignored")
	}
}

func TestNestedDeepLocateAndRefresh(t *testing.T) {
	database, ids := nestedFixture(t, 5102)
	parents := map[string]string{}
	for i := 1; i < len(ids); i++ {
		parents[ids[i]] = ids[i-1]
	}
	if err := database.SetSubItemsParents(parents); err != nil {
		t.Fatal(err)
	}
	target := &AttributeViewRenderTarget{ItemID: ids[len(ids)-1], Status: "filtered"}
	view := nestedRender(t, database, "", 1, 50, target, AttributeViewRenderOptions{})
	if target.Status != "visible" || len(view.Rows) != len(ids) || len(target.AncestorIDs) != len(ids)-1 {
		t.Fatal("deep path was truncated")
	}
	view = nestedRender(t, database, "", 1, 50, nil, AttributeViewRenderOptions{Nested: &av.NestedRequest{ExpandedIDs: append(slices.Clone(ids), ids...)}})
	if len(view.Rows) != len(ids) {
		t.Fatal("deep expansion could not refresh with duplicate IDs")
	}
}

func TestNestedGroupIdentityAndFlatMembershipRemainStable(t *testing.T) {
	database, ids := nestedFixture(t, 3)
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	view := database.Views[0]
	view.Group = &av.ViewGroup{Field: database.GetBlockKey().ID, Method: av.GroupMethodValue}
	for _, writable := range []bool{false, true} {
		view.Groups = nil
		instance, err := renderAttributeViewWithOptions(database, "", view.ID, "", "", 1, 50, nil, false, writable, nil, "", AttributeViewRenderOptions{Nested: &av.NestedRequest{}})
		if err != nil {
			t.Fatal(err)
		}
		first := av.TableFromViewable(instance)
		groupIDs := []string{}
		for _, group := range first.Groups {
			groupIDs = append(groupIDs, group.GetID())
		}
		instance, err = renderAttributeViewWithOptions(database, "", view.ID, "", "", 1, 50, nil, false, writable, nil, "", AttributeViewRenderOptions{Nested: &av.NestedRequest{}})
		if err != nil {
			t.Fatal(err)
		}
		secondIDs := []string{}
		for _, group := range av.TableFromViewable(instance).Groups {
			secondIDs = append(secondIDs, group.GetID())
		}
		if !reflect.DeepEqual(groupIDs, secondIDs) {
			t.Fatalf("unstable group IDs: %v %v", groupIDs, secondIDs)
		}
		foundChild := false
		for _, group := range view.Groups {
			if slices.Contains(group.GroupItemIDs, ids[1]) {
				foundChild = true
				if len(group.GroupItemIDs) != 1 {
					t.Fatal("nested membership overwrote flat group")
				}
			}
		}
		if !foundChild {
			t.Fatal("flat child group was dropped")
		}
	}
}
