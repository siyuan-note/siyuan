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

//go:build linux && !android

package util

import (
	"os/exec"
	"testing"
)

func TestLoadFontconfigFonts(t *testing.T) {
	if _, err := exec.LookPath("fc-list"); nil != err {
		t.Skip("fc-list is unavailable")
	}
	fonts := loadPlatformFonts()
	if 0 == len(fonts) {
		t.Fatal("Fontconfig should return at least one system font")
	}
	for _, font := range fonts {
		if "" == font.Family || "" == font.DisplayName {
			t.Fatalf("Fontconfig returned an invalid font: %+v", font)
		}
		if font.Weight < 1 || 1000 < font.Weight {
			t.Fatalf("Fontconfig returned an invalid font weight: %+v", font)
		}
	}
}
