// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import "testing"

func TestHTMLAssetIFrameSrc(t *testing.T) {
	tests := []struct {
		name string
		src  string
		want string
	}{
		{name: "HTML", src: "assets/component.html", want: "assets/component.html?iframe=true"},
		{name: "HTM with query", src: "assets/component.htm?box=box-id", want: "assets/component.htm?box=box-id&iframe=true"},
		{name: "replace marker", src: "assets/component.html?iframe=false", want: "assets/component.html?iframe=true"},
		{name: "preserve fragment", src: "assets/component.html#preview", want: "assets/component.html?iframe=true#preview"},
		{name: "already marked", src: "assets/component.html?iframe=true", want: "assets/component.html?iframe=true"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := HTMLAssetIFrameSrc(test.src); got != test.want {
				t.Fatalf("HTMLAssetIFrameSrc(%q) = %q, want %q", test.src, got, test.want)
			}
			if !IsHTMLAssetIFrameSrc(test.want) {
				t.Fatalf("IsHTMLAssetIFrameSrc(%q) = false", test.want)
			}
		})
	}
}

func TestIsLocalHTMLAssetPath(t *testing.T) {
	for _, src := range []string{
		"assets/component.html",
		"./assets/component.htm?box=box-id",
		"/assets/component.HTML?iframe=true#preview",
	} {
		if !IsLocalHTMLAssetPath(src) {
			t.Fatalf("IsLocalHTMLAssetPath(%q) = false", src)
		}
	}

	for _, src := range []string{
		"component.html",
		"assets/component.xhtml",
		"https://example.com/assets/component.html",
		"../assets/component.html",
	} {
		if IsLocalHTMLAssetPath(src) {
			t.Fatalf("IsLocalHTMLAssetPath(%q) = true", src)
		}
	}
}

func TestIsHTMLAssetIFrameSrcRejectsInvalidSources(t *testing.T) {
	for _, src := range []string{
		"assets/component.html",
		"assets/component.html?iframe=false",
		"assets/component.xhtml?iframe=true",
		"assets/component.js?iframe=true",
		"https://example.com/component.html?iframe=true",
		"component.html?iframe=true",
	} {
		if IsHTMLAssetIFrameSrc(src) {
			t.Fatalf("IsHTMLAssetIFrameSrc(%q) = true", src)
		}
	}
}
