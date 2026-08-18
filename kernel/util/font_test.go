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

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/ConradIrwin/font/sfnt"
)

func TestLocalizedFontNamesAndAliases(t *testing.T) {
	oldLang := Lang
	Lang = "zh-CN"
	t.Cleanup(func() {
		Lang = oldLang
	})

	entries := []*sfnt.NameEntry{
		newMicrosoftFontNameEntry(sfnt.NamePreferredFamily, 1033, "LXGW WenKai"),
		newMicrosoftFontNameEntry(sfnt.NameFontFamily, 2052, "霞鹜文楷"),
		newMicrosoftFontNameEntry(sfnt.NamePreferredSubfamily, 1033, "Regular"),
		newMicrosoftFontNameEntry(sfnt.NamePreferredSubfamily, 2052, "常规体"),
		newMicrosoftFontNameEntry(sfnt.NameFull, 1033, "LXGW WenKai Regular"),
		newMicrosoftFontNameEntry(sfnt.NameFull, 2052, "霞鹜文楷 常规体"),
	}

	if actual := selectFontName(entries, sfnt.NamePreferredFamily); actual != "LXGW WenKai" {
		t.Fatalf("unexpected stable font family: %s", actual)
	}
	if actual := selectLocalizedFontName(entries, sfnt.NamePreferredFamily, sfnt.NameFontFamily); actual != "霞鹜文楷" {
		t.Fatalf("unexpected localized font family: %s", actual)
	}
	aliases := collectFontAliases(entries, sfnt.NamePreferredFamily, sfnt.NameFontFamily, sfnt.NameFull)
	for _, expected := range []string{"LXGW WenKai", "霞鹜文楷", "LXGW WenKai Regular", "霞鹜文楷 常规体"} {
		if !slices.Contains(aliases, expected) {
			t.Fatalf("font alias %q is missing from %v", expected, aliases)
		}
	}
}

func TestAddFontMergesAliases(t *testing.T) {
	fonts := addFont(nil, &Font{
		Family:      "LXGW WenKai",
		Weight:      400,
		DisplayName: "霞鹜文楷",
		Aliases:     []string{"LXGW WenKai Regular"},
	})
	fonts = addFont(fonts, &Font{
		Family:      "LXGW WenKai",
		Weight:      400,
		DisplayName: "LXGW WenKai",
		Aliases:     []string{"霞鹜文楷 常规体"},
	})

	if len(fonts) != 1 {
		t.Fatalf("duplicate font was not merged: %+v", fonts)
	}
	for _, expected := range []string{"LXGW WenKai Regular", "霞鹜文楷 常规体"} {
		if !slices.Contains(fonts[0].Aliases, expected) {
			t.Fatalf("merged font alias %q is missing from %v", expected, fonts[0].Aliases)
		}
	}
}

func TestParseBundledFontLocalizedName(t *testing.T) {
	oldLang := Lang
	Lang = "zh-CN"
	t.Cleanup(func() {
		Lang = oldLang
	})

	fontPath := filepath.Join("..", "..", "app", "appearance", "fonts", "LxgwWenKai-Lite-1.501",
		"LXGWWenKaiLite-Regular.ttf")
	fontFile, err := os.Open(fontPath)
	if err != nil {
		t.Fatal(err)
	}
	defer fontFile.Close()
	parsed, err := sfnt.Parse(fontFile)
	if err != nil {
		t.Fatal(err)
	}
	font, err := parseFontInfo(parsed)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(font.DisplayName, "霞鹜") {
		t.Fatalf("unexpected localized font display name: %+v", font)
	}
	if !slices.Contains(font.Aliases, font.Family) {
		t.Fatalf("stable font family is missing from aliases: %+v", font)
	}
}

func TestInferFontWeight(t *testing.T) {
	tests := map[string]int{
		"UltraLight": 200,
		"Light":      300,
		"Medium":     500,
		"SemiBold":   600,
		"Bold":       700,
		"ExtraBold":  800,
		"Heavy":      900,
		"Black":      900,
		"W03":        300,
	}
	for style, expected := range tests {
		if actual := inferFontWeight(400, style); actual != expected {
			t.Fatalf("unexpected weight for %s: %d", style, actual)
		}
	}
}

func newMicrosoftFontNameEntry(nameID sfnt.NameID, languageID uint16, value string) *sfnt.NameEntry {
	encodedRunes := utf16.Encode([]rune(value))
	encoded := make([]byte, len(encodedRunes)*2)
	for i, r := range encodedRunes {
		binary.BigEndian.PutUint16(encoded[i*2:], r)
	}
	return &sfnt.NameEntry{
		PlatformID: sfnt.PlatformMicrosoft,
		EncodingID: sfnt.PlatformEncodingMicrosoftUnicode,
		LanguageID: sfnt.PlatformLanguageID(languageID),
		NameID:     nameID,
		Value:      encoded,
	}
}
