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

package av

import "testing"

func TestFilterColorValuePreservesPaletteIndex(t *testing.T) {
	for _, color := range []string{"", "1", "14"} {
		if filtered := FilterColorValue(color); filtered != color {
			t.Fatalf("palette color was changed [expected=%q, actual=%q]", color, filtered)
		}
	}
	if filtered := FilterColorValue(" 3 "); filtered != "3" {
		t.Fatalf("palette color with whitespace was not trimmed [%q]", filtered)
	}
}

func TestFilterColorValueRejectsUnsafeValues(t *testing.T) {
	for _, color := range []string{
		`1);color:red" onmouseover="alert(1)" x="`,
		"0",
		"15",
		"1.5",
		"abc",
		`"`,
		"<script>",
	} {
		if filtered := FilterColorValue(color); "" != filtered {
			t.Fatalf("unsafe color value was preserved [input=%q, actual=%q]", color, filtered)
		}
	}
}
