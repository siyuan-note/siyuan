// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestToolSchemaPreservesUnknownKeywords(t *testing.T) {
	input := map[string]any{
		"type":                  "object",
		"unevaluatedProperties": false,
		"properties": map[string]any{
			"value": map[string]any{"type": []any{"string", "null"}},
		},
	}
	data, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}

	var schema ToolSchema
	if err = json.Unmarshal(data, &schema); err != nil {
		t.Fatal(err)
	}
	data, err = json.Marshal(schema)
	if err != nil {
		t.Fatal(err)
	}
	var output map[string]any
	if err = json.Unmarshal(data, &output); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(output, input) {
		t.Fatalf("schema changed during round trip:\ninput:  %#v\noutput: %#v", input, output)
	}
}

func TestCallToolResultPreservesExplicitNullStructuredContent(t *testing.T) {
	result := CallToolResult{
		Content:              []ContentItem{{Type: "text", Text: "null"}},
		StructuredContentSet: true,
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	if structured, ok := fields["structuredContent"]; !ok || string(structured) != "null" {
		t.Fatalf("explicit null was not preserved: %s", data)
	}

	var decoded CallToolResult
	if err = json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if !decoded.HasStructuredContent() || decoded.StructuredContent != nil {
		t.Fatalf("unexpected decoded result: %#v", decoded)
	}
}
