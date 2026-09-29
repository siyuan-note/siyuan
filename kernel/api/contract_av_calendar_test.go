package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAVContractCalendarTemplateDate(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	languageData, err := os.ReadFile("../../app/appearance/langs/zh-CN.json")
	if err != nil {
		t.Fatal(err)
	}
	var language struct {
		AttrView map[string]any `json:"_attrView"`
	}
	if err = json.Unmarshal(languageData, &language); err != nil {
		t.Fatal(err)
	}
	translations := util.AttrViewLangs[util.Lang]
	oldMonths, oldDateTemplate := translations["dateMonths"], translations["dateFormatFullTemplate"]
	translations["dateMonths"], translations["dateFormatFullTemplate"] = language.AttrView["dateMonths"], language.AttrView["dateFormatFullTemplate"]
	t.Cleanup(func() {
		translations["dateMonths"], translations["dateFormatFullTemplate"] = oldMonths, oldDateTemplate
	})
	database, itemID := fixture.attrView, ast.NewNodeID()
	view := database.Views[0]
	study := av.NewKey(ast.NewNodeID(), "Study", "", av.KeyTypeDate)
	date := av.NewKey(ast.NewNodeID(), "Review", "", av.KeyTypeDate)
	date.RenderTemplate = `.action{$s := index . "Study"}.action{if $s}.action{$s.AddDate 0 0 3 | date "2006年1月2日"}.action{end}`
	primary := database.GetBlockKeyValues()
	primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: itemID,
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Review"}})
	database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: study, Values: []*av.Value{{
		ID: ast.NewNodeID(), KeyID: study.ID, BlockID: itemID, Type: av.KeyTypeDate,
		Date: &av.ValueDate{Content: time.Date(2026, 9, 29, 0, 0, 0, 0, time.Local).UnixMilli(), IsNotEmpty: true, IsNotTime: true},
	}}}, &av.KeyValues{Key: date})
	view.ItemIDs = []string{itemID}
	view.LayoutType = av.LayoutTypeCalendar
	view.Calendar = &av.LayoutCalendar{LayoutTable: view.Table, Settings: av.CalendarSettings{DateKeyID: date.ID, WeekStart: 1}}
	view.Table = nil
	for _, key := range []*av.Key{study, date} {
		view.Calendar.Columns = append(view.Calendar.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
	}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	file := av.GetAttributeViewDataPath(database.ID)
	before, _ := os.ReadFile(file)
	for _, zone := range []string{"Asia/Shanghai", "America/New_York"} {
		location, _ := time.LoadLocation(zone)
		start := time.Date(2026, 10, 2, 0, 0, 0, 0, location)
		for _, target := range []string{"", itemID} {
			rangeStart := start
			if target != "" {
				rangeStart = start.AddDate(0, 0, -7)
			}
			path := "/api/av/renderAttributeView"
			response := callAttributeViewContextFilterAPI(t, path, map[string]any{
				"id": database.ID, "viewID": view.ID, "targetItemID": target,
				"calendarRange": &av.CalendarRange{Start: rangeStart.UnixMilli(), End: rangeStart.AddDate(0, 0, 1).UnixMilli(), TimeZone: zone},
			}, renderAttributeView)
			requireAPIContract(t, http.MethodPost, path, response)
			var result struct {
				Code int
				Data struct{ View *av.Table }
			}
			decodeAttributeViewContextFilterAPIResponse(t, response, &result)
			if result.Code != 0 || result.Data.View.RowCount != 1 || len(result.Data.View.Rows) != 1 {
				t.Fatalf("computed date was filtered out: %s", response.Body.String())
			}
			value := result.Data.View.Rows[0].GetValue(date.ID)
			if !value.HasRenderTemplate || value.RenderedContent != "2026年10月2日" || value.Date.IsNotEmpty {
				t.Fatalf("computed result overwrote the empty stored date: %+v", value)
			}
			if target != "" && (result.Data.View.CalendarTargetDate == nil || *result.Data.View.CalendarTargetDate != start.UnixMilli()) {
				t.Fatalf("target did not locate the computed date: %+v", result.Data.View.CalendarTargetDate)
			}
		}
	}
	after, _ := os.ReadFile(file)
	if !bytes.Equal(before, after) {
		t.Fatal("calendar rendering persisted computed dates")
	}
	for _, content := range []string{"", "invalid"} {
		date.RenderTemplate = `.action{print "` + content + `"}`
		values, _ := database.GetKeyValues(date.ID)
		values.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: date.ID, BlockID: itemID, Type: av.KeyTypeDate,
			Date: &av.ValueDate{Content: 1790726400000, IsNotEmpty: true}}}
		if err := av.SaveAttributeView(database); err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{"/api/av/renderAttributeView", "/api/av/getAttributeViewCalendarUndated"} {
			handler := renderAttributeView
			if path == "/api/av/getAttributeViewCalendarUndated" {
				handler = getAttributeViewCalendarUndated
			}
			response := callAttributeViewContextFilterAPI(t, path, map[string]any{
				"id": database.ID, "viewID": view.ID,
			}, handler)
			requireAPIContract(t, http.MethodPost, path, response)
			var result struct {
				Code int
				Data struct {
					View  *av.Table
					Rows  []*av.TableRow
					Total int
				}
			}
			decodeAttributeViewContextFilterAPIResponse(t, response, &result)
			if result.Code != 0 || len(result.Data.Rows) != 0 || result.Data.Total != 0 ||
				result.Data.View != nil && len(result.Data.View.Rows) != 0 {
				t.Fatalf("invalid template fell back to stored dates or manual scheduling: %s", response.Body.String())
			}
		}
	}
}

