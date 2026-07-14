// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package util

import (
	"strings"
	"testing"
)

func TestSanitizeSVGRemovesActiveContent(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"script", `<svg><script>alert(1)</script></svg>`},
		{"style parser difference", `<svg><desc><style><script>alert(1)</script></style></desc></svg>`},
		{"xmp parser difference", `<svg><title><xmp><script>alert(1)</script></xmp></title></svg>`},
		{"noscript parser difference", `<svg><desc><noscript><script>alert(1)</script></noscript></desc></svg>`},
		{"prefixed script", `<svg xmlns:s="urn:test"><s:script>alert(1)</s:script></svg>`},
		{"foreign object", `<svg><foreignObject><div><script>alert(1)</script></div></foreignObject></svg>`},
		{"animation", `<svg><animate attributeName="href" values="javascript:alert(1)"></animate></svg>`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			output, err := SanitizeSVG(test.input)
			if err != nil {
				t.Fatalf("sanitize failed: %v", err)
			}
			lower := strings.ToLower(output)
			for _, unsafe := range []string{"<script", ":script", "<foreignobject", "<animate", "javascript:"} {
				if strings.Contains(lower, unsafe) {
					t.Fatalf("unsafe content %q remains in %q", unsafe, output)
				}
			}
		})
	}
}

func TestSanitizeSVGFiltersUnsafeAttributes(t *testing.T) {
	input := `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">` +
		`<a href="java&#x0A;script:alert(1)" xlink:href="vbscript:alert(1)" style="background:url(javascript:alert(1))">` +
		`<image href="data:image/png;base64,AA=="></image></a></svg>`
	output, err := SanitizeSVG(input)
	if err != nil {
		t.Fatalf("sanitize failed: %v", err)
	}
	lower := strings.ToLower(output)
	for _, unsafe := range []string{"onload=", "javascript:", "vbscript:"} {
		if strings.Contains(lower, unsafe) {
			t.Fatalf("unsafe attribute %q remains in %q", unsafe, output)
		}
	}
	if !strings.Contains(output, `href="data:image/png;base64,AA=="`) {
		t.Fatalf("safe bitmap data URL was removed from %q", output)
	}
}

func TestSanitizeSVGPreservesStaticSVG(t *testing.T) {
	input := `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">` +
		`<defs><linearGradient id="g"><stop offset="0%" stop-color="#fff"></stop></linearGradient></defs>` +
		`<path d="M0 0h10v10z" fill="url(#g)"></path><use xlink:href="#shape"></use></svg>`
	output, err := SanitizeSVG(input)
	if err != nil {
		t.Fatalf("sanitize failed: %v", err)
	}
	for _, expected := range []string{`xmlns="http://www.w3.org/2000/svg"`, `xmlns:xlink="http://www.w3.org/1999/xlink"`,
		`<linearGradient`, `<path`, `xlink:href="#shape"`} {
		if !strings.Contains(output, expected) {
			t.Fatalf("static SVG content %q is missing from %q", expected, output)
		}
	}
}

func TestSanitizeSVGRejectsInvalidInput(t *testing.T) {
	tests := []string{
		`<html></html>`,
		`<svg><path></svg>`,
		`<svg><script><path></script></path></svg>`,
		`<svg></svg><svg></svg>`,
		`<!DOCTYPE svg><svg></svg>`,
		`text<svg></svg>`,
	}
	for _, input := range tests {
		if output, err := SanitizeSVG(input); err == nil {
			t.Fatalf("invalid input %q produced %q", input, output)
		}
	}
}
