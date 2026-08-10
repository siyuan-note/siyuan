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

package conf

import "testing"

func TestNormalizeBacklinkExpandCount(t *testing.T) {
	tests := []struct {
		name     string
		count    int
		expected int
	}{
		{"preserves collapsed panel", -1, -1},
		{"clamps unsupported negative values", -2, -1},
		{"preserves folded contexts", 0, 0},
		{"preserves expanded contexts", 10, 10},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := NormalizeBacklinkExpandCount(test.count); actual != test.expected {
				t.Fatalf("expected %d, got %d", test.expected, actual)
			}
		})
	}
}