func TestAVContractCalendarLayoutAndRange(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	util.AttrViewLangs["en"]["calendar"] = "Calendar"
	path := "/api/av/changeAttrViewLayout"
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{
		"avID": fixture.attrView.ID, "blockID": fixture.databaseID, "layoutType": "calendar",
	}, changeAttrViewLayout)
	requireAPIContract(t, http.MethodPost, path, response)
	var result struct {
		Code int
		Data struct {
			ViewType string
			View     *av.Table
		}
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 || result.Data.ViewType != "calendar" || result.Data.View.Calendar == nil {
		t.Fatalf("calendar layout response: %s", response.Body.String())
	}
	current, err := av.ParseAttributeView(fixture.attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertAVContractJSONEqual(t, current.Views[0], toContractAVView(current.Views[0]))
	for _, limit := range []int{0, 3, 5, 10, -1} {
		settings := current.Views[0].Calendar.Settings
		settings.RowLimit = limit
		assertAVContractJSONEqual(t, settings, toContractAVCalendarSettings(&settings))
	}
	assertAVContractJSONEqual(t, &av.Calendar{Table: result.Data.View}, avContractView(&av.Calendar{Table: result.Data.View}))
	current.Views[0].Calendar.Settings.RowLimit = 5
	if err = av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	path = "/api/av/renderAttributeView"
	dateRange := &av.CalendarRange{Start: 1788220800000, End: 1791849600000, TimeZone: "Asia/Shanghai"}
	response = callAttributeViewContextFilterAPI(t, path, map[string]any{
		"id": fixture.attrView.ID, "blockID": fixture.databaseID, "calendarRange": dateRange,
	}, renderAttributeView)
	requireAPIContract(t, http.MethodPost, path, response)
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 || result.Data.View.CalendarRange == nil || *result.Data.View.CalendarRange != *dateRange ||
		result.Data.View.Calendar.RowLimit != 5 || len(result.Data.View.Rows) != 0 {
		t.Fatalf("calendar range or empty binding response: %s", response.Body.String())
	}
	file := av.GetAttributeViewDataPath(fixture.attrView.ID)
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []*av.CalendarRange{{Start: 2, End: 1, TimeZone: "UTC"},
		{Start: 0, End: 64 * 86400000, TimeZone: "UTC"}, {Start: 1, End: 2, TimeZone: "invalid"}} {
		response = callAttributeViewContextFilterAPI(t, path, map[string]any{
			"id": fixture.attrView.ID, "blockID": fixture.databaseID, "calendarRange": invalid,
		}, renderAttributeView)
		requireAPIContract(t, http.MethodPost, path, response)
		decodeAttributeViewContextFilterAPIResponse(t, response, &result)
		if result.Code == 0 {
			t.Fatalf("invalid calendar range accepted: %s", response.Body.String())
		}
	}
	after, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("range validation changed database data")
	}
	originalAccess := model.GetPublishAccess()
	if err = model.SetPublishAccess(model.PublishAccess{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = model.SetPublishAccess(originalAccess) })
	response = callAttributeViewContextFilterAPIWithRole(t, path, map[string]any{
		"id": fixture.attrView.ID, "blockID": fixture.databaseID, "calendarRange": dateRange,
	}, renderAttributeView, model.RoleReader)
	requireAPIContract(t, http.MethodPost, path, response)
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 {
		t.Fatalf("publish calendar response: %s", response.Body.String())
	}
	after, err = os.ReadFile(file)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("published calendar persisted browsing state")
	}
}

