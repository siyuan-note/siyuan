// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import "testing"

func TestBuildBazaarThemeCompatibility(t *testing.T) {
	tests := []struct {
		name                   string
		frontends              []string
		frontend               string
		minAppVersion          string
		wantVersionUnsupported bool
		wantIncompatible       bool
		wantDisallowAction     bool
	}{
		{name: "missing field on mobile", frontend: "mobile", wantIncompatible: true, wantDisallowAction: true},
		{name: "missing field on browser mobile", frontend: "browser-mobile", wantIncompatible: true, wantDisallowAction: true},
		{name: "missing field on desktop", frontend: "desktop"},
		{name: "all frontends", frontends: []string{"all"}, frontend: "mobile"},
		{name: "supported frontend", frontends: []string{"desktop", "mobile"}, frontend: "mobile"},
		{name: "unsupported frontend", frontends: []string{"desktop"}, frontend: "mobile", wantIncompatible: true, wantDisallowAction: true},
		{name: "missing current frontend", frontends: []string{"desktop"}},
		{name: "version and missing mobile field", frontend: "mobile", minAppVersion: "99999.0.0", wantVersionUnsupported: true, wantIncompatible: true, wantDisallowAction: true},
		{name: "version and missing browser mobile field", frontend: "browser-mobile", minAppVersion: "99999.0.0", wantVersionUnsupported: true, wantIncompatible: true, wantDisallowAction: true},
		{name: "version on supported mobile", frontends: []string{"mobile"}, frontend: "mobile", minAppVersion: "99999.0.0", wantVersionUnsupported: true, wantDisallowAction: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pkg := buildBazaarPackageWithMetadata(&StageRepo{
				URL: "owner/theme@hash",
				Package: &Package{
					Name:          "theme",
					Frontends:     test.frontends,
					MinAppVersion: test.minAppVersion,
				},
			}, nil, nil, false, "themes", test.frontend)
			if nil == pkg || nil == pkg.BazaarIncompatible {
				t.Fatal("expected theme compatibility metadata")
			}
			if *pkg.BazaarIncompatible != test.wantIncompatible {
				t.Fatalf("expected incompatible=%v, got %v", test.wantIncompatible, *pkg.BazaarIncompatible)
			}
			if pkg.BazaarVersionUnsupported != test.wantVersionUnsupported {
				t.Fatalf("expected versionUnsupported=%v, got %v", test.wantVersionUnsupported, pkg.BazaarVersionUnsupported)
			}
			if pkg.DisallowInstall != test.wantDisallowAction || pkg.DisallowUpdate != test.wantDisallowAction {
				t.Fatalf("expected install and update restriction=%v, got install=%v update=%v",
					test.wantDisallowAction, pkg.DisallowInstall, pkg.DisallowUpdate)
			}
		})
	}
}
