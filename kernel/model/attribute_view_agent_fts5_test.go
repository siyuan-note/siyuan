//go:build fts5

// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
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
