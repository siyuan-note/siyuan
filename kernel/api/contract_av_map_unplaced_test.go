package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const mapUnplacedPath = "/api/av/getAttributeViewMapUnplaced"

func setupMapUnplacedContractTest(t *testing.T, count int) (*attributeViewContextFilterAPIFixture, *av.Key, []string) {
	t.Helper()
	fixture := setupAttributeViewContextFilterAPITest(t)
	database, view := fixture.attrView, fixture.attrView.Views[0]
	primary := database.GetBlockKeyValues()
	key := av.NewKey(ast.NewNodeID(), "Location", "", av.KeyTypeLocation)
	locations := &av.KeyValues{Key: key}
	zero, latitude, longitude, polar := 0.0, 25.04, 102.42, 90.0
	for index := 0; index < count+3; index++ {
		id := ast.NewNodeID()
		view.ItemIDs = append(view.ItemIDs, id)
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID,
			BlockID: id, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: fmt.Sprintf("Plan %03d", index)}})
		location := &av.ValueLocation{}
		switch index {
		case count:
			location = &av.ValueLocation{Latitude: &zero, Longitude: &zero}
		case count + 1:
			location = &av.ValueLocation{Latitude: &latitude, Longitude: &longitude}
		case count + 2:
			location = &av.ValueLocation{Latitude: &polar, Longitude: &zero}
		default:
			if index%2 == 1 {
				location.Name = "Name without coordinates"
			}
		}
		// 缺省值由渲染补齐，必须也能在返回页中编辑。
		if index != 0 {
			locations.Values = append(locations.Values, &av.Value{ID: ast.NewNodeID(), KeyID: key.ID,
				BlockID: id, Type: av.KeyTypeLocation, Location: location})
		}
	}
	database.KeyValues = append(database.KeyValues, locations)
	view.LayoutType, view.PageSize = av.LayoutTypeMap, 2
	view.Map = &av.LayoutMap{LayoutTable: view.Table, Settings: av.MapSettings{LocationKeyID: key.ID}}
	view.Table = nil
	view.Map.Columns = append(view.Map.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID, Hidden: true}})
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	return fixture, key, view.ItemIDs[:count]
}

func callMapUnplacedContractTest(t *testing.T, database *av.AttributeView, options map[string]any) ([]*av.TableRow, int) {
	t.Helper()
	request := map[string]any{"id": database.ID, "viewID": database.Views[0].ID}
	for key, value := range options {
		request[key] = value
	}
	response := callAttributeViewContextFilterAPI(t, mapUnplacedPath, request, getAttributeViewMapUnplaced)
	requireAPIContract(t, http.MethodPost, mapUnplacedPath, response)
	var result struct {
		Code int
		Data struct {
			Rows  []*av.TableRow
			Total int
		}
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 {
		t.Fatalf("unplaced request failed: %s", response.Body.String())
	}
	return result.Data.Rows, result.Data.Total
}

func TestAVContractMapUnplacedPagination(t *testing.T) {
	fixture, key, ids := setupMapUnplacedContractTest(t, 105)
	database := fixture.attrView
	file := av.GetAttributeViewDataPath(database.ID)
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name    string
		options map[string]any
		start   int
		count   int
	}{
		{"default", nil, 0, 50},
		{"second", map[string]any{"page": 2}, 50, 50},
		{"last", map[string]any{"page": 3}, 100, 5},
		{"beyond", map[string]any{"page": 4}, 0, 0},
		{"count", map[string]any{"pageSize": 1}, 0, 1},
		{"invalid bounds", map[string]any{"page": -1, "pageSize": 0}, 0, 50},
		{"maximum", map[string]any{"pageSize": 1000}, 0, 100},
		{"fractional", map[string]any{"page": 2.9, "pageSize": 1.9}, 1, 1},
		{"null", map[string]any{"page": nil, "pageSize": nil}, 0, 50},
	} {
		t.Run(test.name, func(t *testing.T) {
			rows, total := callMapUnplacedContractTest(t, database, test.options)
			if total != len(ids) || len(rows) != test.count {
				t.Fatalf("unexpected page: total %d, rows %d", total, len(rows))
			}
			for index, row := range rows {
				if row.ID != ids[test.start+index] {
					t.Fatalf("page skipped or repeated rows: got %s, want %s", row.ID, ids[test.start+index])
				}
				if value := row.GetValue(key.ID); value == nil || value.Type != av.KeyTypeLocation || value.Location == nil {
					t.Fatalf("hidden location cell is not editable: %+v", row)
				}
				if value := row.GetValue(database.GetBlockKeyValues().Key.ID); value == nil || value.Block == nil {
					t.Fatal("primary cell is missing")
				}
			}
		})
	}
	after, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("unplaced query changed its source: %v", err)
	}
	view, _, _, err := model.RenderAttributeViewWithTargetReadOnly("", database.ID, database.Views[0].ID, "", 1, -1, nil, "", false, false, "", "")
	if err != nil || len(view.(*av.Map).Rows) != 2 || view.(*av.Map).PageSize != 2 {
		t.Fatalf("unplaced query changed map pagination: %v", err)
	}
}

