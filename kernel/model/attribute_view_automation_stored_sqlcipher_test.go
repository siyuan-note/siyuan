// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupStoredAutomationEncryptedTest(t *testing.T) (*fileOperationTestFixture, *av.AttributeView, *av.Key) {
	t.Helper()
	fixture, view, _, _, _ := setupAutomationTest(t)
	view.Automations = &av.AutomationConfig{Spec: 8, Rules: []*av.AutomationRule{}}
	boxID := fixture.box.ID
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	markRuntimeEncryptedBox(boxID)
	dek := bytes.Repeat([]byte{0x68}, 32)
	prepareUnlockedEncryptedBoxTest(t, boxID, dek)
	encryptDocumentTestSources(t, dek, tree)
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted, boxConf.BoxCrypt = true, &conf.BoxEncryption{Spec: boxEncryptionSpec}
	if err = encryptBoxMetadata(boxID, boxConf, dek); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(boxConf)
	if err = os.WriteFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	mountedEncryptedBoxes.Store(boxID, true)
	previousTemp := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() {
		treenode.CloseEncryptedBlockTreeDB(boxID)
		util.TempDir = previousTemp
		mountedEncryptedBoxes.Delete(boxID)
		av.SetAVBoxID(view.ID, "")
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
		t.Fatal(err)
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	av.SetAVBoxID(view.ID, boxID)
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	view, err = av.ParseAttributeViewForIndexInBox(view.ID, boxID)
	if err != nil || view.Automations.Spec != 8 {
		t.Fatal("previous encrypted automation format unreadable", err)
	}
	var key *av.Key
	for _, column := range view.KeyValues {
		if column.Key.Type == av.KeyTypeText {
			key = column.Key
			break
		}
	}
	if key == nil {
		t.Fatal("unexpected text fixture")
	}
	return fixture, view, key
}

