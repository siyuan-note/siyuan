// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"slices"
	"testing"
)

func TestParseFontconfigFonts(t *testing.T) {
	data := fontconfigValueSeparator + "LXGW WenKai" + fontconfigPairSeparator + "en" +
		fontconfigValueSeparator + "霞鹜文楷" + fontconfigPairSeparator + "zh-cn" + fontconfigFieldSeparator +
		fontconfigValueSeparator + "Regular" + fontconfigPairSeparator + "en" +
		fontconfigValueSeparator + "常规" + fontconfigPairSeparator + "zh-cn" + fontconfigFieldSeparator +
		fontconfigValueSeparator + "LXGW WenKai Regular" + fontconfigPairSeparator + "en" +
		fontconfigValueSeparator + "霞鹜文楷 常规" + fontconfigPairSeparator + "zh-cn" +
		fontconfigFieldSeparator + fontconfigValueSeparator + "LXGWWenKai-Regular" +
		fontconfigFieldSeparator + "80" + fontconfigFieldSeparator + "90" + fontconfigRecordSeparator

	fonts := parseFontconfigFonts([]byte(data), "zh-CN")
	if 1 != len(fonts) {
		t.Fatalf("expected one font, got %d", len(fonts))
	}
	font := fonts[0]
	if "LXGW WenKai" != font.Family || "霞鹜文楷" != font.DisplayName || 400 != font.Weight ||
		FontSpacingDual != font.Spacing {
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

func TestParseFontconfigSpacing(t *testing.T) {
	tests := map[string]string{
		"0":   FontSpacingProportional,
		"90":  FontSpacingDual,
		"100": FontSpacingMonospace,
		"110": FontSpacingCharacterCell,
		"":    "",
	}
	for input, expected := range tests {
		if actual := parseFontconfigSpacing(input); expected != actual {
			t.Fatalf("expected spacing %q for %q, got %q", expected, input, actual)
		}
	}
}

func containsFontconfigAlias(aliases []string, expected string) bool {
	return slices.Contains(aliases, expected)
}