func TestAVContractMapUnplacedFiltersAndBinding(t *testing.T) {
	fixture, key, ids := setupMapUnplacedContractTest(t, 6)
	database, view := fixture.attrView, fixture.attrView.Views[0]
	for _, test := range []struct {
		options map[string]any
		want    []string
	}{
		{map[string]any{"query": "Plan", "search": "  PLAN 005  "}, ids[5:6]},
		{map[string]any{"query": "004", "search": "Plan"}, ids[4:5]},
		{map[string]any{"query": "004", "search": "005"}, nil},
		{map[string]any{"blockID": fixture.databaseID}, nil},
	} {
		rows, total := callMapUnplacedContractTest(t, database, test.options)
		if total != len(test.want) || len(rows) != len(test.want) {
			t.Fatalf("filter or search was bypassed: %+v, total %d", test.options, total)
		}
		for index, row := range rows {
			if row.ID != test.want[index] {
				t.Fatalf("wrong filtered row: %s", row.ID)
			}
		}
	}
	view.Sorts = []*av.ViewSort{{Column: database.GetBlockKeyValues().Key.ID, Order: av.SortOrderDesc}}
	view.Filters = []*av.ViewFilter{{Column: database.GetBlockKeyValues().Key.ID, Operator: av.FilterOperatorContains,
		Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Plan 00"}}}}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	rows, total := callMapUnplacedContractTest(t, database, map[string]any{"pageSize": 1, "page": 2})
	if total != len(ids) || len(rows) != 1 || rows[0].ID != ids[4] {
		t.Fatalf("sort was not applied before unplaced pagination: %+v", rows)
	}
	view.Filters[0].Value.Block.Content = "Plan 004"
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	rows, total = callMapUnplacedContractTest(t, database, nil)
	if total != 1 || len(rows) != 1 || rows[0].ID != ids[4] {
		t.Fatal("saved view filter was bypassed")
	}
	view.Filters = nil
	other := av.NewKey(ast.NewNodeID(), "Second location", "", av.KeyTypeLocation)
	zero := 0.0
	values := &av.KeyValues{Key: other}
	for _, id := range view.ItemIDs {
		values.Values = append(values.Values, &av.Value{ID: ast.NewNodeID(), KeyID: other.ID, BlockID: id,
			Type: av.KeyTypeLocation, Location: &av.ValueLocation{Latitude: &zero, Longitude: &zero}})
	}
	database.KeyValues = append(database.KeyValues, values)
	view.Map.Columns = append(view.Map.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: other.ID}})
	for _, test := range []struct {
		binding string
		total   int
	}{
		{"", len(ids)}, {key.ID, len(ids)}, {other.ID, 0}, {ast.NewNodeID(), 0}, {database.GetBlockKeyValues().Key.ID, 0},
	} {
		view.Map.Settings.LocationKeyID = test.binding
		if err := av.SaveAttributeView(database); err != nil {
			t.Fatal(err)
		}
		before, err := os.ReadFile(av.GetAttributeViewDataPath(database.ID))
		if err != nil {
			t.Fatal(err)
		}
		_, total = callMapUnplacedContractTest(t, database, nil)
		if total != test.total {
			t.Fatalf("wrong location binding %q: %d", test.binding, total)
		}
		after, err := os.ReadFile(av.GetAttributeViewDataPath(database.ID))
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("binding query persisted a derived or repaired location field")
		}
	}
	// 列顺序优先于数据库字段顺序；空绑定不得仍使用旧的首个位置字段。
	view.Map.Settings.LocationKeyID = ""
	columns := view.Map.Columns
	columns[len(columns)-2], columns[len(columns)-1] = columns[len(columns)-1], columns[len(columns)-2]
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	if _, total = callMapUnplacedContractTest(t, database, nil); total != 0 {
		t.Fatal("default binding ignored view column order")
	}
}

