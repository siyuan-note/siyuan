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

package bazaar

import "testing"

func TestBuildBazaarThemeCompatibility(t *testing.T) {
	tests := []struct {
		name               string
		frontends          []string
		frontend           string
		wantIncompatible   bool
		wantDisallowAction bool
	}{
		{name: "missing field on mobile", frontend: "mobile", wantIncompatible: true, wantDisallowAction: true},
		{name: "missing field on browser mobile", frontend: "browser-mobile", wantIncompatible: true, wantDisallowAction: true},
		{name: "missing field on desktop", frontend: "desktop"},
		{name: "all frontends", frontends: []string{"all"}, frontend: "mobile"},
		{name: "supported frontend", frontends: []string{"desktop", "mobile"}, frontend: "mobile"},
		{name: "unsupported frontend", frontends: []string{"desktop"}, frontend: "mobile", wantIncompatible: true, wantDisallowAction: true},
		{name: "missing current frontend", frontends: []string{"desktop"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pkg := buildBazaarPackageWithMetadata(&StageRepo{
				URL: "owner/theme@hash",
				Package: &Package{
					Name:      "theme",
					Frontends: test.frontends,
				},
			}, nil, nil, false, "themes", test.frontend)
			if nil == pkg || nil == pkg.BazaarIncompatible {
				t.Fatal("expected theme compatibility metadata")
			}
			if *pkg.BazaarIncompatible != test.wantIncompatible {
				t.Fatalf("expected incompatible=%v, got %v", test.wantIncompatible, *pkg.BazaarIncompatible)
			}
			if pkg.DisallowInstall != test.wantDisallowAction || pkg.DisallowUpdate != test.wantDisallowAction {
				t.Fatalf("expected install and update restriction=%v, got install=%v update=%v",
					test.wantDisallowAction, pkg.DisallowInstall, pkg.DisallowUpdate)
			}
		})
	}
}
