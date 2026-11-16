// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func avContractPrimaryRichSources(t *testing.T) map[string]*av.ValuePrimaryRich {
	t.Helper()
	dom := `<div data-type="NodeParagraph" data-node-id="20000101000000-primary"><div contenteditable="true"><span data-type="strong">正文 &amp; "quoted"</span> \\text</div></div>`
	tree := util.NewLute().BlockDOM2Tree(dom)
	legacy, err := render.NewDocumentTitle(tree.Root.FirstChild)
	if err != nil {
		t.Fatal(err)
	}
	kramdown, err := av.NewPrimaryRich(tree)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]*av.ValuePrimaryRich{"plain": nil, "inline-ast": av.PrimaryRichFromTitle(legacy), "kramdown": kramdown}
}

func TestAVContractPrimaryRichTransportMapping(t *testing.T) {
	if toContractAVPrimaryRich(nil) != nil || fromContractAVPrimaryRich(nil) != nil ||
		toContractAVValueBlock(nil) != nil || fromContractAVValueBlock(nil) != nil {
		t.Fatal("nil source or block was replaced")
	}
	for name, source := range avContractPrimaryRichSources(t) {
		t.Run(name, func(t *testing.T) {
			value := &av.Value{Type: av.KeyTypeBlock, IsDetached: true,
				Block: &av.ValueBlock{Content: "plain projection", Rich: source}}
			contract := toContractAVValue(value)
			assertAVContractJSONEqual(t, value, contract)
			assertAVContractJSONEqual(t, value, fromContractAVValue(contract))
			encoded, err := json.Marshal(contract.Block)
			if err != nil {
				t.Fatal(err)
			}
			var wire map[string]json.RawMessage
			if err = json.Unmarshal(encoded, &wire); err != nil {
				t.Fatal(err)
			}
			if source == nil {
				if _, present := wire["rich"]; present || contract.Block.Rich != nil {
					t.Fatal("nil rich source must remain omitted", string(encoded))
				}
				return
			}
			if source.Spec != 1 || source.Format != name {
				t.Fatalf("unexpected source fixture: %+v", source)
			}
			want := map[string]any{"spec": float64(source.Spec), "format": source.Format, "content": source.Content}
			var got map[string]any
			if err = json.Unmarshal(wire["rich"], &got); err != nil || !reflect.DeepEqual(want, got) {
				t.Fatalf("rich wire shape changed: %s, %v", encoded, err)
			}
			requestSource := &apicontract.AVValuePrimaryRich{Spec: source.Spec, Format: source.Format, Content: source.Content}
			modelSource := fromContractAVPrimaryRich(requestSource)
			if !reflect.DeepEqual(source, modelSource) || !reflect.DeepEqual(requestSource, toContractAVPrimaryRich(modelSource)) {
				t.Fatal("primary source changed during bidirectional transport")
			}
		})
	}
}

func TestAVContractPrimaryRichHTTPSourceVariants(t *testing.T) {
	for name, source := range avContractPrimaryRichSources(t) {
		t.Run(name, func(t *testing.T) {
			fixture := setupAttributeViewContextFilterAPITest(t)
			database, view := fixture.attrView, fixture.attrView.Views[0]
			primary := database.GetBlockKeyValues()
			itemID := ast.NewNodeID()
			primary.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: itemID,
				Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "**literal**", Rich: source}}}
			view.ItemIDs = []string{itemID}
			if err := av.SaveAttributeView(database); err != nil {
				t.Fatal(err)
			}
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
			if rendered == nil || rendered.Block == nil || !reflect.DeepEqual(source, rendered.Block.Rich) {
				t.Fatal("HTTP rendering changed the primary source", response.Body.String())
			}
		})
	}
}

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
