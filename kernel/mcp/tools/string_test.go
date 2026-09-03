// SiYuan - From thought to insight, with agents
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