func TestAVContractCalendarPublishTarget(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	database := fixture.attrView
	view := database.Views[0]
	dateKey := av.NewKey(ast.NewNodeID(), "Date", "", av.KeyTypeDate)
	primary := database.GetBlockKeyValues()
	visibleID, hiddenID := ast.NewNodeID(), ast.NewNodeID()
	start := int64(1788220800000)
	values := &av.KeyValues{Key: dateKey}
	for i, id := range []string{visibleID, hiddenID} {
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: id,
			Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: id}})
		values.Values = append(values.Values, &av.Value{ID: ast.NewNodeID(), KeyID: dateKey.ID, BlockID: id,
			Type: av.KeyTypeDate, Date: &av.ValueDate{Content: start + int64(i)*100*86400000, IsNotEmpty: true, IsNotTime: true}})
	}
	database.KeyValues = append(database.KeyValues, values)
	view.ItemIDs = []string{visibleID, hiddenID}
	view.LayoutType = av.LayoutTypeCalendar
	view.Calendar = &av.LayoutCalendar{LayoutTable: view.Table, Settings: av.CalendarSettings{DateKeyID: dateKey.ID, WeekStart: 1}}
	view.Table = nil
	view.Calendar.Columns = append(view.Calendar.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: dateKey.ID}})
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	keys := callAttributeViewContextFilterAPI(t, "/api/av/getAttributeViewKeys", map[string]any{
		"avID": database.ID, "itemID": visibleID,
	}, getAttributeViewKeys)
	requireAPIContract(t, http.MethodPost, "/api/av/getAttributeViewKeys", keys)
	filter := func(viewable av.Viewable) av.Viewable {
		calendar := viewable.(*av.Calendar)
		rows := []*av.TableRow{}
		for _, row := range calendar.Rows {
			if row.ID != hiddenID {
				rows = append(rows, row)
			}
		}
		calendar.Rows = rows
		return calendar
	}
	response := renderAttrView("", database.ID, view.ID, "", 1, 1, nil, av.LayoutTypeCalendar, false, false,
		hiddenID, "", filter, true, &av.CalendarRange{Start: start, End: start + 42*86400000, TimeZone: "UTC"})
	body, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	recorder.Header().Set("Content-Type", "application/json")
	_, _ = recorder.Write(body)
	requireAPIContract(t, http.MethodPost, "/api/av/renderAttributeView", recorder)
	var result struct {
		Code int
		Data struct {
			View   *av.Table
			Target *model.AttributeViewRenderTarget
		}
	}
	decodeAttributeViewContextFilterAPIResponse(t, recorder, &result)
	if result.Code != 0 || result.Data.View.RowCount != 1 || len(result.Data.View.Rows) != 1 ||
		result.Data.View.CalendarTargetDate != nil || result.Data.Target.Status != "itemNotFound" || result.Data.Target.Index != 0 {
		t.Fatalf("publish filtering leaked calendar target metadata: %s", body)
	}
}

