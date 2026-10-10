package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAVContractAutomationWrites(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_AV_AUTOMATION_CONTRACT") != "1" {
		// 实际写入使用独立进程，隔离数据库索引和异步队列。
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAVContractAutomationWrites$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_AV_AUTOMATION_CONTRACT=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("automation API subprocess failed: %v\n%s", err, output)
		}
		return
	}
	fixture := setupAttributeViewContextFilterAPITest(t)
	util.TempDir, util.ConfDir, util.HistoryDir, util.QueueDir = t.TempDir(), t.TempDir(), t.TempDir(), t.TempDir()
	languageData, err := os.ReadFile("../../app/appearance/langs/en.json")
	if err != nil {
		t.Fatal(err)
	}
	var language struct {
		Time map[string]any `json:"_time"`
	}
	if err = json.Unmarshal(languageData, &language); err != nil {
		t.Fatal(err)
	}
	util.TimeLangs["en"] = language.Time
	model.Conf.Search, model.Conf.Editor, model.Conf.Export = conf.NewSearch(), conf.NewEditor(), conf.NewExport()
	tree, err := model.LoadTreeByBlockID(fixture.databaseID)
	if err != nil {
		t.Fatal(err)
	}
	util.DBPath = filepath.Join(t.TempDir(), util.DBName)
	util.HistoryDBPath = filepath.Join(t.TempDir(), "history.db")
	util.AssetContentDBPath = filepath.Join(t.TempDir(), "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	treenode.UpsertBlockTree(tree)
	defer func() {
		time.Sleep(700 * time.Millisecond)
		sql.FlushQueue()
		sql.CloseDatabase()
	}()
	database := fixture.attrView
	statusID := database.KeyValues[1].Key.ID
	rule := func(trigger, keyID, targetID string, value *av.Value) *av.AutomationRule {
		return &av.AutomationRule{ID: ast.NewNodeID(), Name: trigger, Enabled: true, Trigger: trigger, KeyID: keyID,
			Actions: []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
				targetID: {Mode: "static", Value: value},
			}}}}
	}
	config := &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{
		rule("added", "", fixture.textKeyID, &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "created"}}),
		rule("changed", fixture.textKeyID, statusID, &av.Value{Type: av.KeyTypeSelect, MSelect: []*av.ValueSelect{{Content: "updated", Color: "1"}}}),
	}}
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "setAttrViewAutomations",
		AvID: database.ID, BlockID: fixture.databaseID, Data: config}}); err != nil {
		t.Fatal(err)
	}
	call := func(path string, payload map[string]any, handler gin.HandlerFunc) {
		t.Helper()
		response := callAttributeViewContextFilterAPI(t, path, payload, handler)
		requireAPIContract(t, http.MethodPost, path, response)
		var result struct{ Code int }
		decodeAttributeViewContextFilterAPIResponse(t, response, &result)
		if result.Code != 0 {
			t.Fatalf("automation API failed: %s", response.Body.String())
		}
	}
	call("/api/av/getAttributeView", map[string]any{"id": database.ID}, getAttributeView)
	itemID := ast.NewNodeID()
	call("/api/av/addAttributeViewBlocks", map[string]any{"avID": database.ID,
		"ignoreDefaultFill": true, "srcs": []map[string]any{{"id": itemID, "itemID": itemID, "isDetached": true, "content": "Entry"}},
	}, addAttributeViewBlocks)
	stored, err := av.ParseAttributeView(database.ID)
	if err != nil || stored.GetValue(fixture.textKeyID, itemID).Text.Content != "created" {
		t.Fatalf("add API did not trigger automation: %v", err)
	}
	if status := stored.GetValue(statusID, itemID); status != nil && len(status.MSelect) > 0 {
		t.Fatal("automatic text update chained into another rule")
	}
	for _, batch := range []bool{false, true} {
		stored, _ = av.ParseAttributeView(database.ID)
		stored.KeyValues[1].Values = nil
		if err = av.SaveAttributeView(stored); err != nil {
			t.Fatal(err)
		}
		value := map[string]any{"text": map[string]any{"content": "single"}}
		if batch {
			value = map[string]any{"text": map[string]any{"content": "batch"}}
			call("/api/av/batchSetAttributeViewBlockAttrs", map[string]any{"avID": database.ID,
				"values": []map[string]any{{"keyID": fixture.textKeyID, "itemID": itemID, "value": value}},
			}, batchSetAttributeViewBlockAttrs)
		} else {
			call("/api/av/setAttributeViewBlockAttr", map[string]any{"avID": database.ID,
				"keyID": fixture.textKeyID, "itemID": itemID, "value": value,
			}, setAttributeViewBlockAttr)
		}
		stored, _ = av.ParseAttributeView(database.ID)
		if status := stored.GetValue(statusID, itemID); status == nil || len(status.MSelect) != 1 || status.MSelect[0].Content != "updated" {
			t.Fatalf("cell API did not trigger automation (batch=%v)", batch)
		}
	}
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "removeAttrViewCol", AvID: database.ID,
		BlockID: fixture.databaseID, ID: statusID}}); err != nil {
		t.Fatal(err)
	}
	call("/api/av/setAttributeViewBlockAttr", map[string]any{"avID": database.ID,
		"keyID": fixture.textKeyID, "itemID": itemID, "value": map[string]any{"text": map[string]any{"content": "after deletion"}},
	}, setAttributeViewBlockAttr)
	stored, err = av.ParseAttributeView(database.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Automations.Rules[1].Enabled || stored.Automations.Rules[1].Actions[0].Fields[statusID] == nil ||
		stored.GetValue(fixture.textKeyID, itemID).Text.Content != "after deletion" {
		t.Fatal("deleted action field blocked the API edit or discarded the rule configuration")
	}
	call("/api/av/batchSetAttributeViewBlockAttrs", map[string]any{"avID": database.ID,
		"values": []map[string]any{{"keyID": fixture.textKeyID, "itemID": itemID,
			"value": map[string]any{"text": map[string]any{"content": "later batch"}}}},
	}, batchSetAttributeViewBlockAttrs)
}
