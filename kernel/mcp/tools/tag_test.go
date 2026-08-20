// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package tools

import "testing"

func TestFormatTagTextMark(t *testing.T) {
	tests := []struct {
		name     string
		label    string
		expected string
	}{
		{
			name:     "leading dollar",
			label:    "$01want",
			expected: `<span data-type="tag">$01want</span>`,
		},
		{
			name:     "HTML characters",
			label:    `<script>&"'`,
			expected: `<span data-type="tag">&lt;script&gt;&amp;&#34;&#39;</span>`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := formatTagTextMark(test.label); actual != test.expected {
				t.Fatalf("unexpected tag text mark: %q", actual)
			}
		})
	}
}
