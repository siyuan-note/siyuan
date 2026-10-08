// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestMaxContentKeepsMatchContextWithoutDuplication(t *testing.T) {
	for _, prefix := range []string{strings.Repeat("abcdefghij", 600), strings.Repeat("中文片段", 600)} {
		content := prefix + "<mark>HIT</mark>TAIL"
		got := maxContent(content, 5120)
		if !strings.HasSuffix(content, got) {
			t.Fatalf("snippet is not an original suffix: %q", got)
		}
		if !strings.Contains(got, "<mark>HIT</mark>TAIL") || !utf8.ValidString(got) {
			t.Fatalf("snippet lost the match or split a UTF-8 character: %q", got)
		}
		contextLen := strings.Index(got, "<mark>")
		if contextLen <= 64 || contextLen > 64+utf8.UTFMax {
			t.Fatalf("unexpected context length: %d", contextLen)
		}
	}
}

func TestMaxContentTruncation(t *testing.T) {
	for _, tc := range []struct {
		content string
		limit   int
		want    string
	}{
		{"short <mark>HIT</mark>", 128, "short <mark>HIT</mark>"},
		{"中文内容", 3, "中文内..."},
		{"<mark>HIT</mark>TAIL", 16, "<mark>HIT</mark>..."},
		{strings.Repeat("x", 6000), 5120, strings.Repeat("x", 5120) + "..."},
	} {
		if got := maxContent(tc.content, tc.limit); got != tc.want {
			t.Fatalf("maxContent(%q, %d) = %q, want %q", tc.content, tc.limit, got, tc.want)
		}
	}
}