func TestAVContractCalendarUndated(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	database := fixture.attrView
	view := database.Views[0]
	dateKey := av.NewKey(ast.NewNodeID(), "Date", "", av.KeyTypeDate)
	primary := database.GetBlockKeyValues()
	dates := &av.KeyValues{Key: dateKey}
	ids := []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}
	for index, title := range []string{"Plan alpha", "Plan beta", "Review", "Dated"} {
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID,
			BlockID: ids[index], Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: title}})
		date := &av.ValueDate{}
		if index == 3 {
			date = &av.ValueDate{Content: 1788220800000, IsNotEmpty: true, IsNotTime: true}
		}
		dates.Values = append(dates.Values, &av.Value{ID: ast.NewNodeID(), KeyID: dateKey.ID,
			BlockID: ids[index], Type: av.KeyTypeDate, Date: date})
	}
	database.KeyValues = append(database.KeyValues, dates)
	view.ItemIDs = ids
	view.LayoutType = av.LayoutTypeCalendar
	view.Calendar = &av.LayoutCalendar{LayoutTable: view.Table, Settings: av.CalendarSettings{DateKeyID: dateKey.ID, WeekStart: 1}}
	view.Table = nil
	view.Calendar.Columns = append(view.Calendar.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: dateKey.ID}})
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	path := "/api/av/getAttributeViewCalendarUndated"
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{
		"id": database.ID, "viewID": view.ID, "page": 2, "pageSize": 1,
	}, getAttributeViewCalendarUndated)
	requireAPIContract(t, http.MethodPost, path, response)
	var result struct {
		Code int `json:"code"`
		Data struct {
			Rows  []*av.TableRow `json:"rows"`
			Total int            `json:"total"`
		} `json:"data"`
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 || result.Data.Total != 3 || len(result.Data.Rows) != 1 || result.Data.Rows[0].ID != ids[1] {
		t.Fatalf("unexpected undated page: %s", response.Body.String())
	}
	if value := result.Data.Rows[0].GetValue(dateKey.ID); value == nil || value.Type != av.KeyTypeDate || value.Date == nil {
		t.Fatalf("undated row has no editable date cell: %s", response.Body.String())
	}
	for _, test := range []struct {
		request map[string]any
		wantID  string
	}{
		{map[string]any{"id": database.ID, "viewID": view.ID, "search": "beta"}, ids[1]},
		{map[string]any{"id": database.ID, "viewID": view.ID, "query": "Plan", "search": "alpha"}, ids[0]},
	} {
		response = callAttributeViewContextFilterAPI(t, path, test.request, getAttributeViewCalendarUndated)
		requireAPIContract(t, http.MethodPost, path, response)
		decodeAttributeViewContextFilterAPIResponse(t, response, &result)
		if result.Code != 0 || result.Data.Total != 1 || len(result.Data.Rows) != 1 || result.Data.Rows[0].ID != test.wantID {
			t.Fatalf("undated search returned the wrong rows: %s", response.Body.String())
		}
	}
	response = callAttributeViewContextFilterAPI(t, path, map[string]any{
		"id": database.ID, "blockID": fixture.databaseID, "viewID": view.ID,
	}, getAttributeViewCalendarUndated)
	requireAPIContract(t, http.MethodPost, path, response)
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 || result.Data.Total != 0 || len(result.Data.Rows) != 0 {
		t.Fatalf("context filter was bypassed: %s", response.Body.String())
	}
}
