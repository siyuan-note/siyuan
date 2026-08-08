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

import (
	"context"
	"errors"
	"testing"
	"time"
)

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

func TestCompileToolValidatorRejectsInvalidParamHeader(t *testing.T) {
	_, err := CompileToolValidator(&Tool{
		Name: "invalid_header",
		InputSchema: ToolSchema{Raw: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"items": map[string]any{
					"type":         "array",
					"x-mcp-header": "Items",
				},
			},
		}},
	})
	if err == nil {
		t.Fatal("expected invalid x-mcp-header annotation to fail")
	}
}

func TestCompileToolValidatorRejectsExcessiveSchemaDepth(t *testing.T) {
	var nested any = true
	for range maxToolSchemaDepth + 1 {
		nested = []any{nested}
	}
	_, err := CompileToolValidator(&Tool{
		Name: "deep_schema",
		InputSchema: ToolSchema{Raw: map[string]any{
			"type": "object",
			"x":    nested,
		}},
	})
	if err == nil {
		t.Fatal("expected excessive schema depth to fail")
	}
}

func TestToolValidatorRejectsExcessiveValueDepth(t *testing.T) {
	validator, err := CompileToolValidator(&Tool{
		Name:         "deep_value",
		InputSchema:  ToolSchema{Type: "object"},
		OutputSchema: &ToolSchema{},
	})
	if err != nil {
		t.Fatal(err)
	}
	var nested any = true
	for range maxToolValueDepth + 1 {
		nested = []any{nested}
	}
	if err = validator.ValidateOutput(CallToolResult{
		StructuredContent:    nested,
		StructuredContentSet: true,
	}); err == nil {
		t.Fatal("expected excessive value depth to fail")
	}
}

func TestToolValidatorTimeoutIsIsolatedPerTool(t *testing.T) {
	blocked, err := CompileToolValidator(&Tool{
		Name:        "blocked",
		InputSchema: ToolSchema{Type: "object"},
	})
	if err != nil {
		t.Fatal(err)
	}
	healthy, err := CompileToolValidator(&Tool{
		Name:        "healthy",
		InputSchema: ToolSchema{Type: "object"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for range cap(blocked.validationSlots) {
		blocked.validationSlots <- struct{}{}
	}
	t.Cleanup(func() {
		for range cap(blocked.validationSlots) {
			<-blocked.validationSlots
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err = blocked.ValidateInputContext(ctx, map[string]any{}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unexpected blocked validation result: %v", err)
	}
	if err = healthy.ValidateInput(map[string]any{}); err != nil {
		t.Fatalf("blocked validator affected another tool: %v", err)
	}
}
