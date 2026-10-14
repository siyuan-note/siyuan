//go:build fts5

// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewAgentViewLifecycleAndConfiguration(t *testing.T) {
	fixture, _, _, _ := setupAttributeViewItemsTest(t, false)
	setAttributeViewListTestLangs()
	created, err := CreateAttributeViewDatabase(fixture.sourceID, "", "", "Agent database", "Task", av.LayoutTypeTable,
		[]*AttributeViewCreateKey{{Name: "Status", Type: "text"}})
	if nil != err {
		t.Fatal(err)
	}
	database := created.AttributeView
	avID, blockID := created.AvID, created.BlockID
	originalID := created.ViewID
	var textKeyID string
	for _, kv := range database.KeyValues {
		if kv.Key.Type == av.KeyTypeText {
			textKeyID = kv.Key.ID
			break
		}
	}
	if "" == textKeyID {
		t.Fatal("text field is required for this test")
	}
	if _, err = AddAttributeViewView(avID, blockID, "Unsupported", av.LayoutType("future-layout")); nil == err {
		t.Fatal("unsupported layouts must be rejected by the kernel")
	}
	if stored, _, readErr := GetAttributeViewViewTarget(avID, blockID, originalID); nil != readErr || len(stored.Views) != 1 {
		t.Fatalf("rejected layout changed the database: %+v, %v", stored, readErr)
	}

	viewID, err := AddAttributeViewView(avID, blockID, "Agent view", av.LayoutTypeGallery)
	if nil != err {
		t.Fatal(err)
	}
	_, view, err := GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err || view.Name != "Agent view" || view.LayoutType != av.LayoutTypeGallery {
		t.Fatalf("added view was not stored: %+v, %v", view, err)
	}
	if _, _, err = GetAttributeViewViewTarget(avID, blockID, "missing-view"); nil == err {
		t.Fatal("missing view must not fall back to the first view")
	}
	if _, _, err = GetAttributeViewViewTarget(avID, fixture.sourceID, originalID); nil == err {
		t.Fatal("a document block must not be accepted as the database carrier")
	}

	firstRevision := AttributeViewViewConfigRevision(view)
	filters := []*av.ViewFilter{{Combination: av.FilterCombinationAnd, Filters: []*av.ViewFilter{{
		Column: textKeyID, Operator: av.FilterOperatorContains,
		Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "private"}},
	}}}}
	if err = SetAttributeViewViewFilters(avID, blockID, viewID, firstRevision, filters); nil != err {
		t.Fatal(err)
	}
	if err = SetAttributeViewViewSorts(avID, blockID, viewID, firstRevision, []*av.ViewSort{{Column: textKeyID, Order: av.SortOrderAsc}}); nil == err {
		t.Fatal("stale revision must not replace current configuration")
	}
	_, view, err = GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err {
		t.Fatal(err)
	}
	if err = SetAttributeViewViewSorts(avID, blockID, viewID, AttributeViewViewConfigRevision(view),
		[]*av.ViewSort{{Column: textKeyID, Order: av.SortOrderAsc}}); nil != err {
		t.Fatal(err)
	}
	_, view, err = GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err {
		t.Fatal(err)
	}
	if err = SetAttributeViewViewGroup(avID, blockID, viewID, AttributeViewViewConfigRevision(view),
		&av.ViewGroup{Field: textKeyID, Method: av.GroupMethodValue, HideEmpty: true}); nil != err {
		t.Fatal(err)
	}

	copyID, err := DuplicateAttributeViewView(avID, blockID, viewID, "Agent copy")
	if nil != err {
		t.Fatal(err)
	}
	_, copied, err := GetAttributeViewViewTarget(avID, blockID, copyID)
	if nil != err || copied.Name != "Agent copy" || len(copied.Filters) != 1 || len(copied.Sorts) != 1 || nil == copied.Group {
		t.Fatalf("copied view lost configuration: %+v, %v", copied, err)
	}

	_, view, err = GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err {
		t.Fatal(err)
	}
	if err = ChangeAttrViewLayoutForView(blockID, avID, viewID, AttributeViewViewConfigRevision(view), av.LayoutTypeList); nil != err {
		t.Fatal(err)
	}
	_, view, err = GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err || view.LayoutType != av.LayoutTypeList {
		t.Fatalf("layout did not change: %+v, %v", view, err)
	}
	if len(view.Filters) != 1 || len(view.Sorts) != 1 || nil == view.Group {
		t.Fatalf("layout change lost view configuration: %+v", view)
	}
	if _, current, err := getAttributeViewViewCarrier(avID, blockID); nil != err || current.ID != copyID {
		t.Fatalf("changing another view switched the carrier view: %+v, %v", current, err)
	}

	if err = RemoveAttributeViewView(avID, blockID, copyID); nil != err {
		t.Fatal(err)
	}
	if err = RemoveAttributeViewView(avID, blockID, viewID); nil != err {
		t.Fatal(err)
	}
	if err = RemoveAttributeViewView(avID, blockID, originalID); nil == err {
		t.Fatal("last view must be preserved")
	}
}

