// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func setupManualAutomationRowsTest(t *testing.T) (*fileOperationTestFixture, *av.AttributeView, *av.AttributeView, apicontract.RunAttributeViewAutomationRequest, string, string) {
	t.Helper()
	fixture, source, target, _, _ := setupAutomationTest(t)
	_, app := templateHTTPTestWindow(t)
	clearManualAutomationRuns()
	t.Cleanup(clearManualAutomationRuns)
	text := ""
	for _, column := range source.KeyValues {
		if column.Key.Type == av.KeyTypeText {
			text = column.Key.ID
			break
		}
	}
	rule := &av.AutomationRule{ID: ast.NewNodeID(), Name: "Rows", Enabled: true, Trigger: "manual", TimeZone: "UTC",
		Actions: []*av.AutomationAction{{Type: "add", Target: "filtered", AvID: target.ID,
			Fields: map[string]*av.AutomationValue{target.GetBlockKey().ID: {Mode: "source", KeyID: source.GetBlockKey().ID}}},
			{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{text: {Mode: "template",
				Template: fmt.Sprintf(`.action{if eq (field %q) "bad"}.action{fromJson "invalid"}.action{else}saved.action{end}`, text)}}}}}
	source.Automations = &av.AutomationConfig{Spec: 10, Rules: []*av.AutomationRule{rule}}
	for index, item := range source.GetBlockKeyValues().Values {
		value := source.GetValue(text, item.BlockID)
		if value == nil {
			value = &av.Value{ID: ast.NewNodeID(), KeyID: text, BlockID: item.BlockID, Type: av.KeyTypeText, Text: &av.ValueText{}}
			column, _ := source.GetKeyValues(text)
			column.Values = append(column.Values, value)
		}
		value.Text.Content = "good"
		if index == 1 {
			value.Text.Content = "bad"
		}
	}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	request := apicontract.RunAttributeViewAutomationRequest{AvID: source.ID, BlockID: fixture.sourceID, RuleID: rule.ID, Rows: true, Action: "start"}
	return fixture, source, target, request, app, text
}

func TestManualAutomationRowsBatchingKeepsProgressAndRevocableOncePermission(t *testing.T) {
	fixture, source, target, request, app, text := setupManualAutomationRowsTest(t)
	source.Automations.Rules[0].Actions[1].Fields[text].Template = "saved"
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	var entries []map[string]any
	for index := len(source.GetBlockKeyValues().Values); index < 70; index++ {
		id := ast.NewNodeID()
		entries = append(entries, map[string]any{"id": id, "itemID": id, "isDetached": true, "content": fmt.Sprint(index)})
	}
	if err := PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "insertAttrViewBlock", AvID: source.ID, BlockID: fixture.sourceID, IgnoreDefaultFill: true, Srcs: entries}}}); err != nil {
		t.Fatal(err)
	}
	initial, err := StartManualAutomationRows(request, app, "main")
	if err != nil || len(initial.Pending) != 70 {
		t.Fatal(initial, err)
	}
	request.RunID, request.Action = initial.RunID, "run"
	newExecution := func() *TemplateHTTPExecution {
		execution, startErr := StartTemplateHTTPExecution(context.Background(), ast.NewNodeID(), app, "main", "rows")
		if startErr != nil {
			t.Fatal(startErr)
		}
		t.Cleanup(execution.Close)
		return execution
	}
	execution := newExecution()
	first, err := RunManualAutomationRows(context.Background(), request, app, "main", execution.Runtime, func(*Transaction) {
		for scope, permission := range execution.sources {
			if !execution.allowSource(scope, permission, "once") {
				t.Error("could not approve the actual saved source")
			}
		}
	})
	if err != nil || len(first.Succeeded) != 32 || len(first.Pending) != 38 {
		t.Fatal("batch boundary not respected", first, err)
	}
	execution.Close()
	request.Step = first.Step
	next := newExecution()
	second, err := RunManualAutomationRows(context.Background(), request, app, "main", next.Runtime, nil)
	if err != nil || len(second.Succeeded) != 64 || len(second.Pending) != 6 {
		t.Fatal(second, err)
	}
	if len(next.sources) != 1 {
		t.Fatal("saved rule scope was not registered")
	}
	for scope, permission := range next.sources {
		if allowed, checkErr := next.sourceAllowed(scope, permission); checkErr != nil || !allowed {
			t.Fatal("once permission did not survive a batch boundary", checkErr)
		}
		if revokeErr := RevokeTemplateHTTPSource(permission.ID); revokeErr != nil {
			t.Fatal(revokeErr)
		}
	}
	next.Close()
	request.Step = second.Step
	final := newExecution()
	last, err := RunManualAutomationRows(context.Background(), request, app, "main", final.Runtime, nil)
	if err != nil || len(last.Succeeded) != 70 || len(last.Pending) != 0 {
		t.Fatal(last, err)
	}
	for scope, permission := range final.sources {
		if allowed, checkErr := final.sourceAllowed(scope, permission); checkErr != nil || allowed {
			t.Fatal("revoked once permission was restored", checkErr)
		}
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 70 {
		t.Fatal("continuing a batch repeated additions")
	}
	cancelTemplateHTTPExecutions()
	if _, err = ManualAutomationRowsStatus(request, app, "main"); !errors.Is(err, ErrManualAutomationExpired) {
		t.Fatal("locking retained progress access")
	}
}

