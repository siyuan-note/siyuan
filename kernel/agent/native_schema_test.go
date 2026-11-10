// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
)

func TestNativeModelSchemaPreservesExecutionValidation(t *testing.T) {
	for _, tool := range []*tools.Tool{tools.DecisionTool, tools.DatabaseTool} {
		before, _ := json.Marshal(tool.InputSchema)
		projected := nativeModelSchema(convertSchema(tool.InputSchema))
		data, _ := json.Marshal(projected)
		if strings.Contains(string(data), `"$ref"`) || strings.Contains(string(data), `"$defs"`) {
			t.Fatalf("native schema still requires reference resolution: %s", data)
		}
		var walk func(any)
		walk = func(value any) {
			switch value := value.(type) {
			case map[string]any:
				if enumeration, ok := value["enum"].([]any); ok {
					for _, entry := range enumeration {
						if entry == "" {
							t.Fatal("empty enum reached the model")
						}
					}
				}
				if len(value) == 1 && value["required"] != nil {
					t.Fatal("presence-only union branch reached the model")
				}
				for _, child := range value {
					walk(child)
				}
			case []any:
				for _, child := range value {
					walk(child)
				}
			}
		}
		walk(projected)
		after, _ := json.Marshal(tool.InputSchema)
		if string(before) != string(after) {
			t.Fatal("model projection mutated the execution schema")
		}
		validator, err := tools.CompileToolValidator(tool)
		if err != nil {
			t.Fatal(err)
		}
		if tool == tools.DatabaseTool {
			for _, value := range []string{"", "percent"} {
				if err = validator.ValidateInput(map[string]any{"action": "key_update", "config": map[string]any{"numberFormat": value}}); err != nil {
					t.Fatal(err)
				}
			}
			if validator.ValidateInput(map[string]any{"action": "key_update", "config": map[string]any{"numberFormat": "invented"}}) == nil {
				t.Fatal("unsupported enum became executable")
			}
		} else if validator.ValidateInput(map[string]any{"action": "evaluate", "items": []any{map[string]any{"id": "one"}}, "questions": []any{map[string]any{"id": "q", "type": "noul", "instructions": "Relevant?"}}}) == nil {
			t.Fatal("decision item without evidence became executable")
		}
	}
}

func TestNativeModelSchemaPreservesRecursiveReferences(t *testing.T) {
	var source map[string]any
	if err := json.Unmarshal([]byte(`{"type":"object","$defs":{"node":{"type":"object","properties":{"next":{"$ref":"#/$defs/node"}}}},"properties":{"head":{"$ref":"#/$defs/node"}}}`), &source); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(source)
	after, _ := json.Marshal(nativeModelSchema(source))
	if string(before) != string(after) {
		t.Fatal("recursive projection lost its reference definitions")
	}
}
