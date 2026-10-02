//go:build fts5

package model

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAutomationAddIgnoresMirrorContext(t *testing.T) {
	for _, sameDatabase := range []bool{false, true} {
		for _, boundDocument := range []bool{false, true} {
			t.Run(fmt.Sprintf("current=%t/bound=%t", sameDatabase, boundDocument), func(t *testing.T) {
				fixture, source, target, statusID, logsID := setupAutomationTest(t)
				relationKeyID, related := target.KeyValues[4].Key.ID, source
				if sameDatabase {
					related, target, relationKeyID = target, source, logsID
					source.Automations.Rules[0].Actions[0] = &av.AutomationAction{Type: "add", Target: "current",
						Fields: map[string]*av.AutomationValue{source.GetBlockKey().ID: {
							Mode: "static", Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Automatic"}},
						}}}
				} else {
					delete(source.Automations.Rules[0].Actions[0].Fields, relationKeyID)
				}
				if err := av.SaveAttributeView(source); err != nil {
					t.Fatal(err)
				}
				if boundDocument {
					if err := AddAttributeViewBlock(nil, []map[string]any{{"id": fixture.sourceID, "itemID": ast.NewNodeID(), "isDetached": false}},
						related.ID, "", "", "", "", true); err != nil {
						t.Fatal(err)
					}
				}
				tree, err := LoadTreeByBlockID(fixture.sourceID)
				if err != nil {
					t.Fatal(err)
				}
				carrier := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: target.ID, AttributeViewType: "table"}
				raw, err := (&av.AttributeViewContextFilter{Spec: av.AttributeViewContextFilterSpec, KeyID: relationKeyID}).Marshal()
				if err != nil {
					t.Fatal(err)
				}
				carrier.SetIALAttr(av.NodeAttrContextFilter, raw)
				tree.Root.AppendChild(carrier)
				if _, err := filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				av.UpsertBlockRel(target.ID, carrier.ID)
				before := readAttributeViewItemsTest(t, target.ID)
				source = readAttributeViewItemsTest(t, source.ID)
				itemID := source.GetBlockKeyValues().Values[0].BlockID
				blockID := fixture.sourceID
				if sameDatabase {
					blockID = carrier.ID
				}
				tx := automationStatusTransaction(source, blockID, statusID, itemID, "Active")
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				stored := readAttributeViewItemsTest(t, target.ID)
				if len(stored.GetBlockKeyValues().Values) != len(before.GetBlockKeyValues().Values)+1 {
					t.Fatal("automation did not add exactly one item")
				}
				var addedID string
				for _, row := range stored.GetBlockKeyValues().Values {
					if before.GetBlockValue(row.BlockID) == nil {
						addedID = row.BlockID
						if value := stored.GetValue(relationKeyID, addedID); value != nil && len(value.Relation.BlockIDs) > 0 {
							t.Fatal("automation inherited the mirror's implicit document relation")
						}
					}
				}
				if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				if readAttributeViewItemsTest(t, target.ID).GetBlockValue(addedID) != nil {
					t.Fatal("undo retained the automatic item")
				}
				if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.DoOperations), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				if readAttributeViewItemsTest(t, target.ID).GetBlockValue(addedID) == nil {
					t.Fatal("redo did not restore the automatic item")
				}
			})
		}
	}
}

func TestAutomationLargeDatabaseNoOp(t *testing.T) {
	fixture, source, target, statusID, _ := setupAutomationTest(t)
	source.Automations.Rules = source.Automations.Rules[:1]
	primary := source.GetBlockKeyValues()
	status, _ := source.GetKeyValues(statusID)
	primaryTemplate, statusTemplate := primary.Values[0].Clone(), status.Values[0].Clone()
	primary.Values, status.Values = nil, nil
	for i := 0; i < 20000; i++ {
		id := ast.NewNodeID()
		p, s := primaryTemplate.Clone(), statusTemplate.Clone()
		p.ID, p.BlockID, s.ID, s.BlockID = ast.NewNodeID(), id, ast.NewNodeID(), id
		primary.Values, status.Values = append(primary.Values, p), append(status.Values, s)
	}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	tx := automationStatusTransaction(source, fixture.sourceID, statusID, primary.Values[0].BlockID, "Alpha")
	started := time.Now()
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	t.Logf("20,000 rows, one unchanged cell: %s", time.Since(started))
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 0 {
		t.Fatal("unchanged values triggered an automation")
	}
}

