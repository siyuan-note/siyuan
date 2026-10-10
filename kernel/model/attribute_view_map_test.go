package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupMapTest(t *testing.T) (*av.AttributeView, *av.View) {
	setupAttributeViewValidationTest(t)
	setAttributeViewListTestLangs()
	util.AttrViewLangs["en"]["map"] = "Map"
	util.AttrViewLangs["en"]["calendar"] = "Calendar"
	attrView := newAttributeViewWithLayout(ast.NewNodeID(), av.LayoutTypeMap)
	return attrView, attrView.Views[0]
}

func TestAttributeViewMapSettingsFieldsAndClone(t *testing.T) {
	attrView, view := setupMapTest(t)
	if view.Map.Settings.LocationKeyID != "" {
		t.Fatal("new map must retain an explicit unbound state")
	}
	key := av.NewKey(ast.NewNodeID(), "Place", "", av.KeyTypeLocation)
	addAttributeViewKey(attrView, view, key, "")
	view.Map.Settings.LocationKeyID = key.ID
	view.Group = &av.ViewGroup{Field: attrView.KeyValues[1].Key.ID}
	if getAttributeViewField(view, key.ID) == nil || view.IsGroupView() {
		t.Fatal("map field or grouping state is incorrect")
	}
	layout := view.Map
	for _, typ := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeCalendar, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		if err := changeAttrViewLayout(attrView, view, typ); err != nil {
			t.Fatal(err)
		}
		if err := changeAttrViewLayout(attrView, view, av.LayoutTypeMap); err != nil {
			t.Fatal(err)
		}
		if layout != view.Map || view.Map.Settings.LocationKeyID != key.ID || view.Group == nil {
			t.Fatal("layout switch lost map settings or stored grouping")
		}
	}
	cloned := av.NewMapView()
	if err := cloneAttributeViewLayouts(cloned, view); err != nil {
		t.Fatal(err)
	}
	cloned.Map.Columns[0].Hidden = true
	if view.Map.Columns[0].Hidden || view.Map.ID == cloned.Map.ID {
		t.Fatal("map layout clone is not independent")
	}
	copy := attrView.Clone()
	if copy == nil {
		t.Fatal("map database clone failed")
	}
	copySettings := copy.Views[0].Map.Settings
	copyKey, err := copy.GetKey(copySettings.LocationKeyID)
	if err != nil || copyKey.Type != av.KeyTypeLocation || copyKey.ID == key.ID {
		t.Fatal("clone did not remap its own location field")
	}
	if err = av.SaveAttributeView(attrView); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	stored, err := av.ParseAttributeView(attrView.ID)
	if err != nil || stored.Spec != av.MapSpec || !reflect.DeepEqual(stored.Views[0].Map, view.Map) {
		t.Fatalf("map roundtrip: %v", err)
	}
	removeAttributeViewFieldDefinition(attrView, key.ID)
	if view.Map.Settings.LocationKeyID != key.ID || getAttributeViewField(view, key.ID) != nil {
		t.Fatal("deleting field changed the saved binding")
	}
	if err = setAttributeViewFieldsHidden(attrView, attrView.GetBlockKeyValues().Key.ID, []string{view.ID}, true); err == nil {
		t.Fatal("map primary field must remain visible")
	}
}

