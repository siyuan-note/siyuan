// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAVContractPrimaryRichSourceAndPreview(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	database, view := fixture.attrView, fixture.attrView.Views[0]
	primary := database.GetBlockKeyValues()
	itemID := ast.NewNodeID()
	primary.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: itemID,
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "**literal**"}}}
	view.ItemIDs = []string{itemID}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	dom := `<div data-type="NodeParagraph" data-node-id="20000101000000-primary"><div contenteditable="true"><span data-type="strong">Rich</span></div></div>`
	value, err := model.UpdateAttributeViewCell(nil, database.ID, primary.Key.ID, itemID,
		map[string]any{"block": map[string]any{"richBlockDOM": dom}})
	if err != nil {
		t.Fatal(err)
	}
	assertAVContractJSONEqual(t, value, toContractAVValue(value))
	assertAVContractJSONEqual(t, value, fromContractAVValue(toContractAVValue(value)))
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
	if result.Code != 0 || result.Data.View == nil {
		t.Fatal(response.Body.String())
	}
	rendered := result.Data.View.GetValue(itemID, primary.Key.ID)
	if rendered == nil || rendered.Block.Rich == nil || rendered.Block.Content != "Rich" ||
		rendered.Block.Rich.Content != value.Block.Rich.Content || !strings.Contains(rendered.Block.RichBlockDOM, `data-type="strong"`) {
		t.Fatal("HTTP rendering lost the complete primary source", response.Body.String())
	}
}
