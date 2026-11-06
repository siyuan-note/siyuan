// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAPIContractAttributeViewHTTPPreview(t *testing.T) {
	fixture := setupAttributeViewContextFilterAPITest(t)
	key := av.NewKey("20261104000000-httpkey", "HTTP", "", av.KeyTypeTemplate)
	key.Template = `.action{(httpGet "https://example.com/data").error}`
	fixture.attrView.KeyValues = append(fixture.attrView.KeyValues, &av.KeyValues{Key: key})
	fixture.attrView.Views[0].Table.Columns = append(fixture.attrView.Views[0].Table.Columns,
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
	primary := fixture.attrView.GetBlockKeyValues()
	rowID := "20261104000000-httprow"
	primary.Values = append(primary.Values, &av.Value{ID: "20261104000000-httpval", KeyID: primary.Key.ID,
		BlockID: rowID, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Available"}})
	fixture.attrView.Views[0].ItemIDs = []string{rowID}
	if err := av.SaveAttributeView(fixture.attrView); err != nil {
		t.Fatal(err)
	}
	for _, preview := range []bool{true, false} {
		response := callAttributeViewContextFilterAPI(t, "/api/av/renderAttributeView", map[string]any{
			"id": fixture.attrView.ID, "viewID": fixture.attrView.Views[0].ID,
			"createIfNotExist": false, "deferHTTPTemplates": preview,
		}, renderAttributeView)
		requireAPIContract(t, "POST", "/api/av/renderAttributeView", response)
		var result struct {
			Code int
			Data struct {
				PendingHTTPTemplates []string
				View                 av.Table
			}
		}
		decodeAttributeViewContextFilterAPIResponse(t, response, &result)
		if result.Code != 0 || len(result.Data.View.Rows) != 1 {
			t.Fatalf("preview=%v response=%s", preview, response.Body.String())
		}
		value := result.Data.View.Rows[0].GetValue(key.ID).Template.Content
		if preview {
			if len(result.Data.PendingHTTPTemplates) != 1 || result.Data.PendingHTTPTemplates[0] != key.ID || value != "" {
				t.Fatalf("invalid loading response: %s", response.Body.String())
			}
		} else if len(result.Data.PendingHTTPTemplates) != 0 || value != "interaction_required" {
			t.Fatalf("synchronous background semantics changed: %s", response.Body.String())
		}
	}
}
