package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestGetAttributeViewRenderRange(t *testing.T) {
	tests := []struct {
		name                                       string
		page, pageSize, target, defaultSize, total int
		wantStart, wantEnd                         int
	}{
		{name: "normal page", page: 2, pageSize: 50, target: -1, defaultSize: 50, total: 200, wantStart: 50, wantEnd: 100},
		{name: "target middle", page: 1, pageSize: 50, target: 9500, defaultSize: 50, total: 10000, wantStart: 9400, wantEnd: 9600},
		{name: "target end", page: 1, pageSize: 50, target: 9999, defaultSize: 50, total: 10000, wantStart: 9800, wantEnd: 10000},
		{name: "target window capped", page: 1, pageSize: 100000, target: 9500, defaultSize: 50, total: 10000, wantStart: 9400, wantEnd: 9600},
		{name: "configured size respected", page: 1, pageSize: 50, target: 9500, defaultSize: 1000, total: 10000, wantStart: 9000, wantEnd: 10000},
		{name: "invalid sizes", page: 1, pageSize: -1, target: 75, defaultSize: -1, total: 200, wantStart: 0, wantEnd: 200},
		{name: "page past end", page: 20, pageSize: 50, target: -1, defaultSize: 50, total: 100, wantStart: 100, wantEnd: 100},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			start, end := getAttributeViewRenderRange(test.page, test.pageSize, test.target, test.defaultSize, test.total)
			if start != test.wantStart || end != test.wantEnd {
				t.Fatalf("got range [%d:%d], want [%d:%d]", start, end, test.wantStart, test.wantEnd)
			}
		})
	}
}

func TestResolveAttributeViewTargetGroupID(t *testing.T) {
	view := &av.View{Groups: []*av.View{
		{ID: "20260719000000-groupa", GroupItemIDs: []string{"20260719000000-itemaaa"}},
		{ID: "20260719000000-groupb", GroupItemIDs: []string{"20260719000000-itembbb"}},
	}}
	target := &AttributeViewRenderTarget{ItemID: "20260719000000-itembbb"}
	if got := resolveAttributeViewTargetGroupID(view, target, "20260719000000-groupb"); got != "20260719000000-groupb" {
		t.Fatalf("got group %q", got)
	}
	if got := resolveAttributeViewTargetGroupID(view, target, "20260719000000-groupa"); got != "" {
		t.Fatalf("stale group should fall back, got %q", got)
	}
	if got := resolveAttributeViewTargetGroupID(view, target, "20260719000000-missing"); got != "" {
		t.Fatalf("missing group should fall back, got %q", got)
	}
}

func TestGetAttributeViewSearchMatches(t *testing.T) {
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{
			Key: &av.Key{ID: "20260726000000-keyaaaa"},
			Values: []*av.Value{
				{
					ID:      "20260726000000-valueaa",
					BlockID: "20260726000000-itemaaa",
					Type:    av.KeyTypeText,
					Text:    &av.ValueText{Content: "First Match"},
				},
			},
		},
		{
			Key: &av.Key{ID: "20260726000000-keybbbb"},
			Values: []*av.Value{
				{
					ID:      "20260726000000-valuebb",
					BlockID: "20260726000000-itemaaa",
					Type:    av.KeyTypeText,
					Text:    &av.ValueText{Content: "Second Match"},
				},
			},
		},
	}}

	matches := getAttributeViewSearchMatches(attrView, []string{"Match"})
	match := matches["20260726000000-itemaaa"]
	if nil == match {
		t.Fatal("search match not found")
	}
	if "20260726000000-valueaa" != match.valueID || "20260726000000-keyaaaa" != match.keyID {
		t.Fatalf("unexpected search match: %+v", match)
	}
	if 0 != len(getAttributeViewSearchMatches(attrView, []string{"match"})) {
		t.Fatal("search match should preserve the case of highlighted keywords")
	}
}

func TestAppendAttributeViewSearchItems(t *testing.T) {
	hiddenGroup := &av.Table{
		BaseInstance: &av.BaseInstance{ID: "20260726000000-grouphid", GroupHidden: 2},
		Rows:         []*av.TableRow{{ID: "20260726000000-hiddena"}},
	}
	visibleGroup := &av.Table{
		BaseInstance: &av.BaseInstance{ID: "20260726000000-groupvis"},
		Rows: []*av.TableRow{
			{ID: "20260726000000-visiblea"},
			{ID: "20260726000000-visibleb"},
		},
	}
	viewable := &av.Table{BaseInstance: &av.BaseInstance{Groups: []av.Viewable{hiddenGroup, visibleGroup}}}

	items := appendAttributeViewSearchItems(nil, viewable, false)
	items = appendAttributeViewSearchItems(items, viewable, true)
	expected := []attributeViewSearchItem{
		{itemID: "20260726000000-visiblea", groupID: "20260726000000-groupvis"},
		{itemID: "20260726000000-visibleb", groupID: "20260726000000-groupvis"},
		{itemID: "20260726000000-hiddena", groupID: "20260726000000-grouphid"},
	}
	if len(expected) != len(items) {
		t.Fatalf("unexpected items: %+v", items)
	}
	for i, item := range items {
		if expected[i] != item {
			t.Fatalf("unexpected items: %+v", items)
		}
	}

	ungrouped := &av.Table{
		BaseInstance: &av.BaseInstance{ID: "20260726000000-viewaaaa"},
		Rows:         []*av.TableRow{{ID: "20260726000000-itemaaaa"}},
	}
	items = appendAttributeViewSearchItems(nil, ungrouped, false)
	if 1 != len(items) || "20260726000000-itemaaaa" != items[0].itemID || "" != items[0].groupID {
		t.Fatalf("unexpected ungrouped items: %+v", items)
	}
}

