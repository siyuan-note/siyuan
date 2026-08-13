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

func TestBuildAIEditorPrompt(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		action string
		want   string
	}{
		{
			name:  "input only",
			input: "Selected text",
			want:  "Selected text",
		},
		{
			name:   "compatible prefix",
			input:  "Selected text",
			action: "Translate",
			want:   "Translate:\n\nSelected text",
		},
		{
			name:   "replace every placeholder",
			input:  "Selected text",
			action: "Before {{input}} and after {{input}}",
			want:   "Before Selected text and after Selected text",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := BuildAIEditorPrompt(test.input, test.action); got != test.want {
				t.Fatalf("unexpected prompt: %q", got)
			}
		})
	}
}
