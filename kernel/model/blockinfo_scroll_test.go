// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "testing"

func TestScrollTargetsExist(t *testing.T) {
	const existingID = "20261122000000-scroll1"
	exist := func(id string) bool { return existingID == id }
	for _, test := range []struct {
		name   string
		scroll map[string]any
		want   bool
	}{
		{name: "empty", scroll: map[string]any{}, want: true},
		{name: "valid start", scroll: map[string]any{"startId": existingID}, want: true},
		{name: "missing start", scroll: map[string]any{"startId": "20261122000000-missing"}, want: false},
		{name: "numeric start", scroll: map[string]any{"startId": float64(123)}, want: false},
		{name: "boolean end", scroll: map[string]any{"endId": true}, want: false},
		{name: "null start", scroll: map[string]any{"startId": nil}, want: true},
		{name: "valid zoom ignores start", scroll: map[string]any{"zoomInId": existingID, "startId": float64(123)}, want: true},
		{name: "numeric zoom", scroll: map[string]any{"zoomInId": float64(123)}, want: false},
		{name: "missing zoom", scroll: map[string]any{"zoomInId": "20261122000000-missing"}, want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := scrollTargetsExist(test.scroll, exist); got != test.want {
				t.Fatalf("scrollTargetsExist(%v) = %v, want %v", test.scroll, got, test.want)
			}
		})
	}
}
