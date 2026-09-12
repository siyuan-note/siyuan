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

package api

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestParseSearchSubTypes(t *testing.T) {
	for _, tc := range []struct {
		name string
		json string
		want map[string]bool
	}{
		{"empty", `{}`, map[string]bool{}},
		{"null", `null`, nil},
		{"legacy", `{"h1":true,"h2":true,"h3":true,"h4":true,"h5":true,"h6":true,"o":true,"u":true,"t":true}`, map[string]bool{}},
		{"independent", `{"heading":{"h2":true},"list":{"o":true,"t":false},"listItem":{"t":true}}`, map[string]bool{"h2": true, "list:o": true, "listItem:t": true}},
		{"unknown", `{"o":true,"unknown":{"o":true},"heading":{"o":true},"list":{"h1":true,"u":true},"listItem":{"t":"true"}}`, map[string]bool{"list:u": true}},
		{"invalidGroups", `{"heading":true,"list":null,"listItem":[]}`, map[string]bool{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var value any
			if err := json.Unmarshal([]byte(tc.json), &value); err != nil {
				t.Fatal(err)
			}
			if got := parseSearchSubTypes(value); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}
