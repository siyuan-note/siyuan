// SiYuan - Refactor your thinking
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
	"strconv"
	"strings"

	"github.com/sashabaranov/go-openai"
)

func isContextOverflow(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "context_length_exceeded") ||
		strings.Contains(msg, "maximum context length") ||
		strings.Contains(msg, "reduce the length") ||
		strings.Contains(msg, "too many tokens") ||
		strings.Contains(msg, "input is too long") ||
		strings.Contains(msg, "exceeds the context window") ||
		strings.Contains(msg, "超出上下文") ||
		strings.Contains(msg, "上下文长度")
}

func compactMessages(msgs []openai.ChatCompletionMessage, keepLastUserMessages int) []openai.ChatCompletionMessage {
	if len(msgs) <= 2 || keepLastUserMessages <= 0 {
		return msgs
	}

	// Find cut-off point: count backwards to find the Nth user message
	userCount := 0
	cutIdx := 1 // default: keep only system prompt
	for i := len(msgs) - 1; i >= 1; i-- {
		if msgs[i].Role == openai.ChatMessageRoleUser {
			userCount++
			if userCount == keepLastUserMessages {
				cutIdx = i
				break
			}
		}
	}

	if cutIdx <= 1 {
		return msgs // nothing to compact
	}

	oldMsgs := msgs[1:cutIdx]
	summary := extractSummary(oldMsgs)

	compacted := make([]openai.ChatCompletionMessage, 0, 1+1+len(msgs)-cutIdx)
	compacted = append(compacted, msgs[0]) // system prompt
	compacted = append(compacted, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleSystem,
		Content: "[Earlier conversation summarized]\n" + summary + "\n\nContinue based on the summary above.",
	})
	compacted = append(compacted, msgs[cutIdx:]...) // recent messages

	return compacted
}

func extractSummary(msgs []openai.ChatCompletionMessage) string {
	var sb strings.Builder
	var toolNames []string
	var userMsgs []string
	var assistantMsgs []string

	for _, m := range msgs {
		switch m.Role {
		case openai.ChatMessageRoleUser:
			text := strings.TrimSpace(m.Content)
			if text != "" {
				runes := []rune(text)
				if len(runes) > 300 {
					text = string(runes[:300]) + "..."
				}
				userMsgs = append(userMsgs, "- User: "+text)
			}
		case openai.ChatMessageRoleAssistant:
			for _, tc := range m.ToolCalls {
				toolNames = append(toolNames, tc.Function.Name)
			}
			if text := strings.TrimSpace(m.Content); text != "" {
				assistantMsgs = append(assistantMsgs, "- Assistant: "+firstSentence(text))
			}
		}
	}

	if len(userMsgs) > 0 {
		sb.WriteString(strings.Join(userMsgs, "\n"))
	}
	if len(assistantMsgs) > 0 {
		if sb.Len() > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(strings.Join(assistantMsgs, "\n"))
	}
	if len(toolNames) > 0 {
		if sb.Len() > 0 {
			sb.WriteString("\n")
		}
		seen := map[string]int{}
		var counts []string
		for _, name := range toolNames {
			seen[name]++
		}
		for name, count := range seen {
			if count > 1 {
				counts = append(counts, name+" ×"+strconv.Itoa(count))
			} else {
				counts = append(counts, name)
			}
		}
		sb.WriteString("- Tools used: " + strings.Join(counts, ", "))
	}

	if sb.Len() == 0 {
		return "(no content to summarize)"
	}
	return sb.String()
}

func compactCheckpointMsgs(msgs []AgentMessage, keepLastUserMessages int) []AgentMessage {
	if len(msgs) <= 1 || keepLastUserMessages <= 0 {
		return msgs
	}

	userCount := 0
	cutIdx := 0
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			userCount++
			if userCount == keepLastUserMessages {
				cutIdx = i
				break
			}
		}
	}

	if cutIdx <= 0 {
		return msgs
	}

	oldMsgs := msgs[:cutIdx]
	summary := extractCheckpointSummary(oldMsgs)

	compacted := make([]AgentMessage, 0, 1+len(msgs)-cutIdx)
	compacted = append(compacted, AgentMessage{
		Role:    "system",
		Content: "[Earlier conversation summarized]\n" + summary + "\n\nContinue based on the summary above.",
	})
	compacted = append(compacted, msgs[cutIdx:]...)

	return compacted
}

func extractCheckpointSummary(msgs []AgentMessage) string {
	var sb strings.Builder
	var toolNames []string
	var userMsgs []string
	var assistantMsgs []string

	for _, m := range msgs {
		switch m.Role {
		case "user":
			text := strings.TrimSpace(m.Content)
			if text != "" {
				runes := []rune(text)
				if len(runes) > 300 {
					text = string(runes[:300]) + "..."
				}
				userMsgs = append(userMsgs, "- User: "+text)
			}
		case "assistant":
			for _, tc := range m.ToolCalls {
				toolNames = append(toolNames, tc.Name)
			}
			if text := strings.TrimSpace(m.Content); text != "" {
				assistantMsgs = append(assistantMsgs, "- Assistant: "+firstSentence(text))
			}
		}
	}

	if len(userMsgs) > 0 {
		sb.WriteString(strings.Join(userMsgs, "\n"))
	}
	if len(assistantMsgs) > 0 {
		if sb.Len() > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(strings.Join(assistantMsgs, "\n"))
	}
	if len(toolNames) > 0 {
		if sb.Len() > 0 {
			sb.WriteString("\n")
		}
		seen := map[string]int{}
		var counts []string
		for _, name := range toolNames {
			seen[name]++
		}
		for name, count := range seen {
			if count > 1 {
				counts = append(counts, name+" ×"+strconv.Itoa(count))
			} else {
				counts = append(counts, name)
			}
		}
		sb.WriteString("- Tools used: " + strings.Join(counts, ", "))
	}

	if sb.Len() == 0 {
		return "(no content to summarize)"
	}
	return sb.String()
}

func firstSentence(text string) string {
	runes := []rune(text)
	if len(runes) <= 200 {
		return text
	}
	sentence := string(runes[:200])
	if idx := strings.IndexAny(sentence, ".。!?！？\n"); idx > 0 {
		return sentence[:idx+1] + "..."
	}
	return sentence + "..."
}
