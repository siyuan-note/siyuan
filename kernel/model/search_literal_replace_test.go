// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"regexp"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestReplaceCaseInsensitiveLiteralReplacement(t *testing.T) {
	for _, replacement := range []string{"bar$1baz", "a$bb", "x${y}z", "100$", "费用$100", `path\file$1`, "$$", "plain", ""} {
		got := string(replaceCaseInsensitive([]byte("foo and FOO"), []byte("foo"), []byte(replacement)))
		want := replacement + " and " + replacement
		if got != want {
			t.Errorf("replacement %q: got %q, want %q", replacement, got, want)
		}
	}
	if got := string(replaceCaseInsensitive([]byte("a.b and A.B and axb"), []byte("a.b"), []byte("$1"))); got != "$1 and $1 and axb" {
		t.Fatalf("literal keyword or replacement mismatch: %q", got)
	}
}

func TestReplaceTextNodeLiteralAndRegexReplacement(t *testing.T) {
	engine := util.NewLute()
	for _, tc := range []struct {
		name          string
		caseSensitive bool
		method        int
		keyword       string
		replacement   string
		want          string
	}{
		{"insensitive-literal", false, 0, "foo", "费用$100", "费用$100"},
		{"sensitive-literal", true, 0, "FOO", "费用$100", "费用$100"},
		{"regex-capture", false, 3, "(?i)(foo)", "${1}bar", "FOObar"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setSearchCaseSensitive(t, tc.caseSensitive)
			root := &ast.Node{Type: ast.NodeParagraph, ID: ast.NewNodeID()}
			text := replaceTextTestText("FOO")
			root.AppendChild(text)
			if !replaceTextNode(text, tc.method, tc.keyword, tc.replacement, regexp.MustCompile(tc.keyword), engine) {
				t.Fatal("replacement was not applied")
			}
			text.Unlink()
			if got := root.Content(); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