func TestAttributeViewMapFilterSortPageTargetAndExport(t *testing.T) {
	attrView, view := setupMapTest(t)
	key := av.NewKey(ast.NewNodeID(), "Place", "", av.KeyTypeLocation)
	addAttributeViewKey(attrView, view, key, "")
	view.Map.Settings.LocationKeyID = key.ID
	view.PageSize = 10
	for _, column := range view.Map.Columns {
		if column.ID == key.ID {
			column.Hidden = true
		}
	}
	values, _ := attrView.GetKeyValues(key.ID)
	primary := attrView.GetBlockKeyValues()
	for i := 0; i < 125; i++ {
		id := ast.NewNodeID()
		view.ItemIDs = append(view.ItemIDs, id)
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: id,
			Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: fmt.Sprintf("Record %03d", i)}})
		value := &av.Value{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: id, Type: av.KeyTypeLocation}
		if i < 120 {
			zero := 0.0
			value.Location = &av.ValueLocation{Name: fmt.Sprintf("Place %03d", i), Latitude: &zero, Longitude: &zero}
		}
		values.Values = append(values.Values, value)
	}
	view.Sorts = []*av.ViewSort{{Column: key.ID, Order: av.SortOrderDesc}}
	view.Filters = []*av.ViewFilter{{Column: key.ID, Operator: av.FilterOperatorIsNotEmpty, Value: &av.Value{Type: av.KeyTypeLocation}}}
	for _, page := range []int{1, 2, 12} {
		mapped := sql.RenderView(attrView, view, "", false).(*av.Map)
		if _, _, err := renderViewableInstance(mapped, view, attrView, page, 10, false, "", sql.NewAttributeViewRenderContext()); err != nil {
			t.Fatal(err)
		}
		if len(mapped.Rows) != 10 || mapped.RowCount != 120 || mapped.Rows[0].ID != view.ItemIDs[129-page*10] ||
			mapped.MapMarkerScope != "page" || mapped.Map.LocationKeyID != key.ID {
			t.Fatalf("page %d did not follow ordinary filtered/sorted rows: %+v", page, mapped.Table)
		}
		if value := mapped.Rows[0].GetValue(key.ID); value == nil || value.Location == nil || *value.Location.Latitude != 0 {
			t.Fatal("hidden location value or zero coordinate was lost")
		}
	}
	mapped := sql.RenderView(attrView, view, "", false).(*av.Map)
	index, offset, err := renderViewableInstance(mapped, view, attrView, 1, 10, false, view.ItemIDs[24], sql.NewAttributeViewRenderContext())
	if err != nil || index != 95 || offset != 0 || len(mapped.Rows) != 120 {
		t.Fatalf("map target did not locate its page: %d %d %v", index, offset, err)
	}
	before, _ := json.Marshal(view.Map)
	exported := getAttrViewTable(attrView, view, "")
	after, _ := json.Marshal(view.Map)
	if len(exported.Rows) != 125 || exported.Map != nil || !bytes.Equal(before, after) {
		t.Fatal("map export must contain all ordinary records without map layout data or layout mutations")
	}
}

