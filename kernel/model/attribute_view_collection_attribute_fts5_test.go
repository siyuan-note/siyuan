// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestBlockCollectionAttributeNames(t *testing.T) {
	node := &ast.Node{Type: ast.NodeDocument, KramdownIAL: [][]string{
		{"id", "document"}, {"custom-dailynote-20261020", "old"}, {"custom-dailynote-20261021", "A&amp;B"},
		{"custom-abc-example-def", "other"}, {"custom-empty", ""},
	}}
	for _, test := range []struct {
		name, mode, operator, value string
		want                        bool
	}{
		{"custom-dailynote-20261021", "", "equals", "A&B", true},
		{"custom-dailynote-20261021", "equals", "equals", "A&B", true},
		{"dailynote", "contains", "exists", "", true},
		{"example", "contains", "exists", "", true},
		{"-example", "contains", "exists", "", true},
		{"dailynote", "contains", "equals", "A&B", true},
		{"dailynote", "contains", "contains", "&", true},
		{"dailynote", "contains", "equals", "other", false},
		{"dailynote", "contains", "notExists", "", false},
		{"missing", "contains", "notExists", "", true},
		{"^custom-dailynote-[0-9]{8}$", "regex", "equals", "A&B", true},
		{`^custom-\D+-20261021$`, "regex", "exists", "", true},
		{"^dailynote", "regex", "exists", "", false},
		{"^id$", "regex", "exists", "", false},
		{"^id$", "regex", "notExists", "", true},
		{"custom-empty", "", "equals", "", true},
		{"custom-missing", "", "equals", "", false},
		{"[", "regex", "notExists", "", false},
		{"(?=custom)", "regex", "notExists", "", false},
		{"custom-state", "unknown", "notExists", "", false},
		{"", "contains", "notExists", "", false},
	} {
		t.Run(test.mode+"/"+test.name+"/"+test.operator+"/"+test.value, func(t *testing.T) {
			attr := &av.AutomationBlockAttribute{Name: test.name, NameOperator: test.mode, Operator: test.operator, Value: test.value}
			if got := collectionAttributeMatcher(attr)(node); got != test.want {
				t.Fatalf("matched %v, want %v", got, test.want)
			}
		})
	}
	if collectionAttributeMatcher(nil)(node) {
		t.Fatal("nil condition matched")
	}
	for _, attr := range []*av.AutomationBlockAttribute{
		{Name: strings.Repeat("a", 257), NameOperator: "regex", Operator: "exists"},
		{Name: "custom-", Operator: "exists"}, {Name: "state", Operator: "exists"},
		{Name: "state space", NameOperator: "contains", Operator: "exists"},
	} {
		if _, err := validateCollectionAttribute(attr); err == nil {
			t.Fatalf("invalid condition accepted: %+v", attr)
		}
	}
}
