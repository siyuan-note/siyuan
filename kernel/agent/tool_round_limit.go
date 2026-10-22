// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import "strings"

const toolRoundLimitPrompt = `

## Tool call round limit reached
The tool call budget for this user turn is exhausted. No tools are available for this final response.
Do not request, simulate, or output tool calls in any format, including textual tool-call markup.
Using only the results already available, give a final answer in the user's configured language. Clearly distinguish completed work from unfinished or unverified work, explain that the tool call round limit was reached, and do not claim that unexecuted operations succeeded.`

func containsTextToolCall(content string) bool {
	for _, marker := range []string{"<｜｜DSML｜｜", "<|DSML|", "<|tool_calls|>", "<antml:invoke", "<antml:tool_calls"} {
		if strings.Contains(content, marker) {
			return true
		}
	}
	return false
}
