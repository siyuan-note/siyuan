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

package agent

import "testing"

func TestReasoningTagSplitter(t *testing.T) {
	tests := []struct {
		name          string
		chunks        []string
		wantContent   string
		wantReasoning string
	}{
		{
			name:          "thought tag split across chunks",
			chunks:        []string{"<tho", "ught>reason", "ing</th", "ought>answer"},
			wantContent:   "answer",
			wantReasoning: "reasoning",
		},
		{
			name:          "think tag with surrounding content",
			chunks:        []string{"before<think>inside</think>after"},
			wantContent:   "beforeafter",
			wantReasoning: "inside",
		},
		{
			name:        "ordinary content",
			chunks:      []string{"plain < text", " remains unchanged"},
			wantContent: "plain < text remains unchanged",
		},
		{
			name:        "incomplete tag is flushed",
			chunks:      []string{"answer<th"},
			wantContent: "answer<th",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var splitter reasoningTagSplitter
			var content, reasoning string
			consume := func(segments []reasoningTagSegment) {
				for _, segment := range segments {
					if segment.reasoning {
						reasoning += segment.text
					} else {
						content += segment.text
					}
				}
			}
			for _, chunk := range test.chunks {
				consume(splitter.Write(chunk))
			}
			consume(splitter.Flush())
			if content != test.wantContent || reasoning != test.wantReasoning {
				t.Fatalf("content = %q, reasoning = %q", content, reasoning)
			}
		})
	}
}
