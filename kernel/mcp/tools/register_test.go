// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package tools

import "testing"

func TestGetAllToolsSorted(t *testing.T) {
	allTools := GetAllTools()
	for i := 1; i < len(allTools); i++ {
		if allTools[i-1].Name > allTools[i].Name {
			t.Fatalf("tools are not sorted: %q appears before %q", allTools[i-1].Name, allTools[i].Name)
		}
	}
}

func TestBuildCapabilityIDKeepsSegmentsDistinct(t *testing.T) {
	first := BuildCapabilityID("plugin", "backend", "example/plugin", "a/b")
	second := BuildCapabilityID("plugin", "backend", "example_plugin", "a_b")
	if first == second {
		t.Fatalf("different capability segments produced the same ID: %s", first)
	}
	if first != BuildCapabilityID("plugin", "backend", "example/plugin", "a/b") {
		t.Fatal("capability ID is not stable")
	}
}

func TestToolEffectsForFallsBackToCapabilityDefault(t *testing.T) {
	tool := &Tool{ActionEffects: map[string]ToolEffects{
		"":      {LocalRead: true},
		"write": {LocalWrite: true},
	}}
	if effects, ok := tool.EffectsFor("read"); !ok || !effects.LocalRead {
		t.Fatal("capability-level effects were not used as the action fallback")
	}
	if effects, ok := tool.EffectsFor("write"); !ok || !effects.LocalWrite || effects.LocalRead {
		t.Fatal("action effects did not override capability-level effects")
	}
}

func TestObserveRegistry(t *testing.T) {
	const name = "registry_observer_test"
	RemoveTool(name)

	var events []*Tool
	stop := ObserveRegistry(func(changedName string, tool *Tool) {
		if changedName == name {
			events = append(events, tool)
		}
	})
	t.Cleanup(func() {
		stop()
		RemoveTool(name)
	})

	tool := &Tool{Name: name, InputSchema: ToolSchema{Type: "object"}}
	if err := SetTool(name, tool); err != nil {
		t.Fatal(err)
	}
	RemoveToolIf(name, &Tool{Name: name})
	RemoveToolIf(name, tool)

	if len(events) != 2 || events[0] != tool || events[1] != nil {
		t.Fatalf("unexpected registry events: %#v", events)
	}
}

func TestSetToolKeepsExistingToolWhenSchemaIsInvalid(t *testing.T) {
	const name = "registry_validation_test"
	original := &Tool{Name: name, InputSchema: ToolSchema{Type: "object"}}
	if err := SetTool(name, original); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		RemoveTool(name)
	})

	invalid := &Tool{Name: name, InputSchema: ToolSchema{Raw: map[string]any{}}}
	if err := SetTool(name, invalid); err == nil {
		t.Fatal("expected invalid schema")
	}
	if actual := LookupTool(name); actual != original {
		t.Fatalf("invalid replacement changed registry entry: %#v", actual)
	}
}

func TestSetToolKeepsExistingToolWhenParamHeaderIsInvalid(t *testing.T) {
	const name = "registry_header_validation_test"
	original := &Tool{Name: name, InputSchema: ToolSchema{Type: "object"}}
	if err := SetTool(name, original); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		RemoveTool(name)
	})

	invalid := &Tool{
		Name: name,
		InputSchema: ToolSchema{Raw: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"value": map[string]any{
					"type":         "string",
					"x-mcp-header": "",
				},
			},
		}},
	}
	if err := SetTool(name, invalid); err == nil {
		t.Fatal("expected invalid x-mcp-header annotation")
	}
	if actual := LookupTool(name); actual != original {
		t.Fatalf("invalid replacement changed registry entry: %#v", actual)
	}
}
