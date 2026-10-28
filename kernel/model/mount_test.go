// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
