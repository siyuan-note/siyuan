// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

type compactionRequestBudgetKey struct{}

// consumeCompactionRequest 将重试也计入压缩预算，普通对话请求不使用这个计数器。
func consumeCompactionRequest(ctx context.Context) error {
	requests, _ := ctx.Value(compactionRequestBudgetKey{}).(*int)
	if requests == nil {
		return nil
	}
	if *requests >= compactionMaxRequests {
		return errCompactionLimit
	}
	*requests++
	return nil
}

// compactionHistory 与持久化会话使用相同的消息投影，临时 system 警告另外保留。
func compactionHistory(messages []AgentMessage) []AgentMessage {
	history := make([]AgentMessage, 0, len(messages))
	for _, message := range messages {
		if message.Role == "user" || message.Role == "assistant" {
			history = append(history, message)
		}
	}
	return history
}

func compactionMessageDigest(messages []AgentMessage) (string, error) {
	messages = append([]AgentMessage(nil), messages...)
	for i := range messages {
		// 助手条目 ID 在运行恢复时派生，轮次 ID、调用 ID 和完整内容作为稳定校验信息。
		if messages[i].Role == "assistant" {
			messages[i].EntryID = ""
		}
	}
	data, err := json.Marshal(messages)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// compactionRecordMessages 使用用户发送时的原文校验持久化记录，变量展开只用于模型输入。
func compactionRecordMessages(messages []AgentMessage, rawUserMessage string) []AgentMessage {
	records := append([]AgentMessage(nil), messages...)
	if index := sessionUserMessageIndex(records); index >= 0 {
		records[index].Content = rawUserMessage
	}
	return records
}

func compactionScopeKey(protocol, model, providerKey string) string {
	sum := sha256.Sum256([]byte(protocol + "\x00" + model + "\x00" + providerKey))
	return hex.EncodeToString(sum[:])
}

func validMessageCompaction(messages []AgentMessage, compaction *runtimeCompaction) bool {
	if compaction == nil || compaction.Version != messageCompactionVersion {
		return false
	}
	if strings.TrimSpace(compaction.Summary) == "" &&
		(!util.IsOpenAIResponsesProtocol(compaction.Protocol) || len(compaction.ResponseOutput) == 0) {
		return false
	}
	history := compactionHistory(messages)
	covered := compaction.CoveredMessageCount
	if covered <= 0 || len(history) < covered || history[covered-1].RoundID != compaction.CoveredRoundID {
		return false
	}
	digest, err := compactionMessageDigest(history[:covered])
	return err == nil && digest == compaction.CoveredDigest
}

func newRuntimeMessageCompaction(messages []AgentMessage, covered int, protocol, model, scopeKey string) (*runtimeCompaction, error) {
	history := compactionHistory(messages)
	if covered <= 0 || len(history) < covered {
		return nil, errContextCannotBeCompacted
	}
	digest, err := compactionMessageDigest(history[:covered])
	if err != nil {
		return nil, err
	}
	return &runtimeCompaction{
		Version:             messageCompactionVersion,
		Protocol:            protocol,
		Model:               model,
		ScopeKey:            scopeKey,
		CoveredMessageCount: covered,
		CoveredRoundID:      history[covered-1].RoundID,
		CoveredDigest:       digest,
		UpdatedAt:           time.Now().UnixMilli(),
	}, nil
}

// projectCompactionContext 只缩减模型输入，本轮用户原文和临时警告仍保留在上下文中。
func projectCompactionContext(messages []AgentMessage, covered int) []AgentMessage {
	history := compactionHistory(messages)
	if covered < 0 || len(history) < covered {
		covered = 0
	}
	var projected []AgentMessage
	for i := len(history) - 1; i >= 0; i-- {
		if history[i].Role == "user" {
			if i < covered {
				projected = append(projected, history[i])
			}
			break
		}
	}
	index := 0
	for _, message := range messages {
		if message.Role == "system" {
			projected = append(projected, message)
		} else if message.Role == "user" || message.Role == "assistant" {
			if index >= covered {
				projected = append(projected, message)
			}
			index++
		}
	}
	return projected
}

func completedToolGroup(message AgentMessage) bool {
	if message.Role != "assistant" || len(message.ToolCalls) == 0 {
		return false
	}
	for _, call := range message.ToolCalls {
		if call.Result == "" || call.State == "pending" || call.State == "executing" || call.State == "unknown" {
			return false
		}
	}
	return true
}

func protectedCompactionMessage(message AgentMessage, protocol string) bool {
	if message.NativeContent != nil || util.IsOpenAIResponsesProtocol(protocol) && len(message.ResponseOutput) > 0 {
		return true
	}
	for _, call := range message.ToolCalls {
		if call.ProviderData != nil && call.ProviderData.Google != nil && call.ProviderData.Google.ThoughtSignature != "" {
			return true
		}
	}
	return false
}

// compactionCandidateMessageCounts 在用户轮次或本轮完整工具调用组结束后选择边界。
func compactionCandidateMessageCounts(messages []AgentMessage, covered int, protocol string, native, imageInputDisabled bool) (candidates []int, protected bool) {
	history := compactionHistory(messages)
	currentUser := sessionUserMessageIndex(history)
	if currentUser < 0 {
		return nil, false
	}
	for _, message := range history[currentUser+1:] {
		protected = protected || protectedCompactionMessage(message, protocol)
	}
	for i := covered + 1; i <= currentUser; i++ {
		if history[i].Role == "user" {
			candidates = append(candidates, i)
		}
	}
	if protected && !native {
		return candidates, true
	}
	latestImage, _ := latestAgentMessageAttachments(history)
	for i := max(covered, currentUser+1); i < len(history); i++ {
		// 本轮最新图片仍需交给模型查看，连同其工具调用组一起保留。
		if !imageInputDisabled && i == latestImage {
			break
		}
		if !completedToolGroup(history[i]) {
			break
		}
		candidates = append(candidates, i+1)
	}
	return candidates, protected
}

func sessionUserMessageIndex(messages []AgentMessage) int {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return i
		}
	}
	return -1
}

