// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package tools

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestParseAttrValues(t *testing.T) {
	var attrs map[string]any
	if err := json.Unmarshal([]byte(`{"custom-null":null,"custom-empty":"","custom-text":"baseline","custom-literal":"<nil>"}`), &attrs); err != nil {
		t.Fatal(err)
	}
	got, err := parseAttrValues(attrs)
	want := map[string]string{"custom-null": "", "custom-empty": "", "custom-text": "baseline", "custom-literal": "<nil>"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("parseAttrValues() = %v, %v; want %v", got, err, want)
	}
}

func TestAttrSetRejectsNonStringValues(t *testing.T) {
	for _, value := range []string{`5`, `true`, `{"a":1,"b":"x"}`, `["a","b"]`} {
		t.Run(value, func(t *testing.T) {
			var args map[string]any
			if err := json.Unmarshal([]byte(`{"action":"set","id":"20260914120000-abcdefg","attrs":{"custom-valid":"baseline","custom-invalid":`+value+`}}`), &args); err != nil {
				t.Fatal(err)
			}
			attrs, err := parseAttrValues(args["attrs"].(map[string]any))
			if err == nil || attrs != nil {
				t.Fatalf("invalid batch must return no attributes: %v, %v", attrs, err)
			}
			result, err := attrHandler(args)
			if err != nil || !result.IsError || len(result.Content) != 1 || !strings.Contains(result.Content[0].Text, `attr "custom-invalid" must be a string or null`) {
				t.Fatalf("unexpected result: %+v, %v", result, err)
			}
		})
	}
}

func TestAttrHandlerRequiredArguments(t *testing.T) {
	for _, args := range []map[string]any{
		{"action": "get"},
		{"action": "batch-get"},
		{"action": "set"},
		{"action": "set", "id": "20260914120000-abcdefg"},
		{"action": "set", "id": "20260914120000-abcdefg", "attrs": map[string]any{}},
		{"action": "set", "id": "20260914120000-abcdefg", "attrs": "invalid"},
		{"action": "unknown"},
	} {
		result, err := attrHandler(args)
		if err != nil || !result.IsError {
			t.Fatalf("expected argument error for %v: %+v, %v", args, result, err)
		}
	}
}
