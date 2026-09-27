package api

import (
	"net/http"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAVContractConditionalColors(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	database := fixture.attrView
	primary := database.KeyValues[0]
	rowID := ast.NewNodeID()
	primary.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: rowID,
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Colored entry"}}}
	view := database.Views[0]
	view.ItemIDs = []string{rowID}
	view.ConditionalColors = []*av.ConditionalColorRule{{ID: ast.NewNodeID(), Target: "item", Color: &av.ValueSelect{Color: "3"},
		Filter: &av.ViewFilter{Column: primary.Key.ID, Operator: av.FilterOperatorIsNotEmpty, Value: &av.Value{Type: av.KeyTypeBlock}}}}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	assertAVContractJSONEqual(t, view, toContractAVView(view))
	path := "/api/av/renderAttributeView"
	response := callAttributeViewContextFilterAPI(t, path, map[string]any{"id": database.ID, "viewID": view.ID}, renderAttributeView)
	requireAPIContract(t, http.MethodPost, path, response)
	var result struct {
		Code int
		Data struct{ View *av.Table }
	}
	decodeAttributeViewContextFilterAPIResponse(t, response, &result)
	if result.Code != 0 || result.Data.View == nil || len(result.Data.View.Rows) != 1 ||
		len(result.Data.View.ConditionalColors) != 1 || result.Data.View.Rows[0].ConditionalColors == nil ||
		result.Data.View.Rows[0].ConditionalColors.Background.Color != "3" {
		t.Fatalf("conditional color response: %s", response.Body.String())
	}
	assertAVContractJSONEqual(t, result.Data.View, toContractAVTable(result.Data.View))
	colors := result.Data.View.Rows[0].ConditionalColors
	assertAVContractJSONEqual(t, &av.GalleryCard{ConditionalColors: colors}, toContractAVGalleryCard(&av.GalleryCard{ConditionalColors: colors}))
	assertAVContractJSONEqual(t, &av.KanbanCard{ConditionalColors: colors}, toContractAVKanbanCard(&av.KanbanCard{ConditionalColors: colors}))
}
