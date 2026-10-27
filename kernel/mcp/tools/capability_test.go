// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import "testing"

func TestCapabilityIDForToolFallback(t *testing.T) {
	pluginTool := &Tool{Name: "echo", Source: "plugin", OwnerID: "sample"}
	if id := CapabilityIDForTool(pluginTool); id != "plugin/backend/sample/echo" {
		t.Fatalf("unexpected plugin capability ID: %s", id)
	}
	nativeTool := &Tool{Name: "search"}
	if id := CapabilityIDForTool(nativeTool); id != "native/backend/search" {
		t.Fatalf("unexpected native capability ID: %s", id)
	}
}

func TestCapabilityActionsForTool(t *testing.T) {
	tool := &Tool{
		InputSchema: ToolSchema{Properties: map[string]Property{
			"action": {Type: "string", Enum: []string{"read", "write"}},
		}},
		ActionEffects: map[string]ToolEffects{
			"":      {LocalRead: true},
			"write": {LocalWrite: true},
		},
	}
	actions := capabilityActionsForTool(tool)
	if len(actions) != 2 || actions[0].Name != "read" || actions[1].Name != "write" {
		t.Fatalf("unexpected capability actions: %#v", actions)
	}
	if !actions[0].Effects.LocalRead || !actions[1].Effects.LocalWrite {
		t.Fatalf("capability action effects were not resolved: %#v", actions)
	}
}

func TestCapabilityManifestIncludesAgentOnly(t *testing.T) {
	manifests := ListCapabilityManifests()
	found := map[string]bool{}
	for _, manifest := range manifests {
		if manifest.Name == QuestionTool.Name || manifest.Name == TodoWriteTool.Name || manifest.Name == AgentLogTool.Name {
			found[manifest.Name] = manifest.AgentOnly
		}
	}
	for _, name := range []string{QuestionTool.Name, TodoWriteTool.Name, AgentLogTool.Name} {
		if !found[name] {
			t.Fatalf("Agent-only capability metadata is missing: %s", name)
		}
	}
}