func TestAttributeViewMapInvalidSavePreservesSource(t *testing.T) {
	attrView, view := setupMapTest(t)
	if err := av.SaveAttributeView(attrView); err != nil {
		t.Fatal(err)
	}
	path := av.GetAttributeViewDataPath(attrView.ID)
	before, _ := os.ReadFile(path)
	for _, malformed := range []any{nil, map[string]any{}, map[string]any{"serviceID": "", "locationKeyID": "", "showRecordList": true, "apiKey": "not-allowed"},
		map[string]any{"locationKeyID": "", "serviceID": "openfreemap"}, map[string]any{"locationKeyID": "", "showRecordList": false}, av.MapSettings{LocationKeyID: "invalid"}} {
		if err := setAttrViewMap(&Operation{AvID: attrView.ID, ViewID: view.ID, Data: malformed}); err == nil {
			t.Fatalf("invalid settings accepted: %#v", malformed)
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(before, after) {
			t.Fatal("invalid settings changed source")
		}
	}
	view.Map = nil
	if err := av.SaveAttributeView(attrView); err == nil {
		t.Fatal("missing map layout accepted")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("invalid layout changed source")
	}
	if _, err := isolateImportedAttributeViewBindings([]byte(`{"spec":13,"views":[{"type":"map"}]}`), nil, false); err == nil {
		t.Fatal("import accepted a damaged map layout")
	}
}

func TestAttributeViewMapImportAndHistoryPreserveBindings(t *testing.T) {
	t.Run("empty", func(t *testing.T) { testAttributeViewMapImportAndHistoryPreserveBindings(t, false) })
	t.Run("populated", func(t *testing.T) { testAttributeViewMapImportAndHistoryPreserveBindings(t, true) })
}

func testAttributeViewMapImportAndHistoryPreserveBindings(t *testing.T, populated bool) {
	attrView, view := setupMapTest(t)
	oldHistory := util.HistoryDir
	util.HistoryDir = t.TempDir()
	t.Cleanup(func() { util.HistoryDir = oldHistory })
	view.Map.Settings = av.MapSettings{LocationKeyID: ast.NewNodeID()}
	if populated {
		primary := attrView.GetBlockKeyValues()
		itemID := ast.NewNodeID()
		primary.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: itemID,
			Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Map import record"}}}
		view.ItemIDs = []string{itemID}
	}
	if err := av.SaveAttributeView(attrView); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(attrView)
	if err != nil {
		t.Fatal(err)
	}
	for _, encrypted := range []bool{false, true} {
		imported, err := isolateImportedAttributeViewBindings(data, nil, encrypted)
		if err != nil || !bytes.Equal(data, imported) {
			t.Fatalf("import changed valid missing map bindings: %v", err)
		}
	}
	created := time.Unix(1791514800, 0)
	path := filepath.Join(util.HistoryDir, created.Format("2006-01-02-150405")+"-update", "storage", "av", attrView.ID+".json")
	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	rendered, _, err := RenderHistoryAttributeView(attrView.ID, view.ID, "", "", 1, 10, nil, strconv.FormatInt(created.Unix(), 10))
	if err != nil {
		t.Fatal(err)
	}
	mapped, ok := rendered.(*av.Map)
	if !ok || mapped.Map == nil || *mapped.Map != view.Map.Settings || mapped.MapMarkerScope != "page" {
		t.Fatal("history lost map bindings")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(data, after) {
		t.Fatal("history rendering changed its source")
	}
	settingsData, err := json.Marshal(view.Map.Settings)
	if err != nil {
		t.Fatal(err)
	}
	var invalidInputs [][]byte
	for _, extra := range []string{`"serviceID":"openfreemap"`, `"serviceID":""`, `"showRecordList":true`, `"showRecordList":false`} {
		legacySettings := []byte(`{"locationKeyID":"` + view.Map.Settings.LocationKeyID + `",` + extra + `}`)
		invalid := bytes.Replace(data, settingsData, legacySettings, 1)
		if bytes.Equal(invalid, data) {
			t.Fatal("legacy map settings fixture did not replace settings")
		}
		invalidInputs = append(invalidInputs, invalid)
	}
	for _, spec := range []int{11, 12, av.MapSpec, av.CurrentSpec + 1} {
		attrView.Spec = spec
		view.Map.Spec = 1
		invalid, _ := json.Marshal(attrView)
		invalidInputs = append(invalidInputs, invalid)
	}
	for _, invalid := range invalidInputs {
		if _, err = parseHistoricalAttributeViewData(attrView.ID, invalid); err == nil {
			t.Fatal("history accepted malformed or unknown map format")
		}
		for _, encrypted := range []bool{false, true} {
			if _, err = isolateImportedAttributeViewBindings(invalid, nil, encrypted); err == nil {
				t.Fatal("import accepted malformed or unknown map format")
			}
		}
		if err = os.WriteFile(path, invalid, 0600); err != nil {
			t.Fatal(err)
		}
		if _, _, err = RenderHistoryAttributeView(attrView.ID, view.ID, "", "", 1, 10, nil, strconv.FormatInt(created.Unix(), 10)); err == nil {
			t.Fatal("history rendering accepted malformed or unknown map format")
		}
		after, readErr := os.ReadFile(path)
		if readErr != nil || !bytes.Equal(invalid, after) {
			t.Fatal("rejected history rendering changed its source")
		}
	}
}

func TestAttributeViewMapAndLocationImportOmittedValues(t *testing.T) {
	setupMapTest(t)
	for _, scenario := range []struct {
		name   string
		layout av.LayoutType
		loc    bool
	}{
		{"map", av.LayoutTypeMap, false},
		{"location", av.LayoutTypeTable, true},
		{"legacy table", av.LayoutTypeTable, false},
		{"legacy calendar", av.LayoutTypeCalendar, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			database := newAttributeViewWithLayout(ast.NewNodeID(), scenario.layout)
			if scenario.loc {
				database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: av.NewKey(ast.NewNodeID(), "Location", "", av.KeyTypeLocation)})
			}
			if err := av.SaveAttributeView(database); err != nil {
				t.Fatal(err)
			}
			data, err := json.Marshal(database)
			if err != nil {
				t.Fatal(err)
			}
			var root map[string]json.RawMessage
			if err = json.Unmarshal(data, &root); err != nil {
				t.Fatal(err)
			}
			var keyValues []map[string]json.RawMessage
			if err = json.Unmarshal(root["keyValues"], &keyValues); err != nil {
				t.Fatal(err)
			}
			for _, values := range []string{"", "null", "[]", "{}", `"invalid"`} {
				delete(keyValues[0], "values")
				if values != "" {
					keyValues[0]["values"] = json.RawMessage(values)
				}
				root["keyValues"], err = json.Marshal(keyValues)
				if err != nil {
					t.Fatal(err)
				}
				input, err := json.Marshal(root)
				if err != nil {
					t.Fatal(err)
				}
				for _, encrypted := range []bool{false, true} {
					t.Run(fmt.Sprintf("values=%q/encrypted=%t", values, encrypted), func(t *testing.T) {
						before := bytes.Clone(input)
						got, importErr := isolateImportedAttributeViewBindings(input, nil, encrypted)
						if !bytes.Equal(input, before) {
							t.Fatal("import changed the source JSON")
						}
						wantSuccess := values == "null" || values == "[]" || values == ""
						if wantSuccess && (importErr != nil || !bytes.Equal(got, input)) {
							t.Fatalf("rejected or rewrote valid empty data: %v", importErr)
						}
						if !wantSuccess && importErr == nil {
							t.Fatal("accepted malformed data")
						}
					})
				}
			}
		})
	}
}
