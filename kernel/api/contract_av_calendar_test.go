package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
