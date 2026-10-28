// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTruncateText(t *testing.T) {
	tests := []struct {
		name   string
		text   string
		maxLen int
		want   string
	}{
		{name: "empty", text: "", maxLen: 200, want: ""},
		{name: "ASCII exact", text: strings.Repeat("a", 200), maxLen: 200, want: strings.Repeat("a", 200)},
		{name: "ASCII truncated", text: strings.Repeat("a", 201), maxLen: 200, want: strings.Repeat("a", 200) + "..."},
		{name: "Chinese below limit", text: strings.Repeat("中", 80), maxLen: 200, want: strings.Repeat("中", 80)},
		{name: "Chinese truncated", text: strings.Repeat("中", 201), maxLen: 200, want: strings.Repeat("中", 200) + "..."},
		{name: "emoji truncated", text: strings.Repeat("😀", 201), maxLen: 200, want: strings.Repeat("😀", 200) + "..."},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := truncateText(test.text, test.maxLen)
			if got != test.want {
				t.Fatalf("truncateText() = %q, want %q", got, test.want)
			}
			if !utf8.ValidString(got) {
				t.Fatalf("truncateText() returned invalid UTF-8: %q", got)
			}
		})
	}
}
