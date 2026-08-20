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
	"encoding/json"
	"strings"

	"github.com/sashabaranov/go-openai"
)

// toolCallStreamAccumulator 兼容省略 index 的流式工具调用，并按调用 ID 保持多个并行调用相互独立。
type toolCallStreamAccumulator struct {
	calls     []openai.ToolCall
	indexByID map[string]int
}

func (a *toolCallStreamAccumulator) Add(deltas []openai.ToolCall) {
	for position, delta := range deltas {
		index := a.resolveIndex(delta, position, len(deltas))
		for len(a.calls) <= index {
			a.calls = append(a.calls, openai.ToolCall{})
		}

		call := &a.calls[index]
		if delta.ID != "" {
			call.ID = delta.ID
			if a.indexByID == nil {
				a.indexByID = map[string]int{}
			}
			a.indexByID[delta.ID] = index
		}
		if delta.Type != "" {
			call.Type = delta.Type
		}
		if delta.Function.Name != "" {
			call.Function.Name = delta.Function.Name
		}
		call.Function.Arguments = mergeStreamedToolCallArguments(call.Function.Arguments, delta.Function.Arguments)
	}
}

func (a *toolCallStreamAccumulator) ToolCalls() []openai.ToolCall {
	return a.calls
}

func (a *toolCallStreamAccumulator) resolveIndex(delta openai.ToolCall, position, batchSize int) int {
	if delta.Index != nil && *delta.Index >= 0 {
		return *delta.Index
	}
	if delta.ID != "" {
		if index, ok := a.indexByID[delta.ID]; ok {
			return index
		}
		if batchSize > 1 && position < len(a.calls) {
			existingID := a.calls[position].ID
			if existingID == "" || existingID == delta.ID {
				return position
			}
		}
		if len(a.calls) == 0 {
			return 0
		}
		return len(a.calls)
	}
	if batchSize > 1 {
		return position
	}
	return 0
}

func mergeStreamedToolCallArguments(existing, fragment string) string {
	if fragment == "" {
		return existing
	}
	if existing == "" {
		return fragment
	}
	if strings.HasPrefix(fragment, existing) {
		return fragment
	}
	if isCompleteToolCallArguments(existing) && isCompleteToolCallArguments(fragment) {
		return fragment
	}
	return existing + fragment
}

func isCompleteToolCallArguments(value string) bool {
	var object map[string]any
	return json.Unmarshal([]byte(value), &object) == nil && object != nil
}
