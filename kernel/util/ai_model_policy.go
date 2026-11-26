// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"errors"
	"sync/atomic"
)

type AIModelPolicy uint32

const (
	AIModelsFull AIModelPolicy = iota
	AIModelsDeepSeek
	AIModelsUnavailable
)

const (
	DeepSeekBaseURL     = "https://api.deepseek.com"
	DeepSeekModel       = "deepseek-flash"
	DeepSeekOnlyFeature = "ai-unrestricted-providers"
)

var aiModelPolicy atomic.Uint32

var ErrAIModelPolicy = errors.New("AI model is unavailable for this distribution")

func SetAIModelPolicy(policy string) bool {
	next := AIModelsUnavailable
	switch policy {
	case "full":
		next = AIModelsFull
	case "deepseek":
		next = AIModelsDeepSeek
	}
	return aiModelPolicy.Swap(uint32(next)) != uint32(next)
}

func CurrentAIModelPolicy() AIModelPolicy {
	return AIModelPolicy(aiModelPolicy.Load())
}

func AIModelPolicyFeatures(features []string, policy AIModelPolicy) []string {
	switch policy {
	case AIModelsDeepSeek:
		return append(append([]string(nil), features...), DeepSeekOnlyFeature)
	case AIModelsUnavailable:
		return append(append([]string(nil), features...), "ai")
	default:
		return features
	}
}

func aiCompletionAllowed(client *AIClient, protocol, model string) bool {
	switch CurrentAIModelPolicy() {
	case AIModelsFull:
		return true
	case AIModelsDeepSeek:
		return client != nil && !client.ChatGPT && client.baseURL == DeepSeekBaseURL && protocol == "openai" && model == DeepSeekModel
	default:
		return false
	}
}
