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
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func setupHTTPAutomationTest(t *testing.T, trigger string) (*fileOperationTestFixture, *av.AttributeView, string, string, string) {
	t.Helper()
	fixture, view, _, status, _ := setupAutomationTest(t)
	_, app := templateHTTPTestWindow(t)
	var text string
	for _, column := range view.KeyValues {
		if column.Key.Type == av.KeyTypeText {
			text = column.Key.ID
			break
		}
	}
	view.Automations = &av.AutomationConfig{Spec: 10, Rules: []*av.AutomationRule{{ID: ast.NewNodeID(), Name: "Fetch", Enabled: true, Trigger: trigger,
		KeyID: status, TimeZone: "UTC", Actions: []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
			text: {Mode: "template", Template: `.action{if false}.action{httpGet "https://example.com"}.action{end}remote value`},
		}}}}}}
	if trigger == "added" {
		view.Automations.Rules[0].KeyID = ""
	}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	attributeViewHTTPAutomations.Lock()
	oldJobs, oldActive := attributeViewHTTPAutomations.jobs, attributeViewHTTPAutomations.active
	attributeViewHTTPAutomations.jobs, attributeViewHTTPAutomations.active = map[string]*attributeViewHTTPAutomation{}, map[string]string{}
	attributeViewHTTPAutomations.Unlock()
	t.Cleanup(func() {
		attributeViewHTTPAutomations.Lock()
		defer attributeViewHTTPAutomations.Unlock()
		for _, job := range attributeViewHTTPAutomations.jobs {
			dropAttributeViewHTTPAutomation(job)
		}
		attributeViewHTTPAutomations.jobs, attributeViewHTTPAutomations.active = oldJobs, oldActive
	})
	return fixture, view, status, text, app
}

func httpAutomationEdit(t *testing.T, fixture *fileOperationTestFixture, view *av.AttributeView, status, item, value, app string) *Transaction {
	t.Helper()
	current := readAttributeViewItemsTest(t, view.ID)
	tx := automationStatusTransaction(current, fixture.sourceID, status, item, value)
	tx.DoOperations = append(tx.DoOperations, &Operation{Action: "doUpdateUpdated", ID: fixture.sourceID, Data: "20261109000000"})
	tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "doUpdateUpdated", ID: fixture.sourceID, Data: "20261108000000"})
	tx.SetHTTPAutomationOwner(app, "main")
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	return tx
}

func claimHTTPAutomationTest(t *testing.T, tx *Transaction, app string) (*attributeViewHTTPAutomation, context.Context, func()) {
	t.Helper()
	jobs := tx.HTTPAutomationJobs()
	if len(jobs) != 1 {
		t.Fatalf("expected one merged task, got %d", len(jobs))
	}
	job, ctx, finish, err := ClaimAttributeViewHTTPAutomation(context.Background(), jobs[0].ID, jobs[0].AVID, jobs[0].BlockID, app, "main")
	if err != nil {
		t.Fatal(err)
	}
	return job, ctx, finish
}