func TestAVContractMapUnplacedRejectsCorruptLocations(t *testing.T) {
	fixture, key, _ := setupMapUnplacedContractTest(t, 2)
	database := fixture.attrView
	for _, location := range []any{
		map[string]any{"latitude": 0}, map[string]any{"latitude": 91, "longitude": 0},
		map[string]any{"latitude": 0, "longitude": 181}, map[string]any{"coordinateSystem": "WGS84"},
		map[string]any{"crs": "gcj02", "name": "invalid"}, []any{},
	} {
		t.Run(fmt.Sprintf("%v", location), func(t *testing.T) {
			data, err := json.Marshal(database)
			if err != nil {
				t.Fatal(err)
			}
			var source map[string]any
			if err = json.Unmarshal(data, &source); err != nil {
				t.Fatal(err)
			}
			for _, entry := range source["keyValues"].([]any) {
				values := entry.(map[string]any)
				if values["key"].(map[string]any)["id"] == key.ID {
					values["values"].([]any)[0].(map[string]any)["location"] = location
				}
			}
			data, err = json.Marshal(source)
			if err != nil {
				t.Fatal(err)
			}
			file := av.GetAttributeViewDataPath(database.ID)
			if err = os.WriteFile(file, data, 0644); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			response := callAttributeViewContextFilterAPI(t, mapUnplacedPath, map[string]any{
				"id": database.ID, "viewID": database.Views[0].ID,
			}, getAttributeViewMapUnplaced)
			requireAPIContract(t, http.MethodPost, mapUnplacedPath, response)
			var result struct{ Code int }
			decodeAttributeViewContextFilterAPIResponse(t, response, &result)
			if result.Code != -1 {
				t.Fatalf("corrupt location was silently ignored: %s", response.Body.String())
			}
			after, err := os.ReadFile(file)
			if err != nil || !bytes.Equal(data, after) {
				t.Fatal("corrupt source was changed")
			}
		})
	}
}

func TestAVContractMapUnplacedAuthorization(t *testing.T) {
	setupAttributeViewContextFilterAPITest(t)
	previousReadonly := util.ReadOnly
	t.Cleanup(func() { util.ReadOnly = previousReadonly })
	for _, test := range []struct {
		role     model.Role
		readonly bool
		status   int
	}{
		{model.RoleReader, false, http.StatusForbidden},
		{model.RoleEditor, false, http.StatusForbidden},
		{model.RoleAdministrator, true, http.StatusOK},
	} {
		util.ReadOnly = test.readonly
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, test.role); c.Next() })
		registerAvRoutes(engine)
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, mapUnplacedPath, nil)
		request.Body = aiUnreadBody{t: t}
		engine.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("unplaced query permission changed: %d %s", response.Code, response.Body.String())
		}
		if test.readonly {
			requireAPIContract(t, http.MethodPost, mapUnplacedPath, response)
			var result struct{ Code int }
			decodeAttributeViewContextFilterAPIResponse(t, response, &result)
			if result.Code != -1 {
				t.Fatalf("read-only request reached handler: %s", response.Body.String())
			}
		}
	}
}

func TestAVContractMapUnplacedReadBoundaries(t *testing.T) {
	fixture, _, _ := setupMapUnplacedContractTest(t, 1)
	database, view := fixture.attrView, fixture.attrView.Views[0]
	assertFailure := func(id, viewID string) {
		t.Helper()
		response := callAttributeViewContextFilterAPI(t, mapUnplacedPath, map[string]any{
			"id": id, "viewID": viewID,
		}, getAttributeViewMapUnplaced)
		requireAPIContract(t, http.MethodPost, mapUnplacedPath, response)
		var result struct{ Code int }
		decodeAttributeViewContextFilterAPIResponse(t, response, &result)
		if result.Code != -1 {
			t.Fatalf("invalid map read was accepted: %s", response.Body.String())
		}
	}
	view.LayoutType, view.Table, view.Map = av.LayoutTypeTable, view.Map.LayoutTable, nil
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	assertFailure(database.ID, view.ID)
	missingID := ast.NewNodeID()
	assertFailure(missingID, view.ID)
	if _, err := os.Stat(av.GetAttributeViewDataPath(missingID)); !os.IsNotExist(err) {
		t.Fatalf("unplaced query created a missing database: %v", err)
	}

	boxID, encryptedID := ast.NewNodeID(), ast.NewNodeID()
	oldEncryptedBoxIDs := av.AVEncryptedBoxIDs
	av.AVEncryptedBoxIDs = func() []string { return []string{boxID} }
	t.Cleanup(func() { av.AVEncryptedBoxIDs = oldEncryptedBoxIDs })
	file := filepath.Join(util.DataDir, boxID, "storage", "av", encryptedID+".json")
	configuration := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	for target, content := range map[string]string{file: "locked ciphertext", configuration: `{"encrypted":true}`} {
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	assertFailure(encryptedID, view.ID)
	after, err := os.ReadFile(file)
	if err != nil || string(after) != "locked ciphertext" {
		t.Fatalf("locked source was changed: %v", err)
	}
}
