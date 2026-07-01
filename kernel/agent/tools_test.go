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
