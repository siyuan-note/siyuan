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
