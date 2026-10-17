//go:build fts5

package model

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAutomationNotificationLanguage(t *testing.T) {
	t.Helper()
	previous, language := util.WorkingDir, Conf.Lang
	previousTime, hadTime := util.TimeLangs["en"]
	working, err := filepath.Abs("../../app")
	if err != nil {
		t.Fatal(err)
	}
	util.WorkingDir, Conf.Lang = working, "en"
	data, err := os.ReadFile(filepath.Join(working, "appearance", "langs", "en.json"))
	if err != nil {
		t.Fatal(err)
	}
	var terms struct {
		Time map[string]any `json:"_time"`
	}
	if err = json.Unmarshal(data, &terms); err != nil {
		t.Fatal(err)
	}
	util.TimeLangs["en"] = terms.Time
	t.Cleanup(func() {
		util.WorkingDir, Conf.Lang = previous, language
		if hadTime {
			util.TimeLangs["en"] = previousTime
		} else {
			delete(util.TimeLangs, "en")
		}
	})
}

func captureAutomationNotifications(t *testing.T, tx *Transaction, messages *[]string) {
	t.Helper()
	tx.pushAutomationMessage = func(message string, timeout int) string {
		if tx.state.Load() != 2 || timeout != 5000 {
			t.Fatal("notification preceded the complete transaction commit")
		}
		*messages = append(*messages, message)
		return "test-message"
	}
}

func TestAutomationSuccessNotificationsCommitAndReplay(t *testing.T) {
	fixture, source, target, statusID, _ := setupAutomationTest(t)
	setupAutomationNotificationLanguage(t)
	source.Automations.Rules[0].Name = "<Start ${2}>"
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	messages := []string{}
	tx := automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")
	captureAutomationNotifications(t, tx, &messages)
	tx.writeTransactionTree = func(tree *parse.Tree) error {
		if len(messages) != 0 {
			t.Fatal("success was announced before writing the source document")
		}
		_, err := filesys.WriteTree(tree)
		return err
	}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	want := `Automation "&lt;Start ${2}&gt;" completed: Entries added: 1`
	if len(messages) != 1 || messages[0] != want {
		t.Fatalf("unexpected notification: %v", messages)
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 1 {
		t.Fatal("notification did not match persisted rows")
	}
	for _, operations := range [][]*Operation{cloneOperations(tx.UndoOperations), cloneOperations(tx.DoOperations)} {
		replay := &Transaction{DoOperations: operations, isReplay: true}
		captureAutomationNotifications(t, replay, &messages)
		if err := PerformTxSync(replay); err != nil {
			t.Fatal(err)
		}
	}
	if len(messages) != 1 {
		t.Fatal("undo or redo announced another successful execution")
	}
	source = readAttributeViewItemsTest(t, source.ID)
	repeat := automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")
	captureAutomationNotifications(t, repeat, &messages)
	if err := PerformTxSync(repeat); err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 {
		t.Fatal("an unchanged trigger generated a notification")
	}
}

func TestAutomationSuccessNotificationSuppression(t *testing.T) {
	for _, scenario := range []string{"muted", "unmatched", "no-target", "unchanged", "rollback", "action-error", "muted-error"} {
		t.Run(scenario, func(t *testing.T) {
			fixture, source, target, statusID, logsID := setupAutomationTest(t)
			setupAutomationNotificationLanguage(t)
			rule := source.Automations.Rules[0]
			source.Automations.Rules = source.Automations.Rules[:1]
			itemID := source.GetBlockKeyValues().Values[0].BlockID
			status := "Active"
			switch scenario {
			case "muted", "muted-error":
				notify := false
				rule.NotifyOnSuccess = &notify
			case "unmatched":
				status = "Done"
			case "no-target":
				rule.Actions = []*av.AutomationAction{{Type: "edit", Target: "related", RelationKeyID: logsID,
					Fields: map[string]*av.AutomationValue{target.KeyValues[2].Key.ID: {Mode: "currentTime"}}}}
			case "unchanged":
				rule.Actions = []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
					source.GetBlockKey().ID: {Mode: "static", Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Primary"}}},
				}}}
			}
			if strings.HasSuffix(scenario, "error") {
				source.Automations.Spec, rule.TimeZone = 2, "UTC"
				rule.Actions[0].Fields[target.GetBlockKey().ID] = &av.AutomationValue{Mode: "template", Template: `.action{field "missing-field"}`}
			}
			if err := av.SaveAttributeView(source); err != nil {
				t.Fatal(err)
			}
			messages := []string{}
			tx := automationStatusTransaction(source, fixture.sourceID, statusID, itemID, status)
			captureAutomationNotifications(t, tx, &messages)
			if scenario == "rollback" {
				tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected commit failure") }
			}
			err := PerformTxSync(tx)
			if (err != nil) != (scenario == "rollback" || strings.HasSuffix(scenario, "error")) {
				t.Fatalf("unexpected execution result: %v", err)
			}
			if len(messages) != 0 {
				t.Fatalf("%s announced success: %v", scenario, messages)
			}
			if scenario == "muted" && len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 1 {
				t.Fatal("muting notifications stopped execution")
			}
		})
	}
}

