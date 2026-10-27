// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	hasKnownSpacing := false
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
		if FontSpacingProportional == font.Spacing || FontSpacingMonospace == font.Spacing {
			hasKnownSpacing = true
		} else if "" != font.Spacing {
			t.Fatalf("DirectWrite returned an invalid font spacing: %+v", font)
		}
	}
	if !hasAliases {
		t.Fatal("DirectWrite should return localized font aliases")
	}
	if !hasKnownSpacing {
		t.Fatal("DirectWrite should return font spacing metadata")
	}
}
