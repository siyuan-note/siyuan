// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin && !ios

package util

import "testing"

func TestLoadPlatformFonts(t *testing.T) {
	fonts := loadPlatformFonts()
	if len(fonts) == 0 {
		t.Fatal("CoreText returned no available fonts")
	}
	hasKnownSpacing := false
	for _, font := range fonts {
		if "" == font.Family || "" == font.DisplayName || font.Weight < 1 || 1000 < font.Weight {
			t.Fatalf("invalid CoreText font: %+v", font)
		}
		if FontSpacingProportional == font.Spacing || FontSpacingMonospace == font.Spacing {
			hasKnownSpacing = true
		} else if "" != font.Spacing {
			t.Fatalf("invalid CoreText font spacing: %+v", font)
		}
	}
	if !hasKnownSpacing {
		t.Fatal("CoreText should return font spacing metadata")
	}
}
