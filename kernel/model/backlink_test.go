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

package model

import (
	"reflect"
	"strings"
	"testing"
)

func TestQuoteFTSPhrase(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{name: "client keyword with apostrophe", input: "a'b", expected: `"a'b"`},
		{name: "stored title with SQL syntax", input: `doc'); UPDATE blocks SET content = 'changed`, expected: `"doc'); UPDATE blocks SET content = 'changed"`},
		{name: "FTS quote", input: `a"b`, expected: `"a""b"`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := quoteFTSPhrase(test.input); actual != test.expected {
				t.Fatalf("expected %q, got %q", test.expected, actual)
			}
		})
	}
}

func TestBuildBackmentionQueryBindsValues(t *testing.T) {
	matchExpression := `content:("stored'title") AND ("client'keyword")`
	rootID := "root'id"
	query, args := buildBackmentionQuery(matchExpression, rootID, 64)

	if strings.Contains(query, matchExpression) || strings.Contains(query, rootID) {
		t.Fatalf("query contains an unbound value: %s", query)
	}
	if strings.Count(query, "?") != 3 {
		t.Fatalf("expected three placeholders, got query %q", query)
	}
	expectedArgs := []any{matchExpression, rootID, 64}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("expected arguments %#v, got %#v", expectedArgs, args)
	}
}
