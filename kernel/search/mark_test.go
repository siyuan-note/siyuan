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

package search

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEncloseHighlightingRaw(t *testing.T) {
	old := util.SearchHanSensitive
	util.SearchHanSensitive = true
	t.Cleanup(func() {
		util.SearchHanSensitive = old
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
	old := util.SearchHanSensitive
	util.SearchHanSensitive = false
	t.Cleanup(func() {
		util.SearchHanSensitive = old
	})

	got, matched := EncloseHighlightingRaw("詩經研究", []string{"诗经"}, "<mark>", "</mark>", false, false)
	if want := "<mark>詩經</mark>研究"; want != got {
		t.Fatalf("result = %q, want %q", got, want)
	}
	if !matched {
		t.Fatal("繁简不敏感匹配未返回命中状态")
	}
}
