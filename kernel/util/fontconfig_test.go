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

package util

import "testing"

func TestParseFontconfigFonts(t *testing.T) {
	data := fontconfigValueSeparator + "LXGW WenKai" + fontconfigPairSeparator + "en" +
		fontconfigValueSeparator + "霞鹜文楷" + fontconfigPairSeparator + "zh-cn" + fontconfigFieldSeparator +
		fontconfigValueSeparator + "Regular" + fontconfigPairSeparator + "en" +
		fontconfigValueSeparator + "常规" + fontconfigPairSeparator + "zh-cn" + fontconfigFieldSeparator +
		fontconfigValueSeparator + "LXGW WenKai Regular" + fontconfigPairSeparator + "en" +
		fontconfigValueSeparator + "霞鹜文楷 常规" + fontconfigPairSeparator + "zh-cn" +
		fontconfigFieldSeparator + fontconfigValueSeparator + "LXGWWenKai-Regular" +
		fontconfigFieldSeparator + "80" + fontconfigRecordSeparator

	fonts := parseFontconfigFonts([]byte(data), "zh-CN")
	if 1 != len(fonts) {
		t.Fatalf("expected one font, got %d", len(fonts))
	}
	font := fonts[0]
	if "LXGW WenKai" != font.Family || "霞鹜文楷" != font.DisplayName || 400 != font.Weight {
		t.Fatalf("unexpected font: %+v", font)
	}
	for _, expected := range []string{"常规", "LXGW WenKai Regular", "LXGWWenKai-Regular"} {
		if !containsFontconfigAlias(font.Aliases, expected) {
			t.Fatalf("expected alias %q in %+v", expected, font.Aliases)
		}
	}
}

func TestSelectFontconfigNameKeepsChineseVariantsSeparate(t *testing.T) {
	names := []fontconfigLocalizedName{
		{Value: "Simplified", Lang: "zh-CN"},
		{Value: "Traditional", Lang: "zh-TW"},
	}
	if actual := selectFontconfigName(names, "zh-Hant"); "Traditional" != actual {
		t.Fatalf("expected Traditional, got %q", actual)
	}
	if actual := selectFontconfigName(names, "zh-Hans"); "Simplified" != actual {
		t.Fatalf("expected Simplified, got %q", actual)
	}
}

func TestParseFontconfigWeight(t *testing.T) {
	tests := map[string]int{
		"0":   100,
		"40":  200,
		"50":  300,
		"55":  350,
		"75":  380,
		"80":  400,
		"100": 500,
		"180": 600,
		"200": 700,
		"205": 800,
		"210": 900,
		"215": 1000,
	}
	for input, expected := range tests {
		if actual := parseFontconfigWeight(input, ""); expected != actual {
			t.Fatalf("expected weight %d for %s, got %d", expected, input, actual)
		}
	}
	if actual := parseFontconfigWeight("invalid", "Bold"); 700 != actual {
		t.Fatalf("expected inferred bold weight, got %d", actual)
	}
}

func containsFontconfigAlias(aliases []string, expected string) bool {
	for _, alias := range aliases {
		if alias == expected {
			return true
		}
	}
	return false
}
