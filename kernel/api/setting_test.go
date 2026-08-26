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

package api

import "testing"

func TestBazaarPluginReloadExcludeApp(t *testing.T) {
	for _, test := range []struct {
		name    string
		enabled bool
		app     string
		want    string
	}{
		{name: "enable excludes requesting app", enabled: true, app: "current-app", want: "current-app"},
		{name: "disable includes requesting app", enabled: false, app: "current-app", want: ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := bazaarPluginReloadExcludeApp(test.enabled, test.app); got != test.want {
				t.Fatalf("unexpected excluded app: got %q, want %q", got, test.want)
			}
		})
	}
}
