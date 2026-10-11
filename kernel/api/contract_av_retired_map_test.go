package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
)

func TestAVContractRetiredMapRoutesAbsent(t *testing.T) {
	engine := gin.New()
	ServeAPI(engine)
	for _, route := range engine.Routes() {
		if route.Path == "/api/map/getRuntime" || route.Path == "/api/av/getAttributeViewMapUnplaced" {
			t.Fatalf("retired map handler still registered: %s", route.Path)
		}
	}
}

func TestAVContractRetiredMapRendersTableWithLocation(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	database := fixture.attrView
	view := database.Views[0]
	itemID := ast.NewNodeID()
	key := av.NewKey(ast.NewNodeID(), "Location", "", av.KeyTypeLocation)
	zero, longitude := 0.0, 120.0
	primary := database.GetBlockKeyValues()
	primary.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: itemID,
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Office"}}}
	database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: key, Values: []*av.Value{{
		ID: ast.NewNodeID(), KeyID: key.ID, BlockID: itemID, Type: av.KeyTypeLocation,
		Location: &av.ValueLocation{Name: "Office", Latitude: &zero, Longitude: &longitude, OriginalInput: "120,0"},
	}}})
	view.ItemIDs = []string{itemID}
	view.Filters = nil
	view.Table.Columns = []*av.ViewTableColumn{
		{BaseField: &av.BaseField{ID: primary.Key.ID}}, {BaseField: &av.BaseField{ID: key.ID}},
	}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	legacy, err := json.Marshal(struct {
		*av.LayoutTable
		Settings map[string]any `json:"settings"`
	}{view.Table, map[string]any{"locationKeyID": key.ID, "height": 640, "unknown": "preserve"}})
	if err != nil {
		t.Fatal(err)
	}
	view.LegacyMap, view.Table, view.LayoutType = legacy, nil, "map"
	input, err := json.Marshal(database)
	if err != nil {
		t.Fatal(err)
	}
	file := av.GetAttributeViewDataPath(database.ID)
	if err = os.WriteFile(file, input, 0644); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	response := renderAttrView("", database.ID, view.ID, "", 1, 50, nil, "", false, false, "", "", func(view av.Viewable) av.Viewable { return view }, false)
	data, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Code int
		Data struct {
			ViewType string
			View     *av.Table
		}
	}
	if err = json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if result.Code != 0 || result.Data.ViewType != "table" || result.Data.View == nil || len(result.Data.View.Rows) != 1 {
		t.Fatalf("legacy map did not render records as a table: %s", data)
	}
	location := result.Data.View.Rows[0].GetValue(key.ID).Location
	if location == nil || location.Name != "Office" || *location.Latitude != zero || *location.Longitude != longitude || location.OriginalInput != "120,0" {
		t.Fatalf("location field changed: %+v", location)
	}
	for _, forbidden := range [][]byte{[]byte(`"map":`), []byte(`"mapMarkerScope":`), []byte(`"type":"map"`)} {
		if bytes.Contains(data, forbidden) {
			t.Fatalf("retired map configuration leaked into response: %s", data)
		}
	}
	after, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(after, input) {
		t.Fatal("read-only rendering rewrote the legacy source")
	}
	stored, err := av.ParseAttributeView(database.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = av.SaveAttributeView(stored); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	stored, err = av.ParseAttributeView(database.ID)
	if err != nil {
		t.Fatalf("save lost legacy map configuration: %v", err)
	}
	var beforeLegacy, afterLegacy any
	if err = json.Unmarshal(legacy, &beforeLegacy); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(stored.Views[0].LegacyMap, &afterLegacy); err != nil || !reflect.DeepEqual(beforeLegacy, afterLegacy) {
		t.Fatalf("save changed legacy map settings: %v", err)
	}
	// 除只读渲染外，同时覆盖注册的 HTTP 适配器。
	path := "/api/av/renderAttributeView"
	httpResponse := callAttributeViewContextFilterAPI(t, path, map[string]any{"id": database.ID, "viewID": view.ID}, renderAttributeView)
	requireAPIContract(t, http.MethodPost, path, httpResponse)
}
