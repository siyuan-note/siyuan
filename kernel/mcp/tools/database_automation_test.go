// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"encoding/json"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDatabaseItemWritesRunAutomations(t *testing.T) {
	previousLang, previousAVLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "select": "Select", "table": "Table"}}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = previousLang, previousAVLangs })
	previousData, previousConf := util.DataDir, model.Conf
	util.DataDir, model.Conf = t.TempDir(), model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	t.Cleanup(func() { util.DataDir, model.Conf = previousData, previousConf })
	view := av.NewAttributeView(ast.NewNodeID())
	keyID := ast.NewNodeID()
	view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Name: "Result", Type: av.KeyTypeText}})
	for _, trigger := range []string{"added", "changed"} {
		rule := &av.AutomationRule{ID: ast.NewNodeID(), Name: trigger, Enabled: true, Trigger: trigger,
			Actions: []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
				keyID: {Mode: "static", Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: trigger}}},
			}}}}
		if trigger == "changed" {
			rule.KeyID = keyID
		}
		view.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{rule}}
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
		var result CallToolResult
		var err error
		if trigger == "added" {
			result, err = databaseItemAdd(map[string]any{"id": view.ID, "detached": true, "content": "Task"})
		} else {
			result, err = databaseItemUpdate(map[string]any{"id": view.ID, "keyID": keyID,
				"itemID": view.GetBlockKeyValues().Values[0].BlockID, "value": map[string]any{"text": map[string]any{"content": "manual"}}})
		}
		if err != nil || result.IsError {
			t.Fatalf("%s failed: %+v %v", trigger, result, err)
		}
		view, err = av.ParseAttributeView(view.ID)
		if err != nil {
			t.Fatal(err)
		}
		rows := view.GetBlockKeyValues().Values
		if len(rows) != 1 || view.GetValue(keyID, rows[0].BlockID).Text.Content != trigger {
			t.Fatalf("%s automation did not run exactly once: %+v", trigger, view)
		}
		var output struct {
			Data struct {
				ItemID string    `json:"itemID"`
				Value  *av.Value `json:"value"`
			} `json:"data"`
		}
		if err = json.Unmarshal([]byte(result.Content[0].Text), &output); err != nil {
			t.Fatal(err)
		}
		if output.Data.ItemID != rows[0].BlockID || trigger == "changed" && output.Data.Value.Text.Content != trigger {
			t.Fatalf("MCP did not return the committed item and final value: %s", result.Content[0].Text)
		}
	}
}