func TestAttributeViewAgentViewMetadataOrderAndVisibility(t *testing.T) {
	fixture, _, _, _ := setupAttributeViewItemsTest(t, false)
	setAttributeViewListTestLangs()
	created, err := CreateAttributeViewDatabase(fixture.sourceID, "", "", "Agent database", "Task", av.LayoutTypeTable, nil)
	if nil != err {
		t.Fatal(err)
	}
	avID, blockID, originalID := created.AvID, created.BlockID, created.ViewID
	viewID, err := AddAttributeViewView(avID, blockID, "Gallery", av.LayoutTypeGallery)
	if nil != err {
		t.Fatal(err)
	}
	lastID, err := AddAttributeViewView(avID, blockID, "List", av.LayoutTypeList)
	if nil != err {
		t.Fatal(err)
	}
	mirrorID := ast.NewNodeID()
	tree, err := LoadTreeByBlockID(blockID)
	if nil != err {
		t.Fatal(err)
	}
	mirror := util.NewLute().BlockDOM2Tree(databaseBlockTestDOM(mirrorID, avID, originalID, av.LayoutTypeTable)).Root.FirstChild
	tree.Root.AppendChild(mirror)
	if _, err = filesys.WriteTree(tree); nil != err {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)

	name, icon, desc := "  Weekly tasks  ", "1f4c5", "  Current week  "
	if err = UpdateAttributeViewView(avID, blockID, viewID, AttributeViewViewUpdate{Name: &name, Icon: &icon, Desc: &desc}); nil != err {
		t.Fatal(err)
	}
	attrView, view, err := GetAttributeViewViewTarget(avID, mirrorID, viewID)
	if nil != err || view.Name != "Weekly tasks" || view.Icon != icon || view.Desc != "Current week" {
		t.Fatalf("metadata was not shared across mirrors: %+v, %v", view, err)
	}
	name = "This week"
	if err = UpdateAttributeViewView(avID, blockID, viewID, AttributeViewViewUpdate{Name: &name}); nil != err {
		t.Fatal(err)
	}
	_, view, err = GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err || view.Name != name || view.Icon != icon || view.Desc != "Current week" {
		t.Fatalf("omitted metadata was changed: %+v, %v", view, err)
	}
	unsafeIcon := "javascript:alert(1)"
	rejectedName := "Rejected name"
	if err = UpdateAttributeViewView(avID, blockID, viewID, AttributeViewViewUpdate{Name: &rejectedName, Icon: &unsafeIcon}); nil == err {
		t.Fatal("unsafe icon must be rejected before updating metadata")
	}
	_, view, err = GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err || view.Name != name || view.Icon != icon {
		t.Fatalf("rejected update changed metadata: %+v, %v", view, err)
	}
	empty := ""
	if err = UpdateAttributeViewView(avID, blockID, viewID, AttributeViewViewUpdate{Icon: &empty, Desc: &empty}); nil != err {
		t.Fatal(err)
	}
	_, view, err = GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err || view.Name != name || view.Icon != "" || view.Desc != "" {
		t.Fatalf("metadata clearing failed: %+v, %v", view, err)
	}
	if err = UpdateAttributeViewView(avID, blockID, viewID, AttributeViewViewUpdate{}); nil == err {
		t.Fatal("empty update must be rejected")
	}
	if err = UpdateAttributeViewView(avID, fixture.sourceID, viewID, AttributeViewViewUpdate{Name: &name}); nil == err {
		t.Fatal("non-carrier blocks must be rejected")
	}
	if err = UpdateAttributeViewView(avID, blockID, "missing-view", AttributeViewViewUpdate{Name: &name}); nil == err {
		t.Fatal("missing views must be rejected")
	}

	assertOrder := func(expected []string) {
		t.Helper()
		stored, _, readErr := GetAttributeViewViewTarget(avID, mirrorID, viewID)
		if nil != readErr {
			t.Fatal(readErr)
		}
		var actual []string
		for _, v := range stored.Views {
			actual = append(actual, v.ID)
		}
		if !slices.Equal(expected, actual) {
			t.Fatalf("unexpected shared view order: %v", actual)
		}
	}
	if err = MoveAttributeViewView(avID, blockID, viewID, ""); nil != err {
		t.Fatal(err)
	}
	assertOrder([]string{viewID, originalID, lastID})
	if err = MoveAttributeViewView(avID, blockID, viewID, lastID); nil != err {
		t.Fatal(err)
	}
	assertOrder([]string{originalID, lastID, viewID})
	if err = MoveAttributeViewView(avID, blockID, viewID, "missing-view"); nil == err {
		t.Fatal("missing predecessor must be rejected")
	}
	if err = MoveAttributeViewView(avID, blockID, viewID, viewID); nil != err {
		t.Fatal(err)
	}
	assertOrder([]string{originalID, lastID, viewID})
	if _, current, readErr := getAttributeViewViewCarrier(avID, blockID); nil != readErr || current.ID != lastID {
		t.Fatalf("metadata or order changed the current view: %+v, %v", current, readErr)
	}

	for _, invalid := range [][]string{nil, {}, {"missing-view"}, {originalID, "missing-view"}} {
		if err = SetAttributeViewBlockVisibleViews(avID, blockID, invalid); nil == err {
			t.Fatalf("invalid visibility must be rejected: %v", invalid)
		}
	}
	if err = SetAttributeViewBlockVisibleViews(avID, blockID, []string{viewID, originalID, viewID}); nil != err {
		t.Fatal(err)
	}
	attrView, _, err = GetAttributeViewViewTarget(avID, blockID, viewID)
	if nil != err {
		t.Fatal(err)
	}
	visible, err := GetDatabaseBlockVisibleViewIDs(attrView, blockID)
	if nil != err || !slices.Equal(visible, []string{originalID, viewID}) {
		t.Fatalf("visibility was not normalized in database order: %v, %v", visible, err)
	}
	mirrorVisible, err := GetDatabaseBlockVisibleViewIDs(attrView, mirrorID)
	if nil != err || !slices.Equal(mirrorVisible, []string{originalID, lastID, viewID}) || len(attrView.Views) != 3 {
		t.Fatalf("visibility affected another mirror or deleted views: %v, %v", mirrorVisible, err)
	}
	if _, current, readErr := getAttributeViewViewCarrier(avID, blockID); nil != readErr || current.ID != lastID {
		t.Fatalf("tab visibility changed the carrier's selected view: %+v, %v", current, readErr)
	}
}