func TestAutomationSuccessNotificationsMergeCollectionAndActions(t *testing.T) {
	fixture, source, _, statusID, _ := setupAutomationTest(t)
	setupAutomationNotificationLanguage(t)
	source.Automations.Rules = source.Automations.Rules[:1]
	source.Automations.Rules = append(source.Automations.Rules, &av.AutomationRule{ID: ast.NewNodeID(), Name: "Collect", Enabled: true, Trigger: "block",
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{fixture.targetID}, Types: []string{"d"}, Tags: []string{"todo"}},
		Actions:     []*av.AutomationAction{{Type: "collect", Target: "current", Fields: map[string]*av.AutomationValue{}}}})
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	messages := []string{}
	tx := automationStatusTransaction(source, fixture.sourceID, statusID, source.GetBlockKeyValues().Values[0].BlockID, "Active")
	collection := blockCollectionTags(t, fixture.targetID, "todo")
	tx.DoOperations = append(tx.DoOperations, collection.DoOperations...)
	tx.UndoOperations = append(tx.UndoOperations, collection.UndoOperations...)
	captureAutomationNotifications(t, tx, &messages)
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0] != "Database automations completed: Entries added: 1; Blocks collected: 1" {
		t.Fatalf("collection and ordinary actions did not share a notification: %v", messages)
	}
}

func TestAutomationSuccessNotificationsMergeAndCountItems(t *testing.T) {
	fixture, source, target, statusID, _ := setupAutomationTest(t)
	setupAutomationNotificationLanguage(t)
	start := source.Automations.Rules[0]
	fieldID := ast.NewNodeID()
	source.KeyValues = append(source.KeyValues, &av.KeyValues{Key: &av.Key{ID: fieldID, Name: "Note", Type: av.KeyTypeText}})
	edit := &av.AutomationRule{ID: ast.NewNodeID(), Name: "Edit", Enabled: true, Trigger: "changed", KeyID: statusID,
		Conditions: start.Conditions, Actions: []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
			source.GetBlockKey().ID: {Mode: "static", Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Updated"}}},
			fieldID:                 {Mode: "static", Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Updated note"}}},
		}}}}
	notify := false
	muted := *start
	muted.ID, muted.Name, muted.NotifyOnSuccess = ast.NewNodeID(), "Muted", &notify
	source.Automations.Rules = []*av.AutomationRule{edit, start, &muted}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	messages := []string{}
	tx := automationStatusTransaction(source, fixture.sourceID, statusID, source.GetBlockKeyValues().Values[0].BlockID, "Active")
	captureAutomationNotifications(t, tx, &messages)
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0] != "Database automations completed: Entries added: 1; Entries updated: 1" {
		t.Fatalf("unmerged or inaccurate result: %v", messages)
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 2 {
		t.Fatal("muted rule did not execute")
	}
}

func TestAutomationCollectionSuccessNotifications(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	setupAutomationNotificationLanguage(t)
	messages := []string{}
	for _, tags := range []string{"todo", "todo,other", ""} {
		tx := blockCollectionTags(t, fixture.sourceID, tags)
		captureAutomationNotifications(t, tx, &messages)
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
	}
	if len(messages) != 1 || !strings.Contains(messages[0], "Blocks collected: 1") || strings.Contains(messages[0], "updated") || strings.Contains(messages[0], "removed") {
		t.Fatalf("unexpected collection notifications: %v", messages)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	notify := false
	view.Automations.Rules[0].NotifyOnSuccess = &notify
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	for _, tags := range []string{"todo", ""} {
		tx := blockCollectionTags(t, fixture.sourceID, tags)
		captureAutomationNotifications(t, tx, &messages)
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
	}
	if len(messages) != 1 {
		t.Fatal("muted or preserved collection sent a notification")
	}
	view = readAttributeViewItemsTest(t, view.ID)
	rule := view.Automations.Rules[0]
	rule.Enabled, rule.NotifyOnSuccess = false, nil
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	rule.Enabled = true
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	op := &Operation{Action: "collectAttrViewBlocks", AvID: view.ID, Data: map[string]any{"ruleID": rule.ID, "blockIDs": []string{fixture.sourceID}}}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{op}}
	captureAutomationNotifications(t, tx, &messages)
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.sourceID) == nil {
		t.Fatal("explicit collection notified or failed to collect")
	}
}
