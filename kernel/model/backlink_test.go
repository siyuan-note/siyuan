// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	query, args := buildBackmentionQuery(matchExpression, rootID, "", 64)

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
	beforeID := "cursor'id"
	query, args = buildBackmentionQuery(matchExpression, rootID, beforeID, 64)
	if strings.Contains(query, beforeID) || !strings.Contains(query, "AND id < ?") {
		t.Fatalf("cursor must be bound as an exclusive upper boundary: %s", query)
	}
	expectedArgs = []any{matchExpression, rootID, beforeID, 64}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("expected arguments %#v, got %#v", expectedArgs, args)
	}
}