func TestAutomationRelationConditionsAndTargets(t *testing.T) {
	fixture, source, target, statusID, logsID := setupAutomationTest(t)
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	if err := PerformTxSync(automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")); err != nil {
		t.Fatal(err)
	}
	source = readAttributeViewItemsTest(t, source.ID)
	target = readAttributeViewItemsTest(t, target.ID)
	logID := target.GetBlockKeyValues().Values[0].BlockID
	unrelatedID := ast.NewNodeID()
	if err := AddAttributeViewBlock(nil, []map[string]any{{"id": unrelatedID, "itemID": unrelatedID, "isDetached": true}},
		target.ID, "", "", "", "", true); err != nil {
		t.Fatal(err)
	}
	relationFilters := func(keyID string) []*av.ViewFilter {
		return []*av.ViewFilter{
			{Column: keyID, Operator: av.FilterOperatorIsNotEmpty, Value: &av.Value{Type: av.KeyTypeRelation}},
			{Column: keyID, Operator: av.FilterOperatorContains,
				Value: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{"Primary"}}}},
		}
	}
	rule := source.Automations.Rules[1]
	rule.Conditions = append(rule.Conditions, relationFilters(logsID)...)
	action := rule.Actions[0]
	action.Target, action.AvID = "filtered", target.ID
	action.Filters = append(action.Filters, relationFilters(target.KeyValues[4].Key.ID)...)
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Done")); err != nil {
		t.Fatal(err)
	}
	target = readAttributeViewItemsTest(t, target.ID)
	if value := target.GetValue(target.KeyValues[3].Key.ID, logID); value == nil || !value.Date.IsNotEmpty {
		t.Fatal("relation conditions did not match the linked time record")
	}
	if value := target.GetValue(target.KeyValues[3].Key.ID, unrelatedID); value != nil && value.Date.IsNotEmpty {
		t.Fatal("relation filters changed an unrelated record")
	}
}

func TestAutomationRelationKeywordsKeepCryptoBoundary(t *testing.T) {
	_, source, target, _, logsID := setupAutomationTest(t)
	boxID := ast.NewNodeID()
	markRuntimeEncryptedBox(boxID)
	setDEKForTest(boxID, bytes.Repeat([]byte{0x62}, 32))
	t.Cleanup(func() {
		av.SetAVBoxID(target.ID, "")
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	target.GetBlockKeyValues().Values = []*av.Value{{ID: ast.NewNodeID(), BlockID: ast.NewNodeID(),
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Private"}}}
	av.SetAVBoxID(target.ID, boxID)
	if err := av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(util.DataDir, "storage", "av", target.ID+".json")); err != nil {
		t.Fatal(err)
	}
	key, _ := source.GetKey(logsID)
	ids := []string{target.GetBlockKeyValues().Values[0].BlockID}
	tx := &Transaction{}
	defer tx.finishAttributeViewMutation(false)
	resolve := tx.automationRelationValues("", map[string]*av.AttributeView{target.ID: target})
	if _, err := resolve(key, ids); err == nil {
		t.Fatal("relation filter read an encrypted snapshot from a plaintext database")
	}
	resolve = tx.automationRelationValues(boxID, nil)
	values, err := resolve(key, ids)
	if err != nil || len(values) != 1 || values[0].Block.Content != "Private" {
		t.Fatalf("same-boundary relation filter failed: %v", err)
	}
}

func TestAutomationRelationConditionsUseSourceSnapshot(t *testing.T) {
	fixture, source, target, statusID, logsID := setupAutomationTest(t)
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	if err := PerformTxSync(automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")); err != nil {
		t.Fatal(err)
	}
	source = readAttributeViewItemsTest(t, source.ID)
	finish := source.Automations.Rules[1]
	finish.Conditions = append(finish.Conditions, &av.ViewFilter{Column: logsID, Operator: av.FilterOperatorContains,
		Value: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{"Renamed"}}}})
	rename := &av.AutomationRule{ID: ast.NewNodeID(), Name: "Rename", Enabled: true, Trigger: "changed", KeyID: statusID,
		Actions: []*av.AutomationAction{{Type: "edit", Target: "related", RelationKeyID: logsID,
			Fields: map[string]*av.AutomationValue{target.GetBlockKey().ID: {
				Mode: "static", Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Renamed"}},
			}}}}}
	source.Automations.Rules = []*av.AutomationRule{rename, finish}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Done")); err != nil {
		t.Fatal(err)
	}
	target = readAttributeViewItemsTest(t, target.ID)
	row := target.GetBlockKeyValues().Values[0]
	if row.Block.Content != "Renamed" {
		t.Fatal("first rule did not rename the related item")
	}
	if value := target.GetValue(target.KeyValues[3].Key.ID, row.BlockID); value != nil && value.Date.IsNotEmpty {
		t.Fatal("an automatic title change altered another rule's condition")
	}
}

