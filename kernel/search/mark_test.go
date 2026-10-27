// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package search

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMarkTextMatchesRawText(t *testing.T) {
	old := util.SearchHanSensitive.Load()
	util.SearchHanSensitive.Store(true)
	t.Cleanup(func() {
		util.SearchHanSensitive.Store(old)
	})

	tests := []struct {
		name      string
		text      string
		keyword   string
		beforeLen int
		wantPos   int
		want      string
	}{
		{
			name:      "template name",
			text:      "1&2amp",
			keyword:   "amp",
			beforeLen: 32,
			wantPos:   len("1&amp;2"),
			want:      "1&amp;2<mark>amp</mark>",
		},
		{
			name:      "entity only",
			text:      "A&B",
			keyword:   "amp",
			beforeLen: 32,
			wantPos:   -1,
			want:      "A&amp;B",
		},
		{
			name:      "entity at context boundary",
			text:      "a&xamp",
			keyword:   "amp",
			beforeLen: 1,
			wantPos:   len("...&amp;x"),
			want:      "...&amp;x<mark>amp</mark>",
		},
		{
			name:      "multibyte context",
			text:      "前🙂xamp",
			keyword:   "amp",
			beforeLen: 1,
			wantPos:   len("...🙂x"),
			want:      "...🙂x<mark>amp</mark>",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pos, got := MarkText(test.text, test.keyword, test.beforeLen, true)
			if test.want != got {
				t.Fatalf("result = %q, want %q", got, test.want)
			}
			if test.wantPos != pos {
				t.Fatalf("pos = %d, want %d", pos, test.wantPos)
			}
		})
	}
}

func TestEncloseHighlightingRaw(t *testing.T) {
	old := util.SearchHanSensitive.Load()
	util.SearchHanSensitive.Store(true)
	t.Cleanup(func() {
		util.SearchHanSensitive.Store(old)
	})

	start := GetMarkSpanStart(VirtualBlockRefDataType)
	end := GetMarkSpanEnd()
	tests := []struct {
		name     string
		text     string
		keywords []string
		want     string
		matched  bool
	}{
		{
			name:     "entity text is not matched",
			text:     "amp A&B",
			keywords: []string{"amp"},
			want:     start + "amp" + end + " A&amp;B",
			matched:  true,
		},
		{
			name:     "entity-only match is ignored",
			text:     "A&B",
			keywords: []string{"amp"},
			want:     "A&amp;B",
			matched:  false,
		},
		{
			name:     "numeric entity text is not matched",
			text:     "de Casteljau's 39",
			keywords: []string{"39"},
			want:     "de Casteljau&#39;s " + start + "39" + end,
			matched:  true,
		},
		{
			name:     "double quote entity text is not matched",
			text:     "\"quoted\" 34",
			keywords: []string{"34"},
			want:     "&#34;quoted&#34; " + start + "34" + end,
			matched:  true,
		},
		{
			name:     "tag entity names are not matched",
			text:     "lt < gt >",
			keywords: []string{"lt", "gt"},
			want:     start + "lt" + end + " &lt; " + start + "gt" + end + " &gt;",
			matched:  true,
		},
		{
			name:     "carriage return is escaped between matches",
			text:     "amp\r13",
			keywords: []string{"amp", "13"},
			want:     start + "amp" + end + "&#13;" + start + "13" + end,
			matched:  true,
		},
		{
			name:     "keyword containing ampersand",
			text:     "R&D",
			keywords: []string{"R&D"},
			want:     start + "R&amp;D" + end,
			matched:  true,
		},
		{
			name:     "keyword containing HTML tag characters",
			text:     "<foo>",
			keywords: []string{"<foo>"},
			want:     start + "&lt;foo&gt;" + end,
			matched:  true,
		},
		{
			name:     "unmatched HTML is escaped",
			text:     "<script>alert(1)</script>",
			keywords: []string{"missing"},
			want:     "&lt;script&gt;alert(1)&lt;/script&gt;",
			matched:  false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, matched := EncloseHighlightingRaw(test.text, test.keywords, start, end, true, true)
			if test.want != got {
				t.Fatalf("result = %q, want %q", got, test.want)
			}
			if test.matched != matched {
				t.Fatalf("matched = %v, want %v", matched, test.matched)
			}
		})
	}
}

func TestEncloseHighlightingRawHanInsensitive(t *testing.T) {
	old := util.SearchHanSensitive.Load()
	util.SearchHanSensitive.Store(false)
	t.Cleanup(func() {
		util.SearchHanSensitive.Store(old)
	})

	got, matched := EncloseHighlightingRaw("詩經研究", []string{"诗经"}, "<mark>", "</mark>", false, false)
	if want := "<mark>詩經</mark>研究"; want != got {
		t.Fatalf("result = %q, want %q", got, want)
	}
	if !matched {
		t.Fatal("繁简不敏感匹配未返回命中状态")
	}
}
