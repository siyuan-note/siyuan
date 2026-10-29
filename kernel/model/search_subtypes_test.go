// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"testing"
)

func TestBuildTypeFilterSubTypes(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	t.Cleanup(func() { Conf = previous })
	for _, tc := range []struct {
		name     string
		types    map[string]bool
		subTypes map[string]bool
		alias    string
		want     string
	}{
		{"document", map[string]bool{"document": true}, nil, "", "(type = 'd')"},
		{"documentAlias", map[string]bool{"document": true}, map[string]bool{"h2": true}, "b.", "(b.type = 'd')"},
		{"documentAndParagraph", map[string]bool{"document": true, "paragraph": true}, nil, "", "(type IN ('d','p'))"},
		{"documentAndHeading", map[string]bool{"document": true, "heading": true}, map[string]bool{"h2": true}, "", "(type IN ('d') OR (type = 'h' AND subtype IN ('h2')))"},
		{"heading", map[string]bool{"heading": true}, map[string]bool{"h2": true}, "", "((type = 'h' AND subtype IN ('h2')))"},
		{"list", map[string]bool{"list": true, "listItem": true}, map[string]bool{"list:o": true}, "", "(type IN ('i') OR (type = 'l' AND subtype IN ('o')))"},
		{"listItem", map[string]bool{"list": true, "listItem": true}, map[string]bool{"listItem:t": true}, "", "(type IN ('l') OR (type = 'i' AND subtype IN ('t')))"},
		{"onlyListItem", map[string]bool{"listItem": true}, map[string]bool{"list:o": true, "listItem:o": true}, "", "((type = 'i' AND subtype IN ('o')))"},
		{"empty", map[string]bool{"heading": true, "list": true, "listItem": true}, nil, "", "(type IN ('h','l','i'))"},
		{"false", map[string]bool{"list": true}, map[string]bool{"list:o": false}, "", "(type IN ('l'))"},
		{"legacyList", map[string]bool{"list": true, "listItem": true}, map[string]bool{"o": true}, "", "(type IN ('l','i'))"},
		{"mixed", map[string]bool{"paragraph": true, "heading": true, "list": true, "listItem": true}, map[string]bool{"h1": true, "h3": true, "list:u": true, "listItem:t": true}, "b.", "(b.type IN ('p') OR (b.type = 'h' AND b.subtype IN ('h1','h3')) OR (b.type = 'l' AND b.subtype IN ('u')) OR (b.type = 'i' AND b.subtype IN ('t')))"},
		{"disabled", map[string]bool{}, map[string]bool{"h1": true, "list:o": true, "listItem:t": true}, "", "(1 = 0)"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := buildTypeFilter(tc.types, tc.subTypes, tc.alias); got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestSearchSubTypesJSON(t *testing.T) {
	var criterion Criterion
	if err := json.Unmarshal([]byte(`{"subTypes":{"h1":true,"o":true,"heading":{"h2":true},"list":{"o":true},"listItem":{"t":true}}}`), &criterion); err != nil {
		t.Fatal(err)
	}
	if criterion.SubTypes.Heading["h1"] || !criterion.SubTypes.Heading["h2"] || !criterion.SubTypes.List["o"] || !criterion.SubTypes.ListItem["t"] {
		t.Fatalf("unexpected subtypes: %+v", criterion.SubTypes)
	}
}
