//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAutomationTemplateTransactionUndoRedo(t *testing.T) {
	fixture, source, target, statusID, _ := setupAutomationTest(t)
	source.Automations.Spec = 2
	source.Automations.Rules = source.Automations.Rules[:1]
	rule := source.Automations.Rules[0]
	rule.TimeZone = "America/New_York"
	rule.Actions[0].Fields[target.GetBlockKey().ID] = &av.AutomationValue{Mode: "template", Template: fmt.Sprintf(`Next: .action{field %q}`, source.GetBlockKey().ID)}
	dateID := target.KeyValues[2].Key.ID
	rule.Actions[0].Fields[dateID] = &av.AutomationValue{Mode: "template", Template: `.action{((now).AddDate 0 0 7).Format "2006-01-02"}`}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	tx := automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")
	triggeredAt := time.Now()
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	stored := readAttributeViewItemsTest(t, target.ID)
	row := stored.GetBlockKeyValues().Values[0]
	date := stored.GetValue(dateID, row.BlockID).Date
	zone, _ := time.LoadLocation(rule.TimeZone)
	want := triggeredAt.In(zone).AddDate(0, 0, 7).Format("2006-01-02")
	if row.Block.Content != "Next: Primary" || !date.IsNotTime || time.UnixMilli(date.Content).In(zone).Format("2006-01-02") != want {
		t.Fatalf("incorrect stored result: %+v %+v", row, date)
	}
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 0 {
		t.Fatal("undo retained generated row")
	}
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.DoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	restored := readAttributeViewItemsTest(t, target.ID)
	if restored.GetBlockValue(row.BlockID) == nil || restored.GetValue(dateID, row.BlockID).Date.Content != date.Content {
		t.Fatal("redo recomputed template or row ID")
	}
}

func TestAutomationTemplateFailuresRollBackEarlierActions(t *testing.T) {
	for _, output := range []string{"invalid date", `.action{field "missing"}`, `.action{.Missing}`, `{"content":1,"isNotEmpty":true,"hasEndDate":true}`} {
		t.Run(output, func(t *testing.T) {
			fixture, source, target, statusID, _ := setupAutomationTest(t)
			source.Automations.Spec = 2
			source.Automations.Rules = source.Automations.Rules[:1]
			rule := source.Automations.Rules[0]
			rule.TimeZone = "UTC"
			rule.Actions = append(rule.Actions, &av.AutomationAction{Type: "edit", Target: "filtered", AvID: target.ID, Fields: map[string]*av.AutomationValue{
				target.KeyValues[2].Key.ID: {Mode: "template", Template: output},
			}})
			if err := av.SaveAttributeView(source); err != nil {
				t.Fatal(err)
			}
			itemID := source.GetBlockKeyValues().Values[0].BlockID
			if err := PerformTxSync(automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")); err == nil {
				t.Fatal("invalid output committed")
			}
			if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 0 {
				t.Fatal("earlier action survived failure")
			}
			if readAttributeViewItemsTest(t, source.ID).GetValue(statusID, itemID).MSelect[0].Content != "Alpha" {
				t.Fatal("source edit survived failure")
			}
		})
	}
}

func TestAutomationTemplatePreviewIsReadOnly(t *testing.T) {
	_, source, target, _, _ := setupAutomationTest(t)
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	paths := map[string][]byte{}
	for _, view := range []*av.AttributeView{source, target} {
		path := filepath.Join(util.DataDir, "storage", "av", view.ID+".json")
		paths[path], _ = os.ReadFile(path)
	}
	request := apicontract.AVAutomationTemplatePreviewRequest{AvID: source.ID, TargetAvID: target.ID, ItemID: itemID,
		KeyID: target.GetBlockKey().ID, TimeZone: "Asia/Shanghai", TriggerTime: "2026-10-16T15:30",
		Template: fmt.Sprintf(`.action{field %q}`, source.GetBlockKey().ID), Inputs: map[string]string{source.GetBlockKey().ID: "Preview only"}}
	value, err := PreviewAttributeViewTemplate(request)
	if err != nil || value.Block.Content != "Preview only" {
		t.Fatal("preview failed", value, err)
	}
	request.KeyID = target.KeyValues[2].Key.ID
	request.Template = `.action{((now).AddDate 0 0 7).Format "2006-01-02"}`
	value, err = PreviewAttributeViewTemplate(request)
	zone, _ := time.LoadLocation(request.TimeZone)
	if err != nil || time.UnixMilli(value.Date.Content).In(zone).Format("2006-01-02") != "2026-10-23" {
		t.Fatal("preview time ignored", value, err)
	}
	request.Template = `.action{.Missing}`
	if _, err = PreviewAttributeViewTemplate(request); err == nil {
		t.Fatal("preview hid missing variable")
	}
	for path, before := range paths {
		after, _ := os.ReadFile(path)
		if !bytes.Equal(before, after) {
			t.Fatal("preview wrote database", path)
		}
	}
}

