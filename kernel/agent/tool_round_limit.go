// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
