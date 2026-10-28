// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"reflect"
	"testing"
)

func TestGetVisibleViewIDs(t *testing.T) {
	attrView := &AttributeView{Views: []*View{
		{ID: "view-a"},
		{ID: "view-b"},
		{ID: "view-c"},
	}}

	if actual := attrView.GetVisibleViewIDs(""); !reflect.DeepEqual(actual, []string{"view-a", "view-b", "view-c"}) {
		t.Fatalf("legacy visible views mismatch: %v", actual)
	}
	if actual := attrView.GetVisibleViewIDs("view-c,missing,view-a,view-c"); !reflect.DeepEqual(actual, []string{"view-a", "view-c"}) {
		t.Fatalf("normalized visible views mismatch: %v", actual)
	}
	if actual := attrView.GetVisibleViewIDs("missing"); !reflect.DeepEqual(actual, []string{"view-a"}) {
		t.Fatalf("fallback visible views mismatch: %v", actual)
	}
}