func TestAutomaticHTTPCommitsEditsBeforeFetchingAndSeparatesUndo(t *testing.T) {
	fixture, view, status, text, app := setupHTTPAutomationTest(t, "changed")
	item := view.GetBlockKeyValues().Values[0].BlockID
	before := view.GetValue(text, item).Text.Content
	tx := httpAutomationEdit(t, fixture, view, status, item, "Active", app)
	edit := GlobalUndoLog.Peek(fixture.sourceID)
	if edit == nil {
		t.Fatal("source edit has no undo")
	}
	if readAttributeViewItemsTest(t, view.ID).GetValue(text, item).Text.Content != before {
		t.Fatal("HTTP ran inside the source edit")
	}
	job, ctx, finish := claimHTTPAutomationTest(t, tx, app)
	defer finish()
	var result *Transaction
	if err := runStoredAttributeViewAutomation(ctx, view.ID, fixture.sourceID, "", nil, job, &result); err != nil {
		t.Fatal(err)
	}
	if result == nil || readAttributeViewItemsTest(t, view.ID).GetValue(text, item).Text.Content != "remote value" {
		t.Fatal("deferred result not stored")
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	if entry == nil || entry == edit {
		t.Fatal("HTTP result did not create a separate undo step")
	}
	for _, step := range []struct {
		operations []*Operation
		want       string
	}{{entry.UndoOperationsForReplay(), before}, {edit.UndoOperationsForReplay(), before},
		{edit.DoOperationsForReplay(), before}, {entry.DoOperationsForReplay(), "remote value"}} {
		if err := PerformTxSync(&Transaction{DoOperations: step.operations, isReplay: true}); err != nil {
			t.Fatal(err)
		}
		if got := readAttributeViewItemsTest(t, view.ID).GetValue(text, item).Text.Content; got != step.want {
			t.Fatal("replay changed stored results", got, step.want)
		}
	}
}

func TestAutomaticHTTPDenialPreservesCommittedEdits(t *testing.T) {
	fixture, view, status, text, app := setupHTTPAutomationTest(t, "changed")
	view.Automations.Rules[0].Actions[0].Fields[text].Template = `.action{(httpGet "https://example.com").body}`
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	item := view.GetBlockKeyValues().Values[0].BlockID
	tx := httpAutomationEdit(t, fixture, view, status, item, "Active", app)
	job, ctx, finish := claimHTTPAutomationTest(t, tx, app)
	defer finish()
	requests := 0
	runtime := templatehttp.New(ctx, "test", func(context.Context, templatehttp.Request) bool {
		requests++
		if !flushLock.TryLock() {
			t.Error("network confirmation holds the editing lock")
		} else {
			flushLock.Unlock()
		}
		return false
	})
	defer runtime.Close()
	if err := runStoredAttributeViewAutomation(ctx, view.ID, fixture.sourceID, "", runtime, job, nil); err == nil || requests != 1 {
		t.Fatal("HTTP denial not exercised", err, requests)
	}
	stored := readAttributeViewItemsTest(t, view.ID)
	if stored.GetValue(text, item).Text.Content != view.GetValue(text, item).Text.Content || stored.GetValue(status, item).MSelect[0].Content != "Active" {
		t.Fatal("failed HTTP changed the saved edit or previous result")
	}
}

func TestAutomaticHTTPMergesRowsCancelsOldExecutionAndRejectsReplay(t *testing.T) {
	fixture, view, status, _, app := setupHTTPAutomationTest(t, "changed")
	first := httpAutomationEdit(t, fixture, view, status, view.GetBlockKeyValues().Values[0].BlockID, "Active", app)
	job, ctx, finish := claimHTTPAutomationTest(t, first, app)
	defer finish()
	if _, _, _, err := ClaimAttributeViewHTTPAutomation(ctx, job.ID, view.ID, fixture.sourceID, app, "main"); !errors.Is(err, ErrAutomaticHTTPObsolete) {
		t.Fatal("task replay accepted", err)
	}
	second := httpAutomationEdit(t, fixture, view, status, view.GetBlockKeyValues().Values[1].BlockID, "Active", app)
	if ctx.Err() == nil {
		t.Fatal("new edit did not cancel the previous HTTP execution")
	}
	latest, _, closeLatest := claimHTTPAutomationTest(t, second, app)
	defer closeLatest()
	if len(latest.rules[view.Automations.Rules[0].ID]) != 2 {
		t.Fatal("coalescing lost a changed row")
	}
}

func TestAutomaticHTTPRejectsWrongWindowAndExpires(t *testing.T) {
	fixture, view, status, _, app := setupHTTPAutomationTest(t, "changed")
	tx := httpAutomationEdit(t, fixture, view, status, view.GetBlockKeyValues().Values[0].BlockID, "Active", app)
	job := tx.HTTPAutomationJobs()[0]
	if _, _, _, err := ClaimAttributeViewHTTPAutomation(context.Background(), job.ID, view.ID, fixture.sourceID, "other", "main"); err == nil {
		t.Fatal("wrong window claimed the task")
	}
	attributeViewHTTPAutomations.Lock()
	attributeViewHTTPAutomations.jobs[job.ID].expires = time.Now().Add(-time.Second)
	attributeViewHTTPAutomations.Unlock()
	if _, _, _, err := ClaimAttributeViewHTTPAutomation(context.Background(), job.ID, view.ID, fixture.sourceID, app, "main"); !errors.Is(err, ErrAutomaticHTTPObsolete) {
		t.Fatal("expired task accepted", err)
	}
}

func TestAutomaticHTTPWithoutInteractiveWindowDoesNotFetch(t *testing.T) {
	fixture, view, status, text, _ := setupHTTPAutomationTest(t, "changed")
	item := view.GetBlockKeyValues().Values[0].BlockID
	tx := httpAutomationEdit(t, fixture, view, status, item, "Active", "")
	if len(tx.HTTPAutomationJobs()) != 0 {
		t.Fatal("background write queued interactive HTTP")
	}
	if readAttributeViewItemsTest(t, view.ID).GetValue(text, item).Text.Content != view.GetValue(text, item).Text.Content {
		t.Fatal("background write executed HTTP")
	}
}

func TestAutomaticHTTPAddedOnlyProcessesNewRow(t *testing.T) {
	fixture, view, _, text, app := setupHTTPAutomationTest(t, "added")
	item := ast.NewNodeID()
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "insertAttrViewBlock", AvID: view.ID, BlockID: fixture.sourceID,
		IgnoreDefaultFill: true, Srcs: []map[string]any{{"id": item, "itemID": item, "isDetached": true, "content": "New"}}}}}
	tx.SetHTTPAutomationOwner(app, "main")
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	job, ctx, finish := claimHTTPAutomationTest(t, tx, app)
	defer finish()
	if err := runStoredAttributeViewAutomation(ctx, view.ID, fixture.sourceID, "", nil, job, nil); err != nil {
		t.Fatal(err)
	}
	stored := readAttributeViewItemsTest(t, view.ID)
	if stored.GetValue(text, item).Text.Content != "remote value" {
		t.Fatal("new row did not receive its deferred result")
	}
	for _, old := range view.GetBlockKeyValues().Values {
		if stored.GetValue(text, old.BlockID).Text.Content != view.GetValue(text, old.BlockID).Text.Content {
			t.Fatal("added trigger fetched an existing row")
		}
	}
}