func TestManualAutomationRowsDenialStopsTheRound(t *testing.T) {
	_, source, target, request, app, text := setupManualAutomationRowsTest(t)
	source.Automations.Rules[0].Actions[1].Fields[text].Template = `.action{(httpGet "https://example.com").body}`
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	initial, err := StartManualAutomationRows(request, app, "main")
	if err != nil {
		t.Fatal(err)
	}
	request.RunID, request.Action = initial.RunID, "run"
	prompts := 0
	runtime := templatehttp.New(context.Background(), "rows", func(context.Context, templatehttp.Request) bool { prompts++; return false })
	defer runtime.Close()
	report, err := RunManualAutomationRows(context.Background(), request, app, "main", runtime, nil)
	if err != nil || report.Paused != "denied" || len(report.Succeeded) != 0 || len(report.Pending) != report.Total || prompts != 1 {
		t.Fatal("denial repeated confirmations or wrote a partial row", report, err, prompts)
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 0 {
		t.Fatal("denial committed an earlier action in the row")
	}
}

func TestManualAutomationRowsKeepSuccessRetryFailuresAndRejectReplayedSteps(t *testing.T) {
	fixture, source, target, request, app, text := setupManualAutomationRowsTest(t)
	total := len(source.GetBlockKeyValues().Values)
	initial, err := StartManualAutomationRows(request, app, "main")
	if err != nil || len(initial.Pending) != total {
		t.Fatal("start did not select source records", initial, err)
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != 0 {
		t.Fatal("start executed actions")
	}
	request.RunID, request.Action = initial.RunID, "run"
	report, err := RunManualAutomationRows(context.Background(), request, app, "main", nil, nil)
	if err != nil || len(report.Succeeded) != total-1 || len(report.Failed) != 1 || len(report.Pending) != 0 {
		t.Fatal("row failure discarded another success", report, err)
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != total-1 {
		t.Fatal("a failed row partially added its target")
	}
	first := source.GetBlockKeyValues().Values[0].BlockID
	if readAttributeViewItemsTest(t, source.ID).GetValue(text, first).Text.Content != "saved" {
		t.Fatal("successful source value not saved")
	}
	replayed, err := RunManualAutomationRows(context.Background(), request, app, "main", nil, nil)
	if err != nil || replayed.Step != report.Step || len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != total-1 {
		t.Fatal("replayed step duplicated an addition", err)
	}
	failed := report.Failed[0].ItemID
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "updateAttrViewCell", AvID: source.ID,
		BlockID: fixture.sourceID, KeyID: text, RowID: failed, Data: map[string]any{"text": map[string]any{"content": "good"}}}}}); err != nil {
		t.Fatal(err)
	}
	request.Step, request.Action = report.Step, "retry"
	report, err = RunManualAutomationRows(context.Background(), request, app, "main", nil, nil)
	if err != nil || len(report.Succeeded) != total || len(report.Failed) != 0 || len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != total {
		t.Fatal("retry repeated a successful row or lost a failed row", report, err)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	if entry == nil {
		t.Fatal("successful retry has no undo")
	}
	for _, replay := range [][]*Operation{entry.UndoOperationsForReplay(), entry.DoOperationsForReplay()} {
		if err = PerformTxSync(&Transaction{DoOperations: replay, isReplay: true}); err != nil {
			t.Fatal(err)
		}
	}
	if len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != total {
		t.Fatal("redo duplicated or lost the saved target")
	}
}

func TestManualAutomationRowsBudgetPauseOwnershipAndChangedRules(t *testing.T) {
	_, source, target, request, app, _ := setupManualAutomationRowsTest(t)
	total := len(source.GetBlockKeyValues().Values)
	for _, column := range source.KeyValues {
		if column.Key.Type == av.KeyTypeText {
			for _, value := range column.Values {
				value.Text.Content = "good"
			}
		}
	}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	initial, err := StartManualAutomationRows(request, app, "main")
	if err != nil {
		t.Fatal(err)
	}
	request.RunID, request.Action = initial.RunID, "run"
	if _, err = ManualAutomationRowsStatus(request, "other", "main"); !errors.Is(err, ErrManualAutomationExpired) {
		t.Fatal("another window read progress", err)
	}
	report, err := RunManualAutomationRows(context.Background(), request, app, "main", nil, func(*Transaction) {
		manualAutomationRuns.Lock()
		manualAutomationRuns.values[request.RunID].operations = maxAutomationOperations
		manualAutomationRuns.Unlock()
	})
	if err != nil || report.Paused != "budget" || len(report.Succeeded) != 1 || len(report.Pending) != total-1 {
		t.Fatal("budget did not pause after saving the first result", report, err)
	}
	request.Step, request.Action = report.Step, "retry"
	report, err = RunManualAutomationRows(context.Background(), request, app, "main", nil, nil)
	if err != nil || len(report.Succeeded) != total || len(readAttributeViewItemsTest(t, target.ID).GetBlockKeyValues().Values) != total {
		t.Fatal("continuation repeated completed rows", report, err)
	}
	manualAutomationRuns.Lock()
	manualAutomationRuns.values[request.RunID].expires = time.Now().Add(-time.Second)
	manualAutomationRuns.Unlock()
	if _, err = ManualAutomationRowsStatus(request, app, "main"); !errors.Is(err, ErrManualAutomationExpired) {
		t.Fatal("expired progress accepted")
	}
	initial, err = StartManualAutomationRows(apicontract.RunAttributeViewAutomationRequest{AvID: source.ID, BlockID: request.BlockID, RuleID: request.RuleID}, app, "main")
	if err != nil {
		t.Fatal(err)
	}
	stored := readAttributeViewItemsTest(t, source.ID)
	stored.Automations.Rules[0].Name = "changed"
	if err = av.SaveAttributeView(stored); err != nil {
		t.Fatal(err)
	}
	request.RunID, request.Step, request.Action = initial.RunID, 0, "run"
	report, err = RunManualAutomationRows(context.Background(), request, app, "main", nil, nil)
	if err != nil || report.Paused != "changed" || len(report.Succeeded) != 0 {
		t.Fatal("changed rule used an old execution plan", report, err)
	}
}