func BenchmarkAutomationChangedItems(b *testing.B) {
	for _, size := range []int{1000, 10000, 20000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			view := &av.AttributeView{KeyValues: []*av.KeyValues{
				{Key: &av.Key{ID: "primary", Type: av.KeyTypeBlock}},
				{Key: &av.Key{ID: "status", Type: av.KeyTypeText}},
			}, Automations: &av.AutomationConfig{Rules: []*av.AutomationRule{{Enabled: true, Trigger: "changed", KeyID: "status"}}}}
			for i := 0; i < size; i++ {
				id := fmt.Sprint(i)
				view.KeyValues[0].Values = append(view.KeyValues[0].Values, &av.Value{BlockID: id, Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Task"}})
				view.KeyValues[1].Values = append(view.KeyValues[1].Values, &av.Value{BlockID: id, Type: av.KeyTypeText, Text: &av.ValueText{Content: "Pending"}})
			}
			current, err := cloneAttributeViewForFieldMutation(view)
			if err != nil {
				b.Fatal(err)
			}
			current.KeyValues[1].Values[size-1].Text.Content = "Active"
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				_, changed := automationChangedItems(view, current)
				if len(changed["status"]) != 1 {
					b.Fatal("lost the changed item")
				}
			}
		})
	}
}

func setupAutomationTest(t *testing.T) (*fileOperationTestFixture, *av.AttributeView, *av.AttributeView, string, string) {
	t.Helper()
	fixture, source, _, _ := setupAttributeViewItemsTest(t, false)
	var statusID string
	for _, kv := range source.KeyValues {
		if kv.Key.Type == av.KeyTypeSelect {
			statusID = kv.Key.ID
		}
	}
	target := av.NewAttributeView(ast.NewNodeID())
	for _, name := range []string{"start", "end"} {
		key := &av.Key{ID: ast.NewNodeID(), Name: name, Type: av.KeyTypeDate}
		target.KeyValues = append(target.KeyValues, &av.KeyValues{Key: key})
	}
	logsID, taskID := ast.NewNodeID(), ast.NewNodeID()
	source.KeyValues = append(source.KeyValues, &av.KeyValues{Key: &av.Key{ID: logsID, Name: "logs", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: target.ID, IsTwoWay: true, BackKeyID: taskID}}})
	target.KeyValues = append(target.KeyValues, &av.KeyValues{Key: &av.Key{ID: taskID, Name: "task", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: logsID}}})
	condition := func(status string) []*av.ViewFilter {
		return []*av.ViewFilter{{Column: statusID, Operator: av.FilterOperatorIsEqual,
			Value: &av.Value{Type: av.KeyTypeSelect, MSelect: []*av.ValueSelect{{Content: status, Color: "1"}}}}}
	}
	source.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{
		{ID: ast.NewNodeID(), Name: "Start", Enabled: true, Trigger: "changed", KeyID: statusID, Conditions: condition("Active"),
			Actions: []*av.AutomationAction{{Type: "add", Target: "filtered", AvID: target.ID,
				Fields: map[string]*av.AutomationValue{
					target.GetBlockKeyValues().Key.ID: {Mode: "source", KeyID: source.GetBlockKeyValues().Key.ID},
					target.KeyValues[2].Key.ID:        {Mode: "currentTime"},
					taskID:                            {Mode: "triggerItem"},
				}}}},
		{ID: ast.NewNodeID(), Name: "Finish", Enabled: true, Trigger: "changed", KeyID: statusID, Conditions: condition("Done"),
			Actions: []*av.AutomationAction{{Type: "edit", Target: "related", RelationKeyID: logsID,
				Filters: []*av.ViewFilter{{Column: target.KeyValues[3].Key.ID, Operator: av.FilterOperatorIsEmpty, Value: &av.Value{Type: av.KeyTypeDate}}},
				Fields:  map[string]*av.AutomationValue{target.KeyValues[3].Key.ID: {Mode: "currentTime"}}}}},
	}}
	for _, view := range []*av.AttributeView{source, target} {
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
	}
	return fixture, source, target, statusID, logsID
}