func TestAutomationTemplateReferencesAndConfigurationVersion(t *testing.T) {
	fixture, source, target, _, _ := setupAutomationTest(t)
	previousWorkspace := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	defer func() { util.WorkspaceDir = previousWorkspace }()
	tx := &Transaction{}
	defer tx.finishAttributeViewMutation(false)
	relationKey := target.KeyValues[len(target.KeyValues)-1].Key
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	for _, test := range []struct {
		ids   []string
		valid bool
	}{
		{[]string{itemID}, true}, {[]string{target.ID}, false}, {[]string{"20261016000000-missing"}, false},
	} {
		value := &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: test.ids}}
		err := tx.validateAutomationTemplateReferences(source, target, relationKey, value, "")
		if (err == nil) != test.valid {
			t.Fatalf("reference validation mismatch: %v %v", test.ids, err)
		}
	}
	assetKey := &av.Key{Type: av.KeyTypeMAsset}
	for _, path := range []string{"assets/missing.pdf", "../conf/conf.json", "https://example.com/new.pdf"} {
		value := &av.Value{Type: av.KeyTypeMAsset, MAsset: []*av.ValueAsset{{Type: av.AssetTypeFile, Content: path}}}
		if err := tx.validateAutomationTemplateReferences(source, target, assetKey, value, ""); err == nil {
			t.Fatal("invalid asset accepted", path)
		}
	}
	assetPath := filepath.Join(util.DataDir, "assets", "template-fixture.pdf")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(assetPath, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := tx.validateAutomationTemplateReferences(source, target, assetKey, &av.Value{MAsset: []*av.ValueAsset{{Type: av.AssetTypeFile, Content: "assets/template-fixture.pdf"}}}, ""); err != nil {
		t.Fatal("existing asset rejected", err)
	}
	source.Automations.Rules = source.Automations.Rules[:1]
	rule := source.Automations.Rules[0]
	rule.TimeZone = "UTC"
	rule.Actions[0].Fields[target.GetBlockKey().ID] = &av.AutomationValue{Mode: "template", Template: "test"}
	operation := &Operation{Action: "setAttrViewAutomations", AvID: source.ID, BlockID: fixture.sourceID, Data: source.Automations}
	if err := PerformAttributeViewOperations([]*Operation{operation}); err == nil {
		t.Fatal("template accepted under old version")
	}
	source.Automations.Spec = 2
	if err := PerformAttributeViewOperations([]*Operation{operation}); err != nil {
		t.Fatal("new configuration rejected", err)
	}
	stored := readAttributeViewItemsTest(t, source.ID)
	data, _ := json.Marshal(stored.Automations)
	if !bytes.Contains(data, []byte(`"template":"test"`)) || stored.Automations.Rules[0].TimeZone != "UTC" {
		t.Fatal("configuration lost template or time zone")
	}
}

func TestAutomationTemplateBlockCollection(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	view.Automations.Spec = 2
	rule := view.Automations.Rules[0]
	rule.TimeZone = "UTC"
	rule.Actions[0].Fields[keyID] = &av.AutomationValue{Mode: "template", Template: fmt.Sprintf(`Collected: .action{field %q}`, view.GetBlockKey().ID)}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	stored := readAttributeViewItemsTest(t, view.ID)
	row := stored.GetBlockValueByBoundID(fixture.sourceID)
	if row == nil || stored.GetValue(keyID, row.BlockID).Text.Content != "Collected: "+row.Block.Content {
		t.Fatal("collection template did not read the inserted source row", row)
	}
}
