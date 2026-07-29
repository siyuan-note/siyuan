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

package tools

import "testing"

func TestToolValidatorValidatesInputAndOutput(t *testing.T) {
	validator, err := CompileToolValidator(&Tool{
		Name: "validated",
		InputSchema: ToolSchema{Raw: map[string]any{
			"type":     "object",
			"required": []any{"value"},
			"properties": map[string]any{
				"value": map[string]any{"type": "string"},
			},
		}},
		OutputSchema: &ToolSchema{Raw: map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "string",
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = validator.ValidateInput(map[string]any{}); err == nil {
		t.Fatal("expected missing required input to fail")
	}
	if err = validator.ValidateInput(map[string]any{"value": "ok"}); err != nil {
		t.Fatal(err)
	}
	if err = validator.ValidateOutput(CallToolResult{}); err == nil {
		t.Fatal("expected missing structured content to fail")
	}
	if err = validator.ValidateOutput(CallToolResult{
		StructuredContent:    []any{"ok"},
		StructuredContentSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err = validator.ValidateOutput(CallToolResult{
		StructuredContent:    map[string]any{"value": "wrong"},
		StructuredContentSet: true,
	}); err == nil {
		t.Fatal("expected invalid structured content to fail")
	}
}

func TestToolValidatorAcceptsExplicitNullOutput(t *testing.T) {
	validator, err := CompileToolValidator(&Tool{
		Name:         "null",
		InputSchema:  ToolSchema{Type: "object"},
		OutputSchema: &ToolSchema{Type: "null"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = validator.ValidateOutput(CallToolResult{StructuredContentSet: true}); err != nil {
		t.Fatal(err)
	}
}
