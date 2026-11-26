// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const distributionDeepSeekID = "siyuan-deepseek-flash"

// EffectiveAI 将渠道允许的模型和能力投影到运行时，工作区的完整配置用于持久化。
func (ai *AI) EffectiveAI(policy util.AIModelPolicy) *AI {
	if policy == util.AIModelsFull {
		return ai
	}
	effective := NewAI()
	if policy == util.AIModelsDeepSeek {
		key := ""
		if ai != nil {
			for _, provider := range ai.Providers {
				if isDistributionDeepSeek(provider) {
					key = provider.APIKey
					break
				}
			}
		}
		effective.Providers = []*Provider{distributionDeepSeek(key)}
		effective.Agent.ModelID = distributionDeepSeekID
		effective.Editing.ModelID = distributionDeepSeekID
	}
	return effective
}

func (ai *AI) WithDistributionDeepSeekKey(request *AI) (*AI, error) {
	if request == nil || len(request.Providers) != 1 || !isDistributionDeepSeek(request.Providers[0]) {
		return nil, util.ErrAIModelPolicy
	}
	if ai == nil {
		ai = NewAI()
	}
	next := *ai
	next.Providers = make([]*Provider, 0, len(ai.Providers)+1)
	for _, provider := range ai.Providers {
		if provider == nil || provider.ID != distributionDeepSeekID {
			next.Providers = append(next.Providers, provider)
		}
	}
	next.Providers = append(next.Providers, distributionDeepSeek(request.Providers[0].APIKey))
	return &next, nil
}

func isDistributionDeepSeek(provider *Provider) bool {
	if provider == nil || provider.ID != distributionDeepSeekID || provider.BaseURL != util.DeepSeekBaseURL ||
		provider.Protocol != "openai" || provider.AuthType != "" || provider.AccountID != "" || len(provider.Headers) != 0 ||
		len(provider.Models) != 1 {
		return false
	}
	model := provider.Models[0]
	return model != nil && model.ID == distributionDeepSeekID && model.Name == util.DeepSeekModel
}

func distributionDeepSeek(key string) *Provider {
	key = strings.TrimSpace(key)
	return &Provider{
		ID: distributionDeepSeekID, DisplayName: "DeepSeek", Enabled: key != "", APIKey: key,
		BaseURL: util.DeepSeekBaseURL, Protocol: "openai", RequestTimeout: 120,
		Models: []*Model{{ID: distributionDeepSeekID, Name: util.DeepSeekModel, Enabled: true}},
	}
}
