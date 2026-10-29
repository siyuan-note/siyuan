// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"errors"
	"slices"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// Memory 总开关控制使用和自动维护；笔记默认覆盖非加密笔记本，仍检查运行时访问权限。
type Memory struct {
	Enabled         bool   `json:"enabled"`
	ModelID         string `json:"modelId"`
	ReasoningEffort string `json:"reasoningEffort"`
}

func defaultMemory() *Memory { return &Memory{} }

// Normalize 不清除失效的模型引用或推理选项，以便界面展示并要求用户修正。
func (memory *Memory) Normalize() {
	memory.ModelID = strings.TrimSpace(memory.ModelID)
	memory.ReasoningEffort = strings.ToLower(strings.TrimSpace(memory.ReasoningEffort))
}

// GetMemoryModel 只接受用户选择的稳定模型 ID，不接受旧名称或首个可用模型回退。
func (ai *AI) GetMemoryModel() (*Provider, *Model, error) {
	if ai == nil || ai.Memory == nil || ai.Memory.ModelID == "" {
		return nil, nil, errors.New("memory model not selected")
	}
	for _, provider := range ai.Providers {
		if provider == nil || !provider.Enabled {
			continue
		}
		for _, model := range provider.Models {
			if model != nil && model.Enabled && model.Name != "" && model.ID == ai.Memory.ModelID {
				return provider, model, nil
			}
		}
	}
	return nil, nil, errors.New("memory model unavailable")
}

// MemoryReasoningEfforts 返回与智能体一致的标准推理档位，不包含默认空值。
// 具体模型的支持情况由供应商决定，协议适配器负责透传或转换，不根据模型名称推断能力。
func MemoryReasoningEfforts(provider *Provider, model *Model) []string {
	if provider == nil || model == nil {
		return []string{}
	}
	if provider.Protocol == "" || provider.Protocol == util.OpenAIProtocolChatCompletions ||
		util.IsOpenAIResponsesProtocol(provider.Protocol) || util.IsAnthropicMessagesProtocol(provider.Protocol) ||
		util.IsGeminiInteractionsProtocol(provider.Protocol) {
		return []string{"none", "low", "medium", "high", "xhigh", "max"}
	}
	return []string{}
}

// ValidateMemoryModel 在维护任务开始和提交前调用，不阻止无模型的读取、停用或撤回。
func (ai *AI) ValidateMemoryModel() error {
	provider, model, err := ai.GetMemoryModel()
	if err != nil {
		return err
	}
	if ai.Memory.ReasoningEffort != "" && !slices.Contains(MemoryReasoningEfforts(provider, model), ai.Memory.ReasoningEffort) {
		return errors.New("unsupported memory reasoning effort")
	}
	return nil
}
