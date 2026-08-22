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
		if manifest.Name == QuestionTool.Name || manifest.Name == TodoWriteTool.Name {
			found[manifest.Name] = manifest.AgentOnly
		}
	}
	for _, name := range []string{QuestionTool.Name, TodoWriteTool.Name} {
		if !found[name] {
			t.Fatalf("Agent-only capability metadata is missing: %s", name)
		}
	}
}