func TestGetAttributeViewItemStatuses(t *testing.T) {
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{
		Key: &av.Key{Type: av.KeyTypeBlock},
		Values: []*av.Value{
			{BlockID: "20260811000000-visible"},
			{BlockID: "20260811000000-hiddena"},
			{BlockID: "20260811000000-filtered"},
		},
	}}}
	hiddenGroup := &av.Table{
		BaseInstance: &av.BaseInstance{GroupHidden: 2},
		Rows:         []*av.TableRow{{ID: "20260811000000-hiddena"}},
	}
	visibleGroup := &av.Table{
		BaseInstance: &av.BaseInstance{},
		Rows:         []*av.TableRow{{ID: "20260811000000-visible"}},
	}
	viewable := &av.Table{BaseInstance: &av.BaseInstance{Groups: []av.Viewable{hiddenGroup, visibleGroup}}}

	statuses := getAttributeViewItemStatuses(attrView, viewable, []string{
		"20260811000000-visible",
		"20260811000000-hiddena",
		"20260811000000-filtered",
		"20260811000000-missing",
		"20260811000000-visible",
		"",
	})
	expected := map[string]string{
		"20260811000000-visible":  "visible",
		"20260811000000-hiddena":  "groupHidden",
		"20260811000000-filtered": "filtered",
		"20260811000000-missing":  "itemNotFound",
	}
	if len(expected) != len(statuses) {
		t.Fatalf("unexpected statuses: %+v", statuses)
	}
	for itemID, status := range expected {
		if status != statuses[itemID] {
			t.Fatalf("item %q got status %q, want %q", itemID, statuses[itemID], status)
		}
	}
}

func TestGetAttributeViewPasteRowsFromTable(t *testing.T) {
	table := &av.Table{Rows: []*av.TableRow{
		{ID: "20260723000000-itemaaa"},
		{ID: "20260723000000-itembbb"},
		{ID: "20260723000000-itemccc"},
	}}

	rows, err := getAttributeViewPasteRowsFromTable(table, "20260723000000-itembbb", 3)
	if nil != err {
		t.Fatal(err)
	}
	if 2 != len(rows) || "20260723000000-itembbb" != rows[0].ID || "20260723000000-itemccc" != rows[1].ID {
		t.Fatalf("unexpected paste rows: %+v", rows)
	}

	if _, err = getAttributeViewPasteRowsFromTable(table, "20260723000000-missing", 1); nil == err {
		t.Fatal("missing start item should return an error")
	}
	if _, err = getAttributeViewPasteRowsFromTable(table, "20260723000000-itemaaa", 0); nil == err {
		t.Fatal("invalid count should return an error")
	}
}

func TestGetPasteInferableAttributeViewKeyIDs(t *testing.T) {
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{
			Key: &av.Key{ID: "20260726000000-keyaaaa"},
			Values: []*av.Value{
				{Type: av.KeyTypeText, Text: &av.ValueText{Content: ""}},
				{Type: av.KeyTypeText},
			},
		},
		{
			Key: &av.Key{ID: "20260726000000-keybbbb"},
			Values: []*av.Value{
				{Type: av.KeyTypeText, Text: &av.ValueText{Content: "value"}},
			},
		},
		{
			Key: &av.Key{ID: "20260726000000-keycccc"},
		},
		{
			Key: &av.Key{ID: "20260726000000-keydddd"},
		},
		{
			Key: &av.Key{ID: "20260726000000-keyeeee"},
		},
	}, NewItemTemplates: []*av.NewItemTemplate{{
		FieldValues: map[string]*av.NewItemFieldValue{
			"20260726000000-keycccc": {},
		},
	}}, Views: []*av.View{{
		Group: &av.ViewGroup{Field: "20260726000000-keydddd"},
	}}}

	inferableKeyIDs := getPasteInferableAttributeViewKeyIDs(attrView, map[string]struct{}{
		"20260726000000-keyeeee": {},
	})
	if 1 != len(inferableKeyIDs) || "20260726000000-keyaaaa" != inferableKeyIDs[0] {
		t.Fatalf("unexpected inferable key IDs: %+v", inferableKeyIDs)
	}
}

func TestCollectDependentRollupKeyIDs(t *testing.T) {
	keyIDs := collectDependentRollupKeyIDs([]*av.AttributeView{{
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{Type: av.KeyTypeRollup, Rollup: &av.Rollup{KeyID: "20260726000000-keyaaaa"}}},
			{Key: &av.Key{Type: av.KeyTypeRollup, Rollup: &av.Rollup{}}},
			{Key: &av.Key{Type: av.KeyTypeText}},
		},
	}})
	if 1 != len(keyIDs) {
		t.Fatalf("unexpected dependent rollup key IDs: %+v", keyIDs)
	}
	if _, ok := keyIDs["20260726000000-keyaaaa"]; !ok {
		t.Fatalf("dependent rollup key ID not found: %+v", keyIDs)
	}
}
