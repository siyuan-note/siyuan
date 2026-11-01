// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTruncateUTF8(t *testing.T) {
	for _, text := range []string{"", "ASCII", "中文预览", "a中😀é尾", strings.Repeat("中", 400)} {
		for limit := -1; limit <= len(text)+1; limit++ {
			byBytes := TruncateUTF8Bytes(text, limit)
			byRunes := TruncateRunes(text, limit)
			maxLength := max(0, limit)
			if !utf8.ValidString(byBytes) || len(byBytes) > maxLength || !strings.HasPrefix(text, byBytes) {
				t.Fatalf("invalid byte prefix at %d: %q", limit, byBytes)
			}
			if !utf8.ValidString(byRunes) || utf8.RuneCountInString(byRunes) > maxLength || !strings.HasPrefix(text, byRunes) {
				t.Fatalf("invalid rune prefix at %d: %q", limit, byRunes)
			}
			wantRunes := min(maxLength, utf8.RuneCountInString(text))
			if utf8.RuneCountInString(byRunes) != wantRunes {
				t.Fatalf("wrong rune prefix at %d: %q", limit, byRunes)
			}
			if len(byBytes) < len(text) && maxLength > 0 {
				_, nextSize := utf8.DecodeRuneInString(text[len(byBytes):])
				if len(byBytes)+nextSize <= maxLength {
					t.Fatalf("byte prefix omitted a complete code point at %d", limit)
				}
			}
		}
	}
}

func TestTruncatePreservesMalformedInputHandling(t *testing.T) {
	text := "a\xff中尾"
	if got := TruncateRunes(text, 3); got != "a�中" {
		t.Fatalf("unexpected rune replacement: %q", got)
	}
	if got := TruncateUTF8Bytes(text, 5); got != "a" {
		t.Fatalf("byte truncation must return a valid prefix: %q", got)
	}
	if TruncateRunes(text, 10) != text || TruncateUTF8Bytes(text, 10) != text {
		t.Fatal("untruncated input must remain unchanged")
	}
}