// createBatchedCompactionSummary 按输入预算顺序归纳历史片段，摘要只在全部成功后替换。
func createBatchedCompactionSummary(ctx context.Context, client *util.AIClient, protocol, model, source string,
	contextLimit, maxTokens, maxRetries int, requestTimeout, streamIdleTimeout time.Duration,
	requests *int, ch chan<- AgentEvent) (summary string, promptTokens, completionTokens int, err error) {
	ctx = context.WithValue(ctx, compactionRequestBudgetKey{}, requests)
	inputBudget := contextInputBudget(contextLimit, maxTokens)
	runes := []rune(source)
	for len(runes) > 0 {
		if ctx.Err() != nil {
			return "", promptTokens, completionTokens, ctx.Err()
		}
		if *requests >= compactionMaxRequests {
			return "", promptTokens, completionTokens, errCompactionLimit
		}
		fragmentSource := func(count int) string {
			if summary == "" && count == len(runes) {
				return string(runes)
			}
			return "<previous_summary>\n" + summary + "\n</previous_summary>\n" +
				"The following is the next consecutive fragment of serialized conversation history. " +
				"It may start or end inside a record. Merge its facts into the previous summary.\n" +
				"<history_fragment>\n" + string(runes[:count]) + "\n</history_fragment>"
		}
		fits := func(count int) bool {
			return estimateChatRequestTokens(model, compactionSummaryMessages(fragmentSource(count)), nil) <= inputBudget
		}
		count := len(runes)
		if !fits(count) {
			low, high := 0, count
			for low < high {
				if ctx.Err() != nil {
					return "", promptTokens, completionTokens, ctx.Err()
				}
				middle := low + (high-low+1)/2
				if fits(middle) {
					low = middle
				} else {
					high = middle - 1
				}
			}
			count = low
		}
		if count == 0 {
			return "", promptTokens, completionTokens, errCompactionInputTooLarge
		}
		var input, output int
		summary, input, output, err = createProtocolCompactionSummary(ctx, client, protocol, model,
			fragmentSource(count), maxTokens, maxRetries, requestTimeout, streamIdleTimeout, ch)
		promptTokens += input
		completionTokens += output
		if err != nil {
			return "", promptTokens, completionTokens, fmt.Errorf("%w: %w", errCompactionSummaryFailed, err)
		}
		runes = runes[count:]
	}
	return summary, promptTokens, completionTokens, nil
}
