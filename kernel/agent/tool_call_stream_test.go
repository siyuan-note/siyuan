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

import (
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestToolCallStreamAccumulatorIndexedFragments(t *testing.T) {
	index := 0
	var accumulator toolCallStreamAccumulator
	accumulator.Add([]openai.ToolCall{{
		Index: &index,
		ID:    "call-1",
		Type:  openai.ToolTypeFunction,
		Function: openai.FunctionCall{
			Name:      "notebook",
			Arguments: `{"action":`,
		},
	}})
	accumulator.Add([]openai.ToolCall{{
		Index: &index,
		Function: openai.FunctionCall{
			Arguments: `"list"}`,
		},
	}})

	calls := accumulator.ToolCalls()
	if len(calls) != 1 || calls[0].ID != "call-1" || calls[0].Function.Name != "notebook" ||
		calls[0].Function.Arguments != `{"action":"list"}` {
		t.Fatalf("unexpected accumulated tool call: %#v", calls)
	}
}

func TestToolCallStreamAccumulatorParallelCallsWithoutIndexes(t *testing.T) {
	var accumulator toolCallStreamAccumulator
	accumulator.Add([]openai.ToolCall{
		{
			ID: "call-1",
			Function: openai.FunctionCall{
				Name:      "notebook",
				Arguments: `{"action":"query"}`,
			},
		},
		{
			ID: "call-2",
			Function: openai.FunctionCall{
				Name:      "notebook",
				Arguments: `{"action":"list"}`,
			},
		},
	})

	calls := accumulator.ToolCalls()
	if len(calls) != 2 {
		t.Fatalf("unexpected tool call count: %d", len(calls))
	}
	if calls[0].ID != "call-1" || calls[0].Function.Arguments != `{"action":"query"}` {
		t.Fatalf("unexpected first tool call: %#v", calls[0])
	}
	if calls[1].ID != "call-2" || calls[1].Function.Arguments != `{"action":"list"}` {
		t.Fatalf("unexpected second tool call: %#v", calls[1])
	}
}

func TestToolCallStreamAccumulatorSeparateCallsWithoutIndexes(t *testing.T) {
	var accumulator toolCallStreamAccumulator
	accumulator.Add([]openai.ToolCall{{
		ID:       "call-1",
		Function: openai.FunctionCall{Name: "sql", Arguments: `{"stmt":"SELECT 1"}`},
	}})
	accumulator.Add([]openai.ToolCall{{
		ID:       "call-2",
		Function: openai.FunctionCall{Name: "notebook", Arguments: `{"action":"list"}`},
	}})

	calls := accumulator.ToolCalls()
	if len(calls) != 2 || calls[0].ID != "call-1" || calls[1].ID != "call-2" {
		t.Fatalf("separate unindexed calls were merged: %#v", calls)
	}
}

func TestToolCallStreamAccumulatorCumulativeArguments(t *testing.T) {
	var accumulator toolCallStreamAccumulator
	accumulator.Add([]openai.ToolCall{{
		ID:       "call-1",
		Function: openai.FunctionCall{Name: "notebook", Arguments: `{"action":`},
	}})
	accumulator.Add([]openai.ToolCall{{
		ID:       "call-1",
		Function: openai.FunctionCall{Arguments: `{"action":"list"}`},
	}})

	calls := accumulator.ToolCalls()
	if len(calls) != 1 || calls[0].Function.Arguments != `{"action":"list"}` {
		t.Fatalf("cumulative arguments were duplicated: %#v", calls)
	}
}
