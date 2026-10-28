// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
