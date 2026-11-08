// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestManualAutomationStoresResultsAndReplaysWithoutEvaluation(t *testing.T) {
	fixture, source, _, _, _ := setupAutomationTest(t)
	key := source.GetBlockKey()
	rule := source.Automations.Rules[0]
	source.Automations.Spec, source.Automations.Rules = 9, []*av.AutomationRule{rule}
	rule.Trigger, rule.Conditions, rule.TimeZone = "manual", nil, "UTC"
	rule.Actions = []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
		key.ID: {Mode: "template", Template: fmt.Sprintf(`.action{field %q} .action{(now).UnixNano}`, key.ID)},
	}}}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	item := source.GetBlockKeyValues().Values[0]
	before := item.Block.Content
	if err := RunAttributeViewAutomation(context.Background(), source.ID, fixture.sourceID, rule.ID, nil); err != nil {
		t.Fatal(err)
	}
	stored := readAttributeViewItemsTest(t, source.ID)
	after := stored.GetBlockValue(item.BlockID).Block.Content
	if before == after {
		t.Fatal("manual automation did not persist the value")
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	if entry == nil {
		t.Fatal("manual automation did not create undo history")
	}
	if err := PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if got := readAttributeViewItemsTest(t, source.ID).GetBlockValue(item.BlockID).Block.Content; got != before {
		t.Fatal("undo failed", got, before)
	}
	if err := PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if got := readAttributeViewItemsTest(t, source.ID).GetBlockValue(item.BlockID).Block.Content; got != after {
		t.Fatal("redo reevaluated the template", got, after)
	}
}

func TestManualAutomationFailurePreservesStoredValues(t *testing.T) {
	for _, mode := range []string{"denied", "invalid-json", "canceled", "disabled"} {
		t.Run(mode, func(t *testing.T) {
			fixture, source, _, _, _ := setupAutomationTest(t)
			previous := util.ConfDir
			util.ConfDir = t.TempDir()
			defer func() { util.ConfDir = previous }()
			rule := source.Automations.Rules[0]
			source.Automations.Spec, source.Automations.Rules = 9, []*av.AutomationRule{rule}
			rule.Trigger, rule.Conditions, rule.TimeZone = "manual", nil, "UTC"
			formula := `.action{$r := httpGet "https://httpbingo.org/json"}.action{(fromJson $r.body).slideshow.title}`
			if mode == "invalid-json" {
				formula = `.action{fromJson "invalid"}`
			}
			rule.Actions = []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
				source.GetBlockKey().ID: {Mode: "template", Template: formula},
			}}}
			rule.Enabled = mode != "disabled"
			if err := av.SaveAttributeView(source); err != nil {
				t.Fatal(err)
			}
			before := attributeViewAutomationVersion(source)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "canceled" {
				cancel()
			}
			requests := 0
			runtime := templatehttp.New(ctx, "manual", func(context.Context, templatehttp.Request) bool {
				requests++
				if !flushLock.TryLock() {
					t.Error("HTTP confirmation holds the editing transaction lock")
				} else {
					flushLock.Unlock()
				}
				return false
			})
			defer runtime.Close()
			err := RunAttributeViewAutomation(ctx, source.ID, fixture.sourceID, rule.ID, runtime)
			if err == nil {
				t.Fatal("failed manual execution succeeded")
			}
			if mode == "denied" && requests != 1 {
				t.Fatal("manual HTTP did not request confirmation", err)
			}
			if got := attributeViewAutomationVersion(readAttributeViewItemsTest(t, source.ID)); got != before {
				t.Fatal("failed manual execution changed stored data")
			}
			if mode != "denied" && requests != 0 {
				t.Fatal("non-network failure requested HTTP permission")
			}
		})
	}
}

func TestManualAutomationRejectsChangedSnapshotBeforeWriting(t *testing.T) {
	fixture, source, _, _, _ := setupAutomationTest(t)
	plan := &storedAttributeViewAutomation{ctx: context.Background(), at: time.Now(),
		source:   &attributeViewAutomationSource{before: source, blockID: fixture.sourceID},
		versions: map[string]string{source.ID: attributeViewAutomationVersion(source)}}
	source.Name = "Changed while requesting"
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	if err := PerformTransactionSync(&Transaction{storedAutomation: plan, fromAPI: true}); err == nil {
		t.Fatal("stale manual result overwrote the changed database")
	}
	if got := readAttributeViewItemsTest(t, source.ID).Name; got != source.Name {
		t.Fatal("stale execution lost a concurrent change")
	}
}