func automationStatusTransaction(source *av.AttributeView, blockID, keyID, itemID, status string) *Transaction {
	return &Transaction{fromAPI: true,
		DoOperations: []*Operation{{Action: "updateAttrViewCell", AvID: source.ID, BlockID: blockID, KeyID: keyID, RowID: itemID,
			Data: map[string]any{"mSelect": []any{map[string]any{"content": status, "color": "1"}}}}},
		UndoOperations: []*Operation{{Action: "updateAttrViewCell", AvID: source.ID, BlockID: blockID, KeyID: keyID, RowID: itemID,
			Data: automationValuePatch(source.GetValue(keyID, itemID))}}}
}

func TestAutomationTaskTimeTrackingUndoRedo(t *testing.T) {
	fixture, source, target, statusID, logsID := setupAutomationTest(t)
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	tx := automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	stored := readAttributeViewItemsTest(t, target.ID)
	if len(stored.GetBlockKeyValues().Values) != 1 {
		t.Fatalf("expected one time record: %+v", stored.GetBlockKeyValues().Values)
	}
	logID := stored.GetBlockKeyValues().Values[0].BlockID
	start := stored.GetValue(target.KeyValues[2].Key.ID, logID).Date.Content
	if start == 0 || stored.GetBlockValue(logID).Block.Content != "Primary" {
		t.Fatal("missing source title or trigger time")
	}
	source = readAttributeViewItemsTest(t, source.ID)
	if value := source.GetValue(logsID, itemID); value == nil || len(value.Relation.BlockIDs) != 1 || value.Relation.BlockIDs[0] != logID {
		t.Fatalf("missing two-way relation: source=%+v target=%+v key=%+v", value, stored.GetValue(target.KeyValues[4].Key.ID, logID), stored.KeyValues[4].Key.Relation)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	if entry == nil {
		t.Fatal("missing grouped undo entry")
	}
	replay := &Transaction{DoOperations: entry.UndoOperationsForReplay(), UndoOperations: entry.DoOperationsForReplay(), isReplay: true}
	if err := PerformTxSync(replay); err != nil {
		t.Fatal(err)
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 0 {
		t.Fatal("undo left an automatic record")
	}
	if got := readAttributeViewItemsTest(t, source.ID).GetValue(statusID, itemID).MSelect[0].Content; got != "Alpha" {
		t.Fatalf("undo source status = %s", got)
	}
	if err := PerformTxSync(&Transaction{DoOperations: replay.UndoOperations, UndoOperations: replay.DoOperations, isReplay: true}); err != nil {
		t.Fatal(err)
	}
	stored = readAttributeViewItemsTest(t, target.ID)
	if len(stored.GetBlockKeyValues().Values) != 1 || stored.GetBlockValue(logID) == nil || stored.GetValue(target.KeyValues[2].Key.ID, logID).Date.Content != start {
		t.Fatal("redo changed the original record identity or trigger time")
	}
	source = readAttributeViewItemsTest(t, source.ID)
	if err := PerformTxSync(automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Done")); err != nil {
		t.Fatal(err)
	}
	stored = readAttributeViewItemsTest(t, target.ID)
	if len(stored.GetBlockKeyValues().Values) != 1 || stored.GetValue(target.KeyValues[3].Key.ID, logID).Date.Content < start {
		t.Fatal("completion did not update the related time record")
	}
}

func TestAutomationFailureRollsBackSourceAndTarget(t *testing.T) {
	fixture, source, target, statusID, _ := setupAutomationTest(t)
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	tx := automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")
	injected := errors.New("injected automation commit failure")
	tx.writeTransactionTree = func(*parse.Tree) error { return injected }
	if err := PerformTxSync(tx); err == nil || !strings.Contains(err.Error(), injected.Error()) {
		t.Fatalf("expected injected failure: %v", err)
	}
	if got := readAttributeViewItemsTest(t, source.ID).GetValue(statusID, itemID).MSelect[0].Content; got != "Alpha" {
		t.Fatalf("source was not rolled back: %s", got)
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 0 {
		t.Fatal("target was not rolled back")
	}
	if GlobalUndoLog.Peek(fixture.sourceID) != nil {
		t.Fatal("failed automation recorded undo history")
	}
}

func TestAutomationNoOpReplayAndInternalWritesDoNotTrigger(t *testing.T) {
	fixture, source, target, statusID, _ := setupAutomationTest(t)
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	for _, internal := range []bool{true, false} {
		tx := automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")
		tx.fromAPI = !internal
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 0 {
			t.Fatal("internal write or unchanged value triggered an automation")
		}
	}
}

func TestAutomationBatchUsesFinalStateOnce(t *testing.T) {
	fixture, source, target, statusID, _ := setupAutomationTest(t)
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	tx := automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")
	tx.DoOperations = append(tx.DoOperations, cloneOperations(tx.DoOperations)...)
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 1 {
		t.Fatal("batch edits triggered more than once")
	}
}

func TestAutomationAddedDoesNotChain(t *testing.T) {
	fixture, source, target, _, _ := setupAutomationTest(t)
	rule := source.Automations.Rules[0]
	rule.Trigger, rule.KeyID, rule.Conditions = "added", "", nil
	source.Automations.Rules = []*av.AutomationRule{rule}
	target.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{
		ID: ast.NewNodeID(), Name: "Must not chain", Enabled: true, Trigger: "added",
		Actions: []*av.AutomationAction{{Type: "add", Target: "current", Fields: map[string]*av.AutomationValue{
			target.GetBlockKeyValues().Key.ID: {Mode: "static", Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Chained"}}},
		}}},
	}}}
	for _, view := range []*av.AttributeView{source, target} {
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
	}
	itemID := ast.NewNodeID()
	op := &Operation{Action: "insertAttrViewBlock", AvID: source.ID, BlockID: fixture.sourceID, IgnoreDefaultFill: true,
		Srcs: []map[string]any{{"id": itemID, "itemID": itemID, "isDetached": true, "content": "New task"}}}
	if err := PerformAttributeViewOperations([]*Operation{op}); err != nil {
		t.Fatal(err)
	}
	stored := readAttributeViewItemsTest(t, target.ID)
	if rows := stored.GetBlockKeyValues().Values; len(rows) != 1 || rows[0].Block.Content != "New task" {
		t.Fatalf("added trigger chained or lost the source value: %+v", rows)
	}
}

func TestAutomationRelationReplacementUndo(t *testing.T) {
	fixture, source, target, statusID, logsID := setupAutomationTest(t)
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	if err := PerformTxSync(automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Active")); err != nil {
		t.Fatal(err)
	}
	source = readAttributeViewItemsTest(t, source.ID)
	target = readAttributeViewItemsTest(t, target.ID)
	logID := target.GetBlockKeyValues().Values[0].BlockID
	otherID := source.GetBlockKeyValues().Values[1].BlockID
	taskID := target.KeyValues[4].Key.ID
	rule := source.Automations.Rules[1]
	rule.Actions[0].Fields = map[string]*av.AutomationValue{taskID: {
		Mode: "static", Value: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{otherID}}},
	}}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	tx := automationStatusTransaction(source, fixture.sourceID, statusID, itemID, "Done")
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	stored := readAttributeViewItemsTest(t, source.ID)
	if value := stored.GetValue(logsID, itemID); value != nil && len(value.Relation.BlockIDs) != 0 {
		t.Fatal("replacing a relation left the previous backlink")
	}
	if value := stored.GetValue(logsID, otherID); value == nil || len(value.Relation.BlockIDs) != 1 || value.Relation.BlockIDs[0] != logID {
		t.Fatal("replacing a relation did not create the new backlink")
	}
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	stored = readAttributeViewItemsTest(t, source.ID)
	if value := stored.GetValue(logsID, itemID); value == nil || len(value.Relation.BlockIDs) != 1 {
		t.Fatal("undo did not restore the previous backlink")
	}
	if value := stored.GetValue(logsID, otherID); value != nil && len(value.Relation.BlockIDs) != 0 {
		t.Fatal("undo retained the replacement backlink")
	}
}

