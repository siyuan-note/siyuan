package api

import (
	"net/http"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAVContractLocationSaveAndRender(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	database, view := fixture.attrView, fixture.attrView.Views[0]
	primary := database.GetBlockKeyValues()
	key := av.NewKey(ast.NewNodeID(), "Location", "", av.KeyTypeLocation)
	key.Location = &av.Location{DefaultCoordinateSystem: "gcj02"}
	coordinatesID, nameID, emptyID, unknownID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	view.ItemIDs = []string{coordinatesID, nameID, emptyID, unknownID}
	for _, id := range view.ItemIDs {
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: id,
			Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: id}})
	}
	database.KeyValues = []*av.KeyValues{primary, {Key: key, Values: []*av.Value{
		{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: emptyID, Type: av.KeyTypeLocation, Location: &av.ValueLocation{}},
		{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: unknownID, Type: av.KeyTypeLocation,
			Location: &av.ValueLocation{CoordinateSystem: "unknown"}},
	}}}
	view.Table.Columns = []*av.ViewTableColumn{
		{BaseField: &av.BaseField{ID: primary.Key.ID}},
		{BaseField: &av.BaseField{ID: key.ID}},
	}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}

	render := func() *av.Table {
		t.Helper()
		const path = "/api/av/renderAttributeView"
		response := callAttributeViewContextFilterAPI(t, path, map[string]any{
			"id": database.ID, "viewID": view.ID, "createIfNotExist": false,
		}, renderAttributeView)
		requireAPIContract(t, http.MethodPost, path, response)
		var result struct {
			Code int
			Data struct{ View *av.Table }
		}
		decodeAttributeViewContextFilterAPIResponse(t, response, &result)
		if result.Code != 0 || result.Data.View == nil || len(result.Data.View.Rows) != len(view.ItemIDs) {
			t.Fatalf("location render failed: %s", response.Body.String())
		}
		for _, column := range result.Data.View.Columns {
			if column.ID == key.ID {
				if column.Location == nil || column.Location.DefaultCoordinateSystem != "gcj02" {
					t.Fatalf("location column default was lost: %+v", column.Location)
				}
				return result.Data.View
			}
		}
		t.Fatal("location column was not rendered")
		return nil
	}
	assertLocation := func(value *av.Value, want *av.ValueLocation) {
		t.Helper()
		if value == nil || value.Type != av.KeyTypeLocation || value.Location == nil {
			t.Fatalf("location payload was lost: %+v", value)
		}
		assertAVContractJSONEqual(t, want, value.Location)
	}
	assertEmptyValues := func(table *av.Table) {
		t.Helper()
		assertLocation(table.GetValue(emptyID, key.ID), &av.ValueLocation{})
		assertLocation(table.GetValue(unknownID, key.ID), &av.ValueLocation{CoordinateSystem: "unknown"})
	}

	// 只给缺少持久化值的单元格应用默认坐标系，已存空值及显式未知值保持原意。
	table := render()
	for _, id := range []string{coordinatesID, nameID} {
		assertLocation(table.GetValue(id, key.ID), &av.ValueLocation{CoordinateSystem: "gcj02"})
	}
	assertEmptyValues(table)
	cache.ClearAVCache()
	stored, err := av.ParseAttributeView(database.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{coordinatesID, nameID} {
		if stored.GetValue(key.ID, id) != nil {
			t.Fatal("rendering persisted a missing location value")
		}
	}

	// 再次渲染后保存新位置，验证渲染操作不影响持久化。
	render()
	zero, longitude := 0.0, 102.42
	saves := []struct {
		itemID   string
		location *av.ValueLocation
	}{
		{coordinatesID, &av.ValueLocation{Name: "Office", Latitude: &zero, Longitude: &longitude,
			CoordinateSystem: "gcj02", OriginalInput: "(102.42,0)"}},
		{nameID, &av.ValueLocation{Name: "Home", CoordinateSystem: "gcj02", OriginalInput: "Home"}},
	}
	for _, save := range saves {
		value, updateErr := model.UpdateAttributeViewCell(nil, database.ID, key.ID, save.itemID,
			&av.Value{Type: av.KeyTypeLocation, Location: save.location})
		if updateErr != nil {
			t.Fatal(updateErr)
		}
		assertLocation(value, save.location)
		if value.IsRenderAutoFill {
			t.Fatal("saved location retained its render-only marker")
		}
	}

	// 清除缓存后重新读取文件，确认保存后的坐标、名称和来源都进入持久化数据及 HTTP 响应。
	cache.ClearAVCache()
	stored, err = av.ParseAttributeView(database.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, save := range saves {
		value := stored.GetValue(key.ID, save.itemID)
		assertLocation(value, save.location)
		if value.IsRenderAutoFill {
			t.Fatal("persisted location retained its render-only marker")
		}
	}
	assertLocation(stored.GetValue(key.ID, emptyID), &av.ValueLocation{})
	assertLocation(stored.GetValue(key.ID, unknownID), &av.ValueLocation{CoordinateSystem: "unknown"})
	table = render()
	for _, save := range saves {
		assertLocation(table.GetValue(save.itemID, key.ID), save.location)
	}
	assertEmptyValues(table)
}