func TestManualAutomationRowsEncryptedPartialResultsRemainAuthenticated(t *testing.T) {
	fixture, view, key := setupStoredAutomationEncryptedTest(t)
	_, app := templateHTTPTestWindow(t)
	clearManualAutomationRuns()
	t.Cleanup(clearManualAutomationRuns)
	failed := view.GetBlockKeyValues().Values[0].BlockID
	view.Automations = &av.AutomationConfig{Spec: 10, Rules: []*av.AutomationRule{{ID: "20261109000000-rowrule", Name: "Rows", Enabled: true, Trigger: "manual", TimeZone: "UTC",
		Actions: []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{key.ID: {Mode: "template",
			Template: fmt.Sprintf(`.action{if eq .ItemID %q}.action{fromJson "invalid"}.action{else}encrypted partial result.action{end}`, failed)}}}}}}}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	request := apicontract.RunAttributeViewAutomationRequest{AvID: view.ID, BlockID: fixture.sourceID, RuleID: view.Automations.Rules[0].ID, Rows: true}
	initial, err := StartManualAutomationRows(request, app, "main")
	if err != nil {
		t.Fatal(err)
	}
	request.RunID, request.Action = initial.RunID, "run"
	report, err := RunManualAutomationRows(context.Background(), request, app, "main", nil, nil)
	if err != nil || len(report.Failed) != 1 || len(report.Succeeded) != report.Total-1 {
		t.Fatal("encrypted partial results lost", report, err)
	}
	path := filepath.Join(util.DataDir, fixture.box.ID, "storage", "av", view.ID+".json")
	ciphertext, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(ciphertext) || bytes.Contains(ciphertext, []byte("encrypted partial result")) {
		t.Fatal("partial results leaked to plaintext", err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); !os.IsNotExist(err) {
		t.Fatal("partial execution created plaintext fallback")
	}
	ciphertext[len(ciphertext)-1] ^= 1
	if err = os.WriteFile(path, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	request.Step, request.Action = report.Step, "retry"
	if _, err = RunManualAutomationRows(context.Background(), request, app, "main", nil, nil); err != nil {
		t.Fatal(err)
	}
	stored, _ := os.ReadFile(path)
	if !bytes.Equal(stored, ciphertext) {
		t.Fatal("retry changed unauthenticated ciphertext")
	}
}

func TestManualAutomationEncryptedPersistenceAndReplay(t *testing.T) {
	fixture, view, key := setupStoredAutomationEncryptedTest(t)
	boxID := fixture.box.ID
	rule := &av.AutomationRule{ID: "20261108000000-manual1", Name: "Manual", Enabled: true, Trigger: "manual", TimeZone: "UTC",
		Actions: []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
			key.ID: {Mode: "template", Template: `.action{now | date "2006-01-02T15:04:05.999999999Z07:00"}`},
		}}}}
	view.Automations = &av.AutomationConfig{Spec: 9, Rules: []*av.AutomationRule{rule}}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	item := view.GetBlockKeyValues().Values[0].BlockID
	before := view.GetValue(key.ID, item).Text.Content
	if err := RunAttributeViewAutomation(context.Background(), view.ID, fixture.sourceID, rule.ID, nil); err != nil {
		t.Fatal(err)
	}
	read := func() string {
		cache.ClearAVCache()
		stored, err := av.ParseAttributeViewForIndexInBox(view.ID, boxID)
		if err != nil {
			t.Fatal(err)
		}
		return stored.GetValue(key.ID, item).Text.Content
	}
	after := read()
	if after == before {
		t.Fatal("manual result not stored")
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	if entry == nil {
		t.Fatal("encrypted manual execution has no undo")
	}
	if err := PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if read() != before {
		t.Fatal("encrypted undo changed the original value")
	}
	if err := PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if read() != after {
		t.Fatal("encrypted redo reevaluated the template")
	}
	path := filepath.Join(util.DataDir, boxID, "storage", "av", view.ID+".json")
	ciphertext, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(ciphertext) || bytes.Contains(ciphertext, []byte(after)) {
		t.Fatal("plaintext manual results persisted", err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); !os.IsNotExist(err) {
		t.Fatal("plaintext fallback created")
	}
	ciphertext[len(ciphertext)-1] ^= 1
	if err = os.WriteFile(path, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	if err = RunAttributeViewAutomation(context.Background(), view.ID, fixture.sourceID, rule.ID, nil); err == nil {
		t.Fatal("unauthenticated database accepted")
	}
	stored, _ := os.ReadFile(path)
	if !bytes.Equal(stored, ciphertext) {
		t.Fatal("failed authentication changed ciphertext")
	}
}

func TestAutomaticHTTPEncryptedPersistenceAndReplay(t *testing.T) {
	fixture, view, key := setupStoredAutomationEncryptedTest(t)
	_, app := templateHTTPTestWindow(t)
	view.Automations = &av.AutomationConfig{Spec: 10, Rules: []*av.AutomationRule{{ID: "20261109000000-autorul", Name: "Fetch", Enabled: true,
		Trigger: "changed", KeyID: key.ID, TimeZone: "UTC", Actions: []*av.AutomationAction{{Type: "edit", Target: "current",
			Fields: map[string]*av.AutomationValue{key.ID: {Mode: "template", Template: `.action{if false}.action{httpGet "https://example.com"}.action{end}.action{printf "%s" "encrypted result"}`}}}}}}}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	item := view.GetBlockKeyValues().Values[0].BlockID
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "updateAttrViewCell", AvID: view.ID, BlockID: fixture.sourceID,
		KeyID: key.ID, RowID: item, Data: map[string]any{"text": map[string]any{"content": "saved input"}}}}}
	tx.SetHTTPAutomationOwner(app, "main")
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	job, ctx, finish := claimHTTPAutomationTest(t, tx, app)
	defer finish()
	if job.BoxID != fixture.box.ID {
		t.Fatal("encrypted task lost its notebook scope")
	}
	if err := runStoredAttributeViewAutomation(ctx, view.ID, fixture.sourceID, "", nil, job, nil); err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	if entry == nil {
		t.Fatal("encrypted automatic result has no undo")
	}
	for _, step := range []struct {
		ops  []*Operation
		want string
	}{{entry.UndoOperationsForReplay(), "saved input"}, {entry.DoOperationsForReplay(), "encrypted result"}} {
		if err := PerformTxSync(&Transaction{DoOperations: step.ops, isReplay: true}); err != nil {
			t.Fatal(err)
		}
		cache.ClearAVCache()
		stored, err := av.ParseAttributeViewForIndexInBox(view.ID, fixture.box.ID)
		if err != nil || stored.GetValue(key.ID, item).Text.Content != step.want {
			t.Fatal("encrypted automatic replay changed the saved result", err)
		}
	}
	path := filepath.Join(util.DataDir, fixture.box.ID, "storage", "av", view.ID+".json")
	data, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(data) || bytes.Contains(data, []byte("encrypted result")) {
		t.Fatal("automatic result did not remain encrypted", err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); !os.IsNotExist(err) {
		t.Fatal("automatic result created a plaintext fallback")
	}
}
