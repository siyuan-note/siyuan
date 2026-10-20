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
	"github.com/siyuan-note/siyuan/kernel/apicontract"
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
	{
		confSectionValue0, confSectionValue1, confSectionValue2 := conf.NewSearch(), conf.NewEditor(), conf.NewExport()
		model.Conf.Search.Store(confSectionValue0)
		model.Conf.Editor.Store(confSectionValue1)
		model.Conf.Export.Store(confSectionValue2)
	}
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
	call("/api/av/previewAttributeViewTemplate", map[string]any{"avID": database.ID, "itemID": itemID,
		"keyID": fixture.textKeyID, "timeZone": "Asia/Shanghai", "triggerTime": "2026-10-16T15:30",
		"template": `.action{now | date "2006-01-02"}`}, previewAttributeViewTemplate)
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

	collection := &av.AutomationRule{ID: ast.NewNodeID(), Name: "Collect blocks", Enabled: true, Trigger: "block",
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{tree.ID}, Types: []string{"p"}, Tags: []string{"collect"}},
		Actions: []*av.AutomationAction{{Type: "collect", Target: "current", Fields: map[string]*av.AutomationValue{
			fixture.textKeyID: {Mode: "static", Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "collected"}}},
		}}}}
	notify := false
	collection.NotifyOnSuccess = &notify
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "setAttrViewAutomations", AvID: database.ID,
		Data: &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{collection}}}}); err != nil {
		t.Fatal(err)
	}
	t.Run("collection broadcast", func(t *testing.T) { testAutomationCollectionBroadcast(t, fixture) })
	call("/api/av/getAttributeView", map[string]any{"id": database.ID}, getAttributeView)
	call("/api/av/previewAttributeViewCollection", map[string]any{"avID": database.ID, "ruleID": collection.ID}, previewAttributeViewCollection)
	call("/api/block/appendBlock", map[string]any{"parentID": tree.ID, "dataType": "markdown", "data": "Source #collect#"}, appendBlock)
	stored, err = av.ParseAttributeView(database.ID)
	if err != nil {
		t.Fatal(err)
	}
	var collected *av.Value
	for _, row := range stored.GetBlockKeyValues().Values {
		if row.Block.CollectionRuleID == collection.ID {
			collected = row
			break
		}
	}
	if collected == nil || stored.GetValue(fixture.textKeyID, collected.BlockID).Text.Content != "collected" {
		t.Fatal("block append API did not collect and initialize its source")
	}
	call("/api/av/getAttributeView", map[string]any{"id": database.ID}, getAttributeView)
	call("/api/av/previewAttributeViewCollection", map[string]any{"avID": database.ID, "ruleID": collection.ID, "page": 1}, previewAttributeViewCollection)
	call("/api/block/updateBlock", map[string]any{"id": collected.Block.ID, "dataType": "markdown", "data": "Source without tag"}, updateBlock)
	stored, _ = av.ParseAttributeView(database.ID)
	if stored.GetBlockValue(collected.BlockID) == nil {
		t.Fatal("block update API removed an existing entry after mismatch")
	}
	collection.BlockSource.Tags = nil
	collection.BlockSource.Attributes = []*av.AutomationBlockAttribute{{Name: "custom-collect", Operator: "equals", Value: "yes"}}
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "setAttrViewAutomations", AvID: database.ID,
		Data: &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{collection}}}}); err != nil {
		t.Fatal(err)
	}
	call("/api/attr/setBlockAttrs", map[string]any{"id": collected.Block.ID, "attrs": map[string]string{"custom-collect": "yes"}}, setBlockAttrs)
	stored, _ = av.ParseAttributeView(database.ID)
	if stored.GetBlockValueByBoundID(collected.Block.ID) == nil {
		t.Fatal("attribute API did not collect a matching block")
	}
	call("/api/attr/batchSetBlockAttrs", map[string]any{"blockAttrs": []map[string]any{{"id": collected.Block.ID, "attrs": map[string]string{"custom-collect": ""}}}}, batchSetBlockAttrs)
	stored, _ = av.ParseAttributeView(database.ID)
	if stored.GetBlockValueByBoundID(collected.Block.ID) == nil {
		t.Fatal("batch attribute API removed a preserved row")
	}
	collection.BlockSource.Attributes = nil
	collection.BlockSource.Types = []string{"h:h1"}
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "setAttrViewAutomations", AvID: database.ID,
		Data: &av.AutomationConfig{Spec: 3, Rules: []*av.AutomationRule{collection}}}}); err != nil {
		t.Fatal(err)
	}
	call("/api/av/getAttributeView", map[string]any{"id": database.ID}, getAttributeView)
	call("/api/block/appendBlock", map[string]any{"parentID": tree.ID, "dataType": "markdown", "data": "# Collected heading"}, appendBlock)
	stored, _ = av.ParseAttributeView(database.ID)
	var heading *av.Value
	for _, row := range stored.GetBlockKeyValues().Values {
		if row.Block.CollectionRuleID == collection.ID && row.Block.ID != collected.Block.ID {
			heading = row
			break
		}
	}
	if heading == nil {
		t.Fatal("heading subtype did not collect")
	}
	preview, err := model.PreviewAttributeViewCollection(database.ID, collection.ID, 1)
	if err != nil || len(preview.Blocks) != 1 || preview.Blocks[0].ID != heading.Block.ID {
		t.Fatalf("subtype preview: %+v %v", preview, err)
	}
	call("/api/block/updateBlock", map[string]any{"id": heading.Block.ID, "dataType": "markdown", "data": "## Collected heading"}, updateBlock)
	stored, _ = av.ParseAttributeView(database.ID)
	if stored.GetBlockValueByBoundID(heading.Block.ID) == nil {
		t.Fatal("heading subtype change removed a preserved row")
	}
	preview, err = model.PreviewAttributeViewCollection(database.ID, collection.ID, 1)
	if err != nil || len(preview.Blocks) != 0 {
		t.Fatalf("unmatched subtype preview: %+v %v", preview, err)
	}
	collection.BlockSource.Types = []string{"d"}
	collection.BlockSource.Tags, collection.BlockSource.TagMatch = []string{"collect", "other"}, "or"
	collection.BlockSource.Attributes = []*av.AutomationBlockAttribute{{Name: "custom-state", Operator: "equals", Value: "ready"}, {Name: "custom-flag", Operator: "exists"}}
	collection.BlockSource.AttributeMatch = "or"
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "setAttrViewAutomations", AvID: database.ID,
		Data: &av.AutomationConfig{Spec: 3, Rules: []*av.AutomationRule{collection}}}}); err != nil {
		t.Fatal(err)
	}
	call("/api/av/getAttributeView", map[string]any{"id": database.ID}, getAttributeView)
	call("/api/attr/setBlockAttrs", map[string]any{"id": tree.ID, "attrs": map[string]string{"tags": "other", "custom-state": "ready"}}, setBlockAttrs)
	stored, _ = av.ParseAttributeView(database.ID)
	if stored.GetBlockValueByBoundID(tree.ID) == nil {
		t.Fatal("OR groups did not collect a matching document")
	}
	call("/api/attr/setBlockAttrs", map[string]any{"id": tree.ID, "attrs": map[string]string{"custom-state": "blocked"}}, setBlockAttrs)
	stored, _ = av.ParseAttributeView(database.ID)
	if stored.GetBlockValueByBoundID(tree.ID) == nil {
		t.Fatal("OR mismatch removed a preserved document")
	}
	collection.BlockSource = &av.AutomationBlockSource{DocumentIDs: []string{tree.ID}, Types: []string{"b"},
		Tags: []string{"collect"}, TagTarget: "container"}
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "setAttrViewAutomations", AvID: database.ID,
		Data: &av.AutomationConfig{Spec: 4, Rules: []*av.AutomationRule{collection}}}}); err != nil {
		t.Fatal(err)
	}
	response := callAttributeViewContextFilterAPI(t, "/api/av/getAttributeView", map[string]any{"id": database.ID}, getAttributeView)
	requireAPIContract(t, http.MethodPost, "/api/av/getAttributeView", response)
	var readBack struct {
		Data struct {
			AV struct{ Automations av.AutomationConfig }
		}
	}
	if err = json.Unmarshal(response.Body.Bytes(), &readBack); err != nil ||
		readBack.Data.AV.Automations.Spec != 4 || len(readBack.Data.AV.Automations.Rules) != 1 ||
		readBack.Data.AV.Automations.Rules[0].BlockSource.TagTarget != "container" {
		t.Fatalf("tag target contract round trip: %s %v", response.Body.String(), err)
	}
	call("/api/block/appendBlock", map[string]any{"parentID": tree.ID, "dataType": "markdown", "data": "> First #collect#\n>\n> Second #collect#"}, appendBlock)
	stored, _ = av.ParseAttributeView(database.ID)
	preview, err = model.PreviewAttributeViewCollection(database.ID, collection.ID, 1)
	if err != nil || len(preview.Blocks) != 1 || stored.GetBlockValueByBoundID(preview.Blocks[0].ID) == nil {
		t.Fatalf("container preview and collection disagree: %+v %v", preview, err)
	}
	quoteID := preview.Blocks[0].ID
	sourceTree, err := model.LoadTreeByBlockID(quoteID)
	if err != nil {
		t.Fatal(err)
	}
	quote := treenode.GetNodeInTree(sourceTree, quoteID)
	if quote == nil || quote.Type != ast.NodeBlockquote {
		t.Fatal("collected a descendant instead of the quote")
	}
	var paragraphs []string
	for child := quote.FirstChild; child != nil; child = child.Next {
		if child.Type == ast.NodeParagraph {
			paragraphs = append(paragraphs, child.ID)
		}
	}
	if len(paragraphs) != 2 {
		t.Fatalf("quote fixture paragraphs: %v", paragraphs)
	}
	collection.BlockSource.TagTarget, collection.BlockSource.Types = "block", []string{"p"}
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "setAttrViewAutomations", AvID: database.ID,
		Data: &av.AutomationConfig{Spec: 4, Rules: []*av.AutomationRule{collection}}}}); err != nil {
		t.Fatal(err)
	}
	stored, _ = av.ParseAttributeView(database.ID)
	if stored.GetBlockValueByBoundID(quoteID) == nil {
		t.Fatal("changing target converted the existing quote entry")
	}
	preview, err = model.PreviewAttributeViewCollection(database.ID, collection.ID, 1)
	if err != nil || len(preview.Blocks) != 2 {
		t.Fatalf("direct target preview: %+v %v", preview, err)
	}
	for _, block := range preview.Blocks {
		if block.ID != paragraphs[0] && block.ID != paragraphs[1] {
			t.Fatal("direct preview returned a container")
		}
	}
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "collectAttrViewBlocks", AvID: database.ID,
		Data: map[string]any{"ruleID": collection.ID, "blockIDs": paragraphs}}}); err != nil {
		t.Fatal(err)
	}
	stored, _ = av.ParseAttributeView(database.ID)
	for _, id := range paragraphs {
		if stored.GetBlockValueByBoundID(id) == nil {
			t.Fatal("explicit collection disagreed with direct preview")
		}
	}
	collection.BlockSource.TagTarget, collection.BlockSource.Types = "container", []string{"b"}
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "setAttrViewAutomations", AvID: database.ID,
		Data: &av.AutomationConfig{Spec: 4, Rules: []*av.AutomationRule{collection}}}}); err != nil {
		t.Fatal(err)
	}
	for _, id := range paragraphs {
		call("/api/block/updateBlock", map[string]any{"id": id, "dataType": "markdown", "data": "Without tag"}, updateBlock)
		stored, _ = av.ParseAttributeView(database.ID)
		if stored.GetBlockValueByBoundID(quoteID) == nil {
			t.Fatal("container mismatch removed the preserved entry")
		}
	}
	preview, err = model.PreviewAttributeViewCollection(database.ID, collection.ID, 1)
	if err != nil || len(preview.Blocks) != 0 {
		t.Fatalf("unmatched container preview: %+v %v", preview, err)
	}
	response = callAttributeViewContextFilterAPI(t, "/api/av/reviewAttributeViewCollection", map[string]any{"avID": database.ID, "page": 1}, reviewAttributeViewCollection)
	requireAPIContract(t, http.MethodPost, "/api/av/reviewAttributeViewCollection", response)
	var reviewed struct {
		Data apicontract.AVCollectionReview
	}
	if err = json.Unmarshal(response.Body.Bytes(), &reviewed); err != nil {
		t.Fatal(err)
	}
	var quoteItem *apicontract.AVCollectionCleanupItem
	for _, item := range reviewed.Data.Items {
		if item.BlockID == quoteID && item.Status == "unmatched" {
			quoteItem = &apicontract.AVCollectionCleanupItem{ItemID: item.ItemID, BlockID: item.BlockID}
		}
	}
	if quoteItem == nil {
		t.Fatal("review endpoint did not report the preserved unmatched quote")
	}
	for _, status := range []string{"matched", "unmatched", "unknown"} {
		filtered := callAttributeViewContextFilterAPI(t, "/api/av/reviewAttributeViewCollection",
			map[string]any{"avID": database.ID, "page": 1, "status": status}, reviewAttributeViewCollection)
		requireAPIContract(t, http.MethodPost, "/api/av/reviewAttributeViewCollection", filtered)
		var result struct {
			Data apicontract.AVCollectionReview
		}
		if err = json.Unmarshal(filtered.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Data.Matched != reviewed.Data.Matched || result.Data.Unmatched != reviewed.Data.Unmatched || result.Data.Unknown != reviewed.Data.Unknown {
			t.Fatal("category filter changed global counts")
		}
		for _, item := range result.Data.Items {
			if item.Status != status {
				t.Fatalf("wrong category: %+v", item)
			}
		}
	}
	if err = model.PerformAttributeViewOperations([]*model.Operation{{Action: "cleanupAttrViewBlocks", AvID: database.ID,
		Data: &apicontract.AVCollectionCleanup{RuleVersion: reviewed.Data.RuleVersion, Items: []*apicontract.AVCollectionCleanupItem{quoteItem}}}}); err != nil {
		t.Fatal(err)
	}
	stored, _ = av.ParseAttributeView(database.ID)
	if stored.GetBlockValueByBoundID(quoteID) != nil {
		t.Fatal("confirmed cleanup did not remove the reviewed quote entry")
	}
	if _, err = model.LoadTreeByBlockID(quoteID); err != nil {
		t.Fatal("cleanup removed original quote", err)
	}
}
