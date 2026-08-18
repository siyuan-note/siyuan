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

//go:build windows && !ios

package util

import "testing"

func TestLoadDirectWriteFonts(t *testing.T) {
	oldLang := Lang
	Lang = "zh-CN"
	defer func() {
		Lang = oldLang
	}()

	fonts := loadPlatformFonts()
	if len(fonts) == 0 {
		t.Fatal("DirectWrite should return at least one system font")
	}
	hasAliases := false
	for _, font := range fonts {
		if font.Family == "" || font.DisplayName == "" {
			t.Fatalf("DirectWrite returned an invalid font: %+v", font)
		}
		if font.Weight < 1 || 1000 < font.Weight {
			t.Fatalf("DirectWrite returned an invalid font weight: %+v", font)
		}
		if 0 < len(font.Aliases) {
			hasAliases = true
		}
	}
	if !hasAliases {
		t.Fatal("DirectWrite should return localized font aliases")
	}
}