func TestAutomaticHTTPMultipleRulesShareOneResultTransaction(t *testing.T) {
	fixture, view, status, text, app := setupHTTPAutomationTest(t, "changed")
	view.Automations.Rules = append(view.Automations.Rules, &av.AutomationRule{ID: ast.NewNodeID(), Name: "Second fetch", Enabled: true,
		Trigger: "changed", KeyID: status, TimeZone: "UTC", Actions: []*av.AutomationAction{{Type: "edit", Target: "current",
			Fields: map[string]*av.AutomationValue{text: {Mode: "template", Template: `.action{if false}.action{httpGet "https://example.com"}.action{end}second result`}}}}})
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	item := view.GetBlockKeyValues().Values[0].BlockID
	tx := httpAutomationEdit(t, fixture, view, status, item, "Active", app)
	job, ctx, finish := claimHTTPAutomationTest(t, tx, app)
	defer finish()
	if len(job.rules) != 2 {
		t.Fatal("one event lost a matching rule")
	}
	var result *Transaction
	if err := runStoredAttributeViewAutomation(ctx, view.ID, fixture.sourceID, "", nil, job, &result); err != nil || result == nil {
		t.Fatal("rules did not commit together", err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetValue(text, item).Text.Content != "second result" {
		t.Fatal("saved rule order was not respected")
	}
}

func TestAutomaticHTTPUndoCancelsPendingResult(t *testing.T) {
	fixture, view, status, _, app := setupHTTPAutomationTest(t, "changed")
	tx := httpAutomationEdit(t, fixture, view, status, view.GetBlockKeyValues().Values[0].BlockID, "Active", app)
	job, ctx, finish := claimHTTPAutomationTest(t, tx, app)
	defer finish()
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() == nil {
		t.Fatal("undo left the previous request running")
	}
	if err := runStoredAttributeViewAutomation(ctx, view.ID, fixture.sourceID, "", nil, job, nil); err == nil {
		t.Fatal("undone input accepted an HTTP result")
	}
}

func TestAutomaticHTTPQueueLimitRejectsWholeJob(t *testing.T) {
	fixture, view, _, _, app := setupHTTPAutomationTest(t, "changed")
	tx := &Transaction{}
	tx.SetHTTPAutomationOwner(app, "main")
	source := &attributeViewAutomationSource{before: view, blockID: fixture.sourceID, boxID: fixture.box.ID}
	for i := 0; i < maxAutomationOperations; i++ {
		tx.queueHTTPAutomation(source, view.Automations.Rules[0], fmt.Sprint(i))
	}
	tx.queueHTTPAutomation(source, view.Automations.Rules[0], "0")
	job := tx.pendingHTTPAutomations[fixture.box.ID+"/"+view.ID]
	if job.overflow {
		t.Fatal("duplicate row exceeded the queue limit")
	}
	tx.queueHTTPAutomation(source, view.Automations.Rules[0], "extra")
	if !job.overflow {
		t.Fatal("queue limit was not enforced")
	}
	if err := runStoredAttributeViewAutomation(context.Background(), view.ID, fixture.sourceID, "", nil, job, nil); err == nil {
		t.Fatal("oversized job partially executed")
	}
}
