// SiYuan - Refactor your thinking
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

package agent

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
)

func TestConvertSchemaZodOptionalFields(t *testing.T) {
	schema := tools.ToolSchema{
		Type: "object",
		Properties: map[string]tools.Property{
			"title": {Type: "string", Description: "task title"},
			"content": {
				AnyOf: []tools.Property{
					{Type: "string"},
					{Type: "null"},
				},
				Description: "optional content",
			},
		},
		Required: []string{"title"},
	}

	out := convertSchema(schema).(map[string]any)
	if out["type"] != "object" {
		t.Fatalf("expected root type object, got %#v", out["type"])
	}

	props := out["properties"].(map[string]any)
	content := props["content"].(map[string]any)
	if content["type"] != "string" {
		t.Fatalf("expected simplified content type string, got %#v", content)
	}
	if _, ok := content["type"]; ok {
		if content["type"] == "" {
			t.Fatal("content type must not be empty string")
		}
	}
	if _, ok := content["anyOf"]; ok {
		t.Fatalf("expected anyOf to be simplified away, got %#v", content)
	}

	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "" {
		t.Fatal("expected non-empty json")
	}
}

func TestConvertSchemaRootAnyOf(t *testing.T) {
	schema := tools.ToolSchema{
		AnyOf: []tools.ToolSchema{
			{
				Type: "object",
				Properties: map[string]tools.Property{
					"title": {Type: "string"},
				},
				Required: []string{"title"},
			},
		},
	}

	out := convertSchema(schema).(map[string]any)
	if out["type"] != "object" {
		t.Fatalf("expected root type object, got %#v", out["type"])
	}
	props := out["properties"].(map[string]any)
	if len(props) != 1 {
		t.Fatalf("expected 1 property, got %d", len(props))
	}
}

func TestNeedsConfirmScopesReadOnlyActionsByToolSource(t *testing.T) {
	const externalWrite = "test_external_write"
	const externalRead = "test_external_read"
	const nativeWrite = "test_native_write"
	tools.SetTool(externalWrite, &tools.Tool{Name: externalWrite, Source: "mcp"})
	tools.SetTool(externalRead, &tools.Tool{Name: externalRead, Source: "mcp", ReadOnlyHint: true})
	tools.SetTool(nativeWrite, &tools.Tool{Name: nativeWrite, Source: "native"})
	t.Cleanup(func() {
		tools.RemoveTool(externalWrite)
		tools.RemoveTool(externalRead)
		tools.RemoveTool(nativeWrite)
	})

	if !needsConfirm(externalWrite, "", nil) {
		t.Fatal("external tool with unknown mutability must require confirmation")
	}
	if !needsConfirm(externalWrite, "close", nil) {
		t.Fatal("native safe action name must not bypass external tool confirmation")
	}
	if needsConfirm(externalRead, "query", nil) {
		t.Fatal("external tool explicitly declared read-only should not require confirmation")
	}
	if needsLocalSnapshot(externalWrite, "write") {
		t.Fatal("external write cannot be rolled back by a local repository snapshot")
	}
	if !needsLocalSnapshot(nativeWrite, "write") {
		t.Fatal("native write should create a local repository snapshot")
	}
}

func TestConfirmSessionAcceptsResponseOnce(t *testing.T) {
	const confirmID = "test-confirm"
	ch := make(chan confirmResult, 1)
	confirmChannelsMu.Lock()
	confirmChannels[confirmID] = ch
	confirmChannelsMu.Unlock()
	t.Cleanup(func() {
		confirmChannelsMu.Lock()
		delete(confirmChannels, confirmID)
		confirmChannelsMu.Unlock()
	})

	if !ConfirmSession(confirmID, true, false) {
		t.Fatal("registered confirmation was rejected")
	}
	if ConfirmSession(confirmID, false, false) {
		t.Fatal("duplicate confirmation was accepted")
	}
	result := <-ch
	if !result.approved || result.always {
		t.Fatalf("unexpected confirmation result: %#v", result)
	}
}
