// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupMemoryTool(t *testing.T) {
	t.Helper()
	oldConf, oldDir, oldReadOnly := model.Conf, util.DataDir, util.ReadOnly
	model.Conf = model.NewAppConf()
	model.Conf.AI.Store(conf.NewAI())
	model.Conf.AI.Load().Memory.Enabled = true
	model.Conf.Sync.Store(conf.NewSync())
	util.DataDir = t.TempDir()
	util.ReadOnly = false
	t.Cleanup(func() { model.Conf, util.DataDir, util.ReadOnly = oldConf, oldDir, oldReadOnly })
}
func memoryToolCall(t *testing.T, args map[string]any) map[string]any {
	t.Helper()
	_, validator := LookupToolWithValidator("memory")
	if err := validator.ValidateInput(args); err != nil {
		t.Fatal(err)
	}
	result, err := memoryHandler(context.Background(), args)
	if err != nil || result.IsError {
		t.Fatalf("memory: %+v %v", result, err)
	}
	var value map[string]any
	if err = json.Unmarshal([]byte(result.Content[0].Text), &value); err != nil {
		t.Fatal(err)
	}
	return value
}
func TestMemoryToolRegistrationSchemaAndEffects(t *testing.T) {
	tool, validator := LookupToolWithValidator("memory")
	if tool == nil || validator == nil || !tool.AgentOnly {
		t.Fatal("memory must be registered as agent only")
	}
	for _, action := range []string{"remember", "update", "disable", "forget"} {
		effects, ok := tool.EffectsFor(action)
		if !ok || !effects.LocalWrite || !effects.DataEgress || !effects.ExternalCost {
			t.Fatalf("incorrect write effect %s: %+v", action, effects)
		}
	}
	for _, action := range []string{"list", "get"} {
		effects, ok := tool.EffectsFor(action)
		if !ok || !effects.LocalRead || effects.LocalWrite {
			t.Fatalf("incorrect read effect %s", action)
		}
	}
	for _, args := range []map[string]any{{"action": "forget"}, {"action": "remember", "content": "hello"}, {"action": "update", "id": "20261029120000-abcdefg", "content": "new"}, {"action": "list", "offset": -1}, {"action": "list", "path": "/secret"}, {"action": "remember", "operationId": "x", "content": "hi", "state": "active"}} {
		if err := validator.ValidateInput(args); err == nil {
			t.Fatalf("invalid tool arguments accepted: %+v", args)
		}
	}
}
func TestMemoryToolManualLifecycle(t *testing.T) {
	setupMemoryTool(t)
	first := memoryToolCall(t, map[string]any{"action": "remember", "content": "Prefer concise replies", "kind": "preference", "operationId": "remember-1"})
	id, revision := first["id"].(string), first["revision"].(string)
	if first["saved"] != true {
		t.Fatal("save not confirmed")
	}
	again := memoryToolCall(t, map[string]any{"action": "remember", "content": "Prefer concise replies", "kind": "preference", "operationId": "remember-1"})
	if again["id"] != id {
		t.Fatal("retry duplicated memory")
	}
	item := memoryToolCall(t, map[string]any{"action": "get", "id": id})
	if item["record"].(map[string]any)["content"] != "Prefer concise replies" {
		t.Fatal("read mismatch")
	}
	second := memoryToolCall(t, map[string]any{"action": "update", "id": id, "revision": revision, "content": "Detailed tutorials", "operationId": "update-1"})
	disabled := memoryToolCall(t, map[string]any{"action": "disable", "id": id, "revision": second["revision"], "operationId": "disable-1"})
	forgotten := memoryToolCall(t, map[string]any{"action": "forget", "id": id, "revision": disabled["revision"], "operationId": "forget-1"})
	if forgotten["saved"] != true {
		t.Fatal("forget not confirmed")
	}
	listed := memoryToolCall(t, map[string]any{"action": "list"})
	if len(listed["records"].([]any)) != 0 {
		t.Fatal("forgotten item listed")
	}
}
func TestMemoryToolReadonlyAndUnavailable(t *testing.T) {
	setupMemoryTool(t)
	util.ReadOnly = true
	result, err := memoryHandler(context.Background(), map[string]any{"action": "remember", "content": "hello", "operationId": "readonly"})
	if err != nil || !result.IsError {
		t.Fatal("read-only write accepted")
	}
	util.ReadOnly = false
	model.Conf.AI.Load().Agent.CapabilityPolicy.Default = "deny"
	result, err = memoryHandler(context.Background(), map[string]any{"action": "list"})
	if err != nil || !result.IsError || !strings.Contains(result.Content[0].Text, "unavailable") {
		t.Fatal("disabled capability exposed")
	}
}

func TestMemoryToolDisabledDoesNotExposeCapability(t *testing.T) {
	setupMemoryTool(t)
	model.Conf.AI.Load().Memory.Enabled = false
	if memoryAvailable() {
		t.Fatal("disabled memory capability remained available")
	}
	result, err := memoryHandler(context.Background(), map[string]any{"action": "list"})
	if err != nil || !result.IsError {
		t.Fatal("disabled memory accepted a model request")
	}
}