func TestAutomationEncryptedExecutionAndFailures(t *testing.T) {
	_, source, target, statusID, _ := setupAutomationTest(t)
	boxID := ast.NewNodeID()
	markRuntimeEncryptedBox(boxID)
	key := bytes.Repeat([]byte{0x71}, 32)
	setDEKForTest(boxID, key)
	t.Cleanup(func() {
		for _, view := range []*av.AttributeView{source, target} {
			av.SetAVBoxID(view.ID, "")
		}
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	for _, view := range []*av.AttributeView{source, target} {
		av.SetAVBoxID(view.ID, boxID)
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); err != nil {
			t.Fatal(err)
		}
	}
	itemID := source.GetBlockKeyValues().Values[0].BlockID
	tx := automationStatusTransaction(source, "", statusID, itemID, "Active")
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	stored, err := av.ParseAttributeViewForIndexInBox(target.ID, boxID)
	if err != nil || len(stored.GetBlockKeyValues().Values) != 1 {
		t.Fatal("encrypted automation did not create the related item")
	}
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.DoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	paths := map[string][]byte{}
	for _, view := range []*av.AttributeView{source, target} {
		path := filepath.Join(util.DataDir, boxID, "storage", "av", view.ID+".json")
		ciphertext, err := os.ReadFile(path)
		if err != nil || !util.IsCiphertext(ciphertext) {
			t.Fatalf("automation produced unencrypted data: %v", err)
		}
		paths[path] = ciphertext
		if _, err := os.Stat(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); !os.IsNotExist(err) {
			t.Fatalf("automation created a plaintext copy: %v", err)
		}
	}
	for _, failure := range []string{"locked", "corrupted"} {
		t.Run(failure, func(t *testing.T) {
			if failure == "locked" {
				cachedDEKsLock.Lock()
				delete(cachedDEKs, boxID)
				cachedDEKsLock.Unlock()
				defer setDEKForTest(boxID, key)
			} else {
				path := filepath.Join(util.DataDir, boxID, "storage", "av", target.ID+".json")
				paths[path][len(paths[path])-1] ^= 1
				if err := os.WriteFile(path, paths[path], 0600); err != nil {
					t.Fatal(err)
				}
			}
			cache.ClearAVCache()
			if err := PerformTxSync(automationStatusTransaction(source, "", statusID, itemID, "Done")); err == nil {
				t.Fatal("automation accepted inaccessible encrypted data")
			}
			for path, before := range paths {
				after, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(before, after) {
					t.Fatalf("failed automation changed ciphertext: %v", err)
				}
			}
		})
	}
}

func TestAutomationAssetReferences(t *testing.T) {
	value := &av.Value{Type: av.KeyTypeMAsset, MAsset: []*av.ValueAsset{{Content: "assets/automation.png"}}}
	view := &av.AttributeView{Automations: &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{
		Conditions: []*av.ViewFilter{{Value: value}},
		Actions:    []*av.AutomationAction{{Fields: map[string]*av.AutomationValue{"asset": {Mode: "static", Value: value}}}},
	}}}}
	if assets := getAttributeViewAssetsLinkDests(view, false, nil); !slices.Contains(assets, "assets/automation.png") {
		t.Fatalf("automation asset was omitted from export and cleanup references: %v", assets)
	}
	if !rewriteAttributeViewAssetReferences(view, assetReferenceRewriteOptions{pathMap: map[string]string{
		"assets/automation.png": "assets/renamed.png",
	}}) || value.MAsset[0].Content != "assets/renamed.png" {
		t.Fatal("automation asset was not rewritten after a move or rename")
	}
}
