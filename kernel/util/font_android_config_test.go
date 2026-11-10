// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"slices"
	"testing"
)

func TestAndroidFontConfigNamedFamilies(t *testing.T) {
	data := []byte(`<familyset>
<family name="sans-serif"><font weight="400">Roboto-Regular.ttf</font><font weight="700">Roboto-Bold.ttf</font></family>
<family><font>NotoSansCJK.ttc</font></family>
<family name="monospace"><font>Mono.ttf</font></family>
<alias name="sans-serif-light" to="sans-serif" weight="300"/>
</familyset>`)
	fonts := parseAndroidFontConfig(data, func(name string) []*Font {
		if name == "NotoSansCJK.ttc" {
			t.Fatal("unnamed fallback must not be resolved")
		}
		spacing := FontSpacingProportional
		if name == "Mono.ttf" {
			spacing = FontSpacingMonospace
		}
		return []*Font{{Family: "Internal Name", DisplayName: "Localized Name", Weight: 400, Spacing: spacing}}
	})
	if len(fonts) != 3 || fonts[0].Family != "sans-serif" || fonts[1].Weight != 700 || fonts[2].Family != "monospace" {
		t.Fatalf("unexpected fonts: %+v", fonts)
	}
	if !slices.Contains(fonts[0].Aliases, "Internal Name") || !slices.Contains(fonts[0].Aliases, "sans-serif-light") {
		t.Fatalf("missing metadata aliases: %+v", fonts[0])
	}
	if fonts[2].Weight != 400 || fonts[2].Spacing != FontSpacingMonospace {
		t.Fatalf("unexpected mono metadata: %+v", fonts[2])
	}
}

func TestAndroidFontConfigRejectsUnavailableAndInvalid(t *testing.T) {
	for _, data := range []string{`<broken>`, `<other/>`, `<familyset><family name="test"><font weight="1001">missing.ttf</font><font>../secret.ttf</font><font>/secret.ttf</font><font></font></family></familyset>`} {
		fonts := parseAndroidFontConfig([]byte(data), func(name string) []*Font {
			if name != "missing.ttf" {
				t.Fatalf("invalid path passed to resolver: %q", name)
			}
			return nil
		})
		if len(fonts) != 0 {
			t.Fatalf("unexpected fonts: %+v", fonts)
		}
	}
}

func TestAndroidFontConfigPrefersUpright(t *testing.T) {
	fonts := parseAndroidFontConfig([]byte(`<familyset><family name="sans-serif"><font style="italic">Italic.ttf</font><font style="normal">Regular.ttf</font></family></familyset>`), func(name string) []*Font {
		return []*Font{{Family: name, DisplayName: name}}
	})
	if len(fonts) != 1 || fonts[0].nonNormalStyle || !slices.Contains(fonts[0].Aliases, "Italic.ttf") || !slices.Contains(fonts[0].Aliases, "Regular.ttf") {
		t.Fatalf("unexpected deduplication: %+v", fonts)
	}
}

func TestAndroidFontConfigFamilyLists(t *testing.T) {
	fonts := parseAndroidFontConfig([]byte(`<familyset><family-list name="sans-serif"><family><font weight="400">Regular.ttf</font></family><family><font weight="700">Bold.ttf</font></family></family-list></familyset>`), func(name string) []*Font {
		return []*Font{{Family: "Internal Family", DisplayName: name}}
	})
	if len(fonts) != 2 || fonts[0].Family != "sans-serif" || fonts[1].Weight != 700 {
		t.Fatalf("unexpected family-list: %+v", fonts)
	}
}
