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

package model

import "testing"

func TestNewBoxSort(t *testing.T) {
	tests := []struct {
		name   string
		boxes  []*Box
		atTop  bool
		expect int
	}{
		{name: "empty", expect: 0},
		{name: "prepend", boxes: []*Box{{Sort: 20}, {Sort: -5}, {Sort: 8}}, atTop: true, expect: -6},
		{name: "append", boxes: []*Box{{Sort: 20}, {Sort: -5}, {Sort: 8}}, expect: 21},
		{name: "duplicate prepend", boxes: []*Box{{Sort: 3}, {Sort: 3}}, atTop: true, expect: 2},
		{name: "duplicate append", boxes: []*Box{{Sort: 3}, {Sort: 3}}, expect: 4},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := newBoxSort(test.boxes, test.atTop); test.expect != actual {
				t.Fatalf("sort = %d, want %d", actual, test.expect)
			}
		})
	}
}
