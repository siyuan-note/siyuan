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
