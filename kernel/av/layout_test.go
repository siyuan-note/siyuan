package av

import (
	"strings"
	"testing"
)

func TestValidateLayoutsPreservesOrderAndNestedValidation(t *testing.T) {
	for _, nested := range []bool{false, true} {
		list := &View{ID: "list", LayoutType: LayoutTypeList}
		calendar := &View{ID: "calendar", LayoutType: LayoutTypeCalendar}
		mapped := &View{ID: "map", LayoutType: LayoutTypeMap}
		database := &AttributeView{Views: []*View{nil, list, calendar, mapped}}
		if nested {
			database.Views = []*View{{Groups: database.Views}}
		}
		for _, layout := range []string{"map", "calendar", "list"} {
			if err := database.ValidateLayouts(); err == nil || !strings.HasPrefix(err.Error(), layout+" layout missing") {
				t.Fatalf("nested=%t expected %s validation first, got %v", nested, layout, err)
			}
			switch layout {
			case "map":
				mapped.Map = &LayoutMap{LayoutTable: NewLayoutTable()}
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
