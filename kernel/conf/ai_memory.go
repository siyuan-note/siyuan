// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"errors"
	"slices"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// Memory 将使用、自动维护和模型选择分开；来源仅表示用户授权，不替代运行时权限检查。
type Memory struct {
	Enabled         bool     `json:"enabled"`
	AutoMaintain    bool     `json:"autoMaintain"`
	Conversations   bool     `json:"conversations"`
	ModelID         string   `json:"modelId"`
	ReasoningEffort string   `json:"reasoningEffort"`
	Sources         []string `json:"sources"`
}

func defaultMemory() *Memory { return &Memory{Sources: []string{}} }

// Normalize 不清除失效的模型引用或推理选项，以便界面展示并要求用户修正。
func (memory *Memory) Normalize() {
	memory.ModelID = strings.TrimSpace(memory.ModelID)
	memory.ReasoningEffort = strings.ToLower(strings.TrimSpace(memory.ReasoningEffort))
	sources := []string{}
	for _, source := range memory.Sources {
		source = strings.TrimSpace(source)
		if source != "" && !slices.Contains(sources, source) {
			sources = append(sources, source)
		}
	}
	memory.Sources = sources
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

// MemoryReasoningEfforts 仅返回已知模型族与已实现协议共同支持的保守交集，不包含默认空值。
// 未识别的自定义名称不推断能力，调用方仍可使用其默认推理配置。
func MemoryReasoningEfforts(provider *Provider, model *Model) []string {
	if provider == nil || model == nil {
		return []string{}
	}
	name := strings.ToLower(model.Name)
	if util.IsAnthropicMessagesProtocol(provider.Protocol) {
		for _, prefix := range []string{"claude-3-7-sonnet", "claude-sonnet-4", "claude-opus-4", "claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5", "claude-opus-4-1", "claude-opus-4-6", "claude-sonnet-4-6"} {
			if memoryModelNameMatches(name, prefix) {
				return []string{"low", "medium", "high"}
			}
		}
		return []string{}
	}
	if util.IsGeminiInteractionsProtocol(provider.Protocol) {
		if slices.Contains([]string{"gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-3.1-pro-preview"}, name) {
			return []string{"low", "high"}
		}
		return []string{}
	}
	if provider.Protocol == "" || provider.Protocol == util.OpenAIProtocolChatCompletions || provider.Protocol == util.OpenAIProtocolResponses {
		if strings.Contains(name, "-pro") || strings.Contains(name, "-chat") {
			return []string{}
		}
		for _, prefix := range []string{"o1", "o3", "o3-mini", "o4-mini", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.1", "gpt-5.2", "gpt-5.4", "gpt-5.5", "gpt-6", "gpt-6.1"} {
			if memoryModelNameMatches(name, prefix) {
				return []string{"low", "medium", "high"}
			}
		}
	}
	return []string{}
}

// memoryModelNameMatches 仅接受明确名称或其纯数字日期快照，避免把自定义后缀当作已知能力。
func memoryModelNameMatches(name, base string) bool {
	if name == base {
		return true
	}
	if !strings.HasPrefix(name, base+"-") {
		return false
	}
	suffix := strings.ReplaceAll(strings.TrimPrefix(name, base+"-"), "-", "")
	if len(suffix) != 8 {
		return false
	}
	for _, char := range suffix {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
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
	for _, source := range ai.Memory.Sources {
		if !ast.IsNodeIDPattern(source) {
			return errors.New("invalid memory source notebook ID")
		}
	}
	return nil
}
