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
