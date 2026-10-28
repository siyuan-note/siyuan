// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package client

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestConvertMCPSchemaPreservesJSONSchema202012(t *testing.T) {
	input := map[string]any{
		"$schema":               "https://json-schema.org/draft/2020-12/schema",
		"type":                  "object",
		"unevaluatedProperties": false,
		"properties": map[string]any{
			"value": map[string]any{
				"type":  []any{"string", "null"},
				"const": "fixed",
			},
		},
	}

	schema := convertMCPSchema(input)
	data, err := json.Marshal(schema)
	if err != nil {
		t.Fatal(err)
	}
	var output map[string]any
	if err = json.Unmarshal(data, &output); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(output, input) {
		t.Fatalf("schema changed during conversion:\ninput:  %#v\noutput: %#v", input, output)
	}
}
