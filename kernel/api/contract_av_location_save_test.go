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
	coordinatesID, nameID, emptyID, zeroID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	zero, longitude := 0.0, 102.42
	view.ItemIDs = []string{coordinatesID, nameID, emptyID, zeroID}
	for _, id := range view.ItemIDs {
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: id,
			Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: id}})
	}
	database.KeyValues = []*av.KeyValues{primary, {Key: key, Values: []*av.Value{
		{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: emptyID, Type: av.KeyTypeLocation, Location: &av.ValueLocation{}},
		{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: zeroID, Type: av.KeyTypeLocation,
			Location: &av.ValueLocation{Latitude: &zero, Longitude: &zero}},
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
				if column.Type != av.KeyTypeLocation {
					t.Fatalf("location column type was lost: %+v", column)
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
	assertStoredValues := func(table *av.Table) {
		t.Helper()
		assertLocation(table.GetValue(emptyID, key.ID), &av.ValueLocation{})
		assertLocation(table.GetValue(zeroID, key.ID), &av.ValueLocation{Latitude: &zero, Longitude: &zero})
	}

	// 渲染补齐缺失单元格，不改变已存空值或零坐标。
	table := render()
	for _, id := range []string{coordinatesID, nameID} {
		assertLocation(table.GetValue(id, key.ID), &av.ValueLocation{})
	}
	assertStoredValues(table)
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
	saves := []struct {
		itemID   string
		location *av.ValueLocation
	}{
		{coordinatesID, &av.ValueLocation{Name: "Office", Latitude: &zero, Longitude: &longitude,
			OriginalInput: "(102.42,0)"}},
		{nameID, &av.ValueLocation{Name: "Home", OriginalInput: "Home"}},
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
	assertLocation(stored.GetValue(key.ID, zeroID), &av.ValueLocation{Latitude: &zero, Longitude: &zero})
	table = render()
	for _, save := range saves {
		assertLocation(table.GetValue(save.itemID, key.ID), save.location)
	}
	assertStoredValues(table)
}
