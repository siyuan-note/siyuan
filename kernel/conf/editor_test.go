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

package conf

import "testing"

func TestNormalizeBacklinkExpandCount(t *testing.T) {
	tests := []struct {
		name     string
		count    int
		expected int
	}{
		{"preserves collapsed panel", -1, -1},
		{"clamps unsupported negative values", -2, -1},
		{"preserves folded contexts", 0, 0},
		{"preserves expanded contexts", 10, 10},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := NormalizeBacklinkExpandCount(test.count); actual != test.expected {
				t.Fatalf("expected %d, got %d", test.expected, actual)
			}
		})
	}
}

func TestNormalizeCursorSurroundingLines(t *testing.T) {
	tests := []struct {
		name     string
		lines    int
		expected int
	}{
		{"clamps negative values", -1, 0},
		{"preserves disabled state", 0, 0},
		{"preserves configured lines", 5, 5},
		{"clamps values above maximum", 21, MaxCursorSurroundingLines},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := NormalizeCursorSurroundingLines(test.lines); actual != test.expected {
				t.Fatalf("expected %d, got %d", test.expected, actual)
			}
		})
	}
}

func TestNormalizeAssetOpen(t *testing.T) {
	defaults := NormalizeAssetOpen(nil)
	if defaults.Click != AssetOpenActionFollowTab || defaults.CtrlClick != AssetOpenActionFolder ||
		defaults.AltClick != AssetOpenActionCurrent || defaults.ShiftClick != AssetOpenActionApp {
		t.Fatalf("unexpected defaults: %+v", defaults)
	}

	assetOpen := NormalizeAssetOpen(&AssetOpen{
		Click:      AssetOpenActionBottom,
		CtrlClick:  "invalid",
		AltClick:   AssetOpenActionBackground,
		ShiftClick: "",
	})
	if assetOpen.Click != AssetOpenActionBottom {
		t.Fatalf("expected bottom action, got %q", assetOpen.Click)
	}
	if assetOpen.CtrlClick != AssetOpenActionFolder {
		t.Fatalf("expected folder fallback, got %q", assetOpen.CtrlClick)
	}
	if assetOpen.AltClick != AssetOpenActionBackground {
		t.Fatalf("expected background action, got %q", assetOpen.AltClick)
	}
	if assetOpen.ShiftClick != AssetOpenActionApp {
		t.Fatalf("expected app fallback, got %q", assetOpen.ShiftClick)
	}
}

func TestNormalizeFontFamiliesMigratesLegacyConfig(t *testing.T) {
	editor := &Editor{
		FontFamily:        "Inter",
		FontWeight:        500,
		FontFamilyDisplay: "Inter Medium",
	}
	editor.NormalizeFontFamilies()

	if 1 != len(editor.FontFamilies) {
		t.Fatalf("expected one migrated font, got %d", len(editor.FontFamilies))
	}
	font := editor.FontFamilies[0]
	if "Inter" != font.Family || 500 != font.Weight || "Inter Medium" != font.DisplayName {
		t.Fatalf("unexpected migrated font: %+v", font)
	}
}

func TestNormalizeFontFamiliesPreservesExplicitEmptyList(t *testing.T) {
	editor := &Editor{
		FontFamily:        "Inter",
		FontWeight:        500,
		FontFamilyDisplay: "Inter Medium",
		FontFamilies:      []*EditorFont{},
	}
	editor.NormalizeFontFamilies()

	if 0 != len(editor.FontFamilies) {
		t.Fatalf("expected no selected fonts, got %d", len(editor.FontFamilies))
	}
	if "" != editor.FontFamily || 400 != editor.FontWeight || "" != editor.FontFamilyDisplay {
		t.Fatalf("legacy fields should be reset: %+v", editor)
	}
}

func TestNormalizeFontFamiliesPreservesOrderAndMirrorsFirstFont(t *testing.T) {
	editor := &Editor{
		FontFamilies: []*EditorFont{
			{Family: "Source Han Sans", Weight: 0, DisplayName: "Source Han Sans"},
			nil,
			{Family: "Inter", Weight: 500, DisplayName: "Inter Medium"},
			{Family: "Source Han Sans", Weight: 700, DisplayName: "Duplicate"},
		},
	}
	editor.NormalizeFontFamilies()

	if 2 != len(editor.FontFamilies) {
		t.Fatalf("expected two normalized fonts, got %d", len(editor.FontFamilies))
	}
	if "Source Han Sans" != editor.FontFamilies[0].Family || "Inter" != editor.FontFamilies[1].Family {
		t.Fatalf("unexpected font order: %+v", editor.FontFamilies)
	}
	if 400 != editor.FontFamilies[0].Weight {
		t.Fatalf("expected invalid weight to use 400, got %d", editor.FontFamilies[0].Weight)
	}
	if editor.FontFamily != editor.FontFamilies[0].Family || editor.FontWeight != editor.FontFamilies[0].Weight ||
		editor.FontFamilyDisplay != editor.FontFamilies[0].DisplayName {
		t.Fatalf("legacy fields do not mirror the first font: %+v", editor)
	}
}

func TestNormalizeFontFamiliesNormalizesCodeFontsIndependently(t *testing.T) {
	editor := &Editor{
		FontFamilies: []*EditorFont{
			{Family: "Inter", Weight: 500, DisplayName: "Inter Medium"},
		},
		CodeFontFamilies: []*EditorFont{
			{Family: "JetBrains Mono", Weight: 0, DisplayName: "JetBrains Mono"},
			nil,
			{Family: "Maple Mono", Weight: 600, DisplayName: "Maple Mono Semibold"},
			{Family: "JetBrains Mono", Weight: 700, DisplayName: "Duplicate"},
		},
	}
	editor.NormalizeFontFamilies()

	if 2 != len(editor.CodeFontFamilies) {
		t.Fatalf("expected two normalized code fonts, got %d", len(editor.CodeFontFamilies))
	}
	if "JetBrains Mono" != editor.CodeFontFamilies[0].Family || "Maple Mono" != editor.CodeFontFamilies[1].Family {
		t.Fatalf("unexpected code font order: %+v", editor.CodeFontFamilies)
	}
	if 400 != editor.CodeFontFamilies[0].Weight {
		t.Fatalf("expected invalid code font weight to use 400, got %d", editor.CodeFontFamilies[0].Weight)
	}
	if "Inter" != editor.FontFamily || 500 != editor.FontWeight || "Inter Medium" != editor.FontFamilyDisplay {
		t.Fatalf("code fonts should not change legacy editor font fields: %+v", editor)
	}
}
