// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"strings"
	"testing"
)

func TestValidateLayoutsPreservesOrderAndNestedValidation(t *testing.T) {
	for _, nested := range []bool{false, true} {
		list := &View{ID: "list", LayoutType: LayoutTypeList}
		calendar := &View{ID: "calendar", LayoutType: LayoutTypeCalendar}
		database := &AttributeView{Views: []*View{nil, list, calendar}}
		if nested {
			database.Views = []*View{{Groups: database.Views}}
		}
		for _, layout := range []string{"calendar", "list"} {
			if err := database.ValidateLayouts(); err == nil || !strings.HasPrefix(err.Error(), layout+" layout missing") {
				t.Fatalf("nested=%t expected %s validation first, got %v", nested, layout, err)
			}
			switch layout {
			case "calendar":
				calendar.Calendar = &LayoutCalendar{LayoutTable: NewLayoutTable()}
			case "list":
				list.List = NewLayoutList()
			}
		}
		if err := database.ValidateLayouts(); err != nil {
			t.Fatalf("valid layouts rejected: %v", err)
		}
	}
}
