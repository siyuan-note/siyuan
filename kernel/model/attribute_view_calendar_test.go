package model

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupCalendarTest(t *testing.T) (*av.AttributeView, *av.View) {
	setupAttributeViewValidationTest(t)
	setAttributeViewListTestLangs()
	util.AttrViewLangs["en"]["calendar"] = "Calendar"
	attrView := newAttributeViewWithLayout(ast.NewNodeID(), av.LayoutTypeCalendar)
	return attrView, attrView.Views[0]
}

func TestAttributeViewCalendarSettingsAndFields(t *testing.T) {
	attrView, view := setupCalendarTest(t)
	if view.Calendar.Settings.DateKeyID != "" || len(attrView.KeyValues) != 2 {
		t.Fatal("opening a calendar must not create a date field")
	}
	date := av.NewKey(ast.NewNodeID(), "Date", "", av.KeyTypeDate)
	addAttributeViewKey(attrView, view, date, "")
	view.Calendar.Settings.DateKeyID = date.ID
	view.Calendar.Settings.ColorKeyID = attrView.KeyValues[1].Key.ID
	if getAttributeViewField(view, date.ID) == nil {
		t.Fatal("new date field is missing from calendar")
	}
	view.Group = &av.ViewGroup{Field: attrView.KeyValues[1].Key.ID}
	if view.IsGroupView() {
		t.Fatal("calendar must not group items")
	}
	calendar := view.Calendar
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		if err := changeAttrViewLayout(attrView, view, layout); nil != err {
			t.Fatal(err)
		}
		if !view.IsGroupView() {
			t.Fatal("switching back must restore grouping")
		}
		if err := changeAttrViewLayout(attrView, view, av.LayoutTypeCalendar); nil != err {
			t.Fatal(err)
		}
		if view.Calendar != calendar || view.Calendar.Settings.DateKeyID != date.ID {
			t.Fatal("calendar settings were lost")
		}
	}
	cloned := av.NewCalendarView()
	if err := cloneAttributeViewLayouts(cloned, view); nil != err {
		t.Fatal(err)
	}
	cloned.Calendar.Columns[0].Hidden = true
	if view.Calendar.Columns[0].Hidden || view.Calendar.ID == cloned.Calendar.ID {
		t.Fatal("calendar clone must be independent")
	}
	copy := attrView.Clone()
	if copy == nil {
		t.Fatal("database clone failed")
	}
	copySettings := copy.Views[0].Calendar.Settings
	copyDate, dateErr := copy.GetKey(copySettings.DateKeyID)
	copyColor, colorErr := copy.GetKey(copySettings.ColorKeyID)
	if dateErr != nil || colorErr != nil || copyDate.Type != av.KeyTypeDate || copyColor.Type != av.KeyTypeSelect ||
		copySettings.DateKeyID == date.ID || copySettings.ColorKeyID == view.Calendar.Settings.ColorKeyID {
		t.Fatal("database clone must bind its own date and color fields")
	}
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	stored, err := av.ParseAttributeView(attrView.ID)
	if nil != err || !reflect.DeepEqual(stored.Views[0].Calendar, view.Calendar) {
		t.Fatalf("calendar roundtrip: %v", err)
	}
	removeAttributeViewFieldDefinition(attrView, date.ID)
	if view.Calendar.Settings.DateKeyID != date.ID || getAttributeViewField(view, date.ID) != nil {
		t.Fatal("deleted source must retain the invalid binding without retaining its field")
	}
	if err = setAttributeViewFieldsHidden(attrView, attrView.GetBlockKeyValues().Key.ID, []string{view.ID}, true); nil == err {
		t.Fatal("calendar primary field must remain visible")
	}
}

func TestAttributeViewCalendarRenderFilterSortAndExport(t *testing.T) {
	attrView, view := setupCalendarTest(t)
	date := av.NewKey(ast.NewNodeID(), "Date", "", av.KeyTypeDate)
	addAttributeViewKey(attrView, view, date, "")
	view.Calendar.Settings.DateKeyID = date.ID
	view.PageSize = 1
	dateValues, _ := attrView.GetKeyValues(date.ID)
	primary := attrView.GetBlockKeyValues()
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	for i := 0; i < 120; i++ {
		id := ast.NewNodeID()
		view.ItemIDs = append(view.ItemIDs, id)
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: id,
			Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: id}})
		dateValues.Values = append(dateValues.Values, &av.Value{ID: ast.NewNodeID(), KeyID: date.ID, BlockID: id,
			Type: av.KeyTypeDate, Date: &av.ValueDate{Content: start + int64(i)*86400000, IsNotEmpty: true, IsNotTime: true}})
	}
	view.Sorts = []*av.ViewSort{{Column: date.ID, Order: av.SortOrderDesc}}
	view.Filters = []*av.ViewFilter{{Column: date.ID, Operator: av.FilterOperatorIsNotEmpty}}
	calendar := sql.RenderView(attrView, view, "", false).(*av.Calendar)
	calendar.CalendarRange = &av.CalendarRange{Start: start, End: start + 42*86400000, TimeZone: "UTC"}
	if _, _, err := renderViewableInstance(calendar, view, attrView, 1, 1, false, "", sql.NewAttributeViewRenderContext()); nil != err {
		t.Fatal(err)
	}
	if len(calendar.Rows) != 42 || calendar.RowCount != 42 || calendar.Rows[0].ID != view.ItemIDs[41] {
		t.Fatalf("range must apply after filtering and sorting without row pagination: %d rows", len(calendar.Rows))
	}
	before, _ := json.Marshal(view.Calendar)
	exported := getAttrViewTable(attrView, view, "")
	after, _ := json.Marshal(view.Calendar)
	if len(exported.Rows) != 120 || !bytes.Equal(before, after) {
		t.Fatalf("export rows=%d, layout before=%s after=%s", len(exported.Rows), before, after)
	}
}

func TestAttributeViewCalendarNewDateAndReadOnlySources(t *testing.T) {
	attrView, view := setupCalendarTest(t)
	for _, keyType := range []av.KeyType{av.KeyTypeDate, av.KeyTypeCreated, av.KeyTypeUpdated} {
		key := av.NewKey(ast.NewNodeID(), string(keyType), "", keyType)
		addAttributeViewKey(attrView, view, key, "")
		view.Calendar.Settings.DateKeyID = key.ID
		values := map[string]*av.Value{"other": {Type: av.KeyTypeText, Text: &av.ValueText{Content: "template"}}}
		err := setNewCalendarItemDate(attrView, "", view.ID, 1756684800000, values)
		if keyType == av.KeyTypeDate {
			if err != nil || !values[key.ID].Date.IsNotTime || values[key.ID].Date.Content != 1756684800000 || values["other"].Text.Content != "template" {
				t.Fatalf("calendar creation did not merge with template: %v", err)
			}
		} else if err == nil || len(values) != 1 {
			t.Fatal("system date source must reject rescheduling")
		}
	}
}

func TestAttributeViewCalendarCorruptionPreservesSource(t *testing.T) {
	attrView, view := setupCalendarTest(t)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}
	file := av.GetAttributeViewDataPath(attrView.ID)
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	view.Calendar = nil
	if err = av.SaveAttributeView(attrView); err == nil {
		t.Fatal("missing calendar must fail")
	}
	after, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("failed save changed the source")
	}
	var corrupted av.AttributeView
	if err = json.Unmarshal(before, &corrupted); err != nil {
		t.Fatal(err)
	}
	corrupted.Views[0].Calendar.Spec = 99
	invalid, _ := json.Marshal(corrupted)
	if err = os.WriteFile(file, invalid, 0644); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	if _, err = av.ParseAttributeView(attrView.ID); err == nil {
		t.Fatal("unknown calendar version must fail")
	}
	after, err = os.ReadFile(file)
	if err != nil || !bytes.Equal(invalid, after) {
		t.Fatal("failed read changed the source")
	}
}
