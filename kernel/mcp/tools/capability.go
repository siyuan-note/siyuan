// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import "sort"

// CapabilityManifest 描述后端能力的稳定元数据，不包含具体使用方的启用策略。
type CapabilityManifest struct {
	ID          string                     `json:"id"`
	Name        string                     `json:"name"`
	Title       string                     `json:"title,omitempty"`
	Description string                     `json:"description"`
	Source      string                     `json:"source"`
	OwnerID     string                     `json:"ownerId,omitempty"`
	OwnerName   string                     `json:"ownerName,omitempty"`
	Runtime     string                     `json:"runtime"`
	AgentOnly   bool                       `json:"agentOnly,omitempty"`
	Effects     ToolEffects                `json:"effects"`
	Available   bool                       `json:"available"`
	Actions     []CapabilityActionManifest `json:"actions,omitempty"`
}

type CapabilityActionManifest struct {
	Name    string      `json:"name"`
	Effects ToolEffects `json:"effects"`
}

// CapabilityIDForTool 返回工具的稳定能力 ID，并为未显式声明 ID 的动态工具构造回退值。
func CapabilityIDForTool(tool *Tool) string {
	if tool == nil {
		return ""
	}
	if tool.CapabilityID != "" {
		return tool.CapabilityID
	}
	source := tool.Source
	if source == "" {
		source = "native"
	}
	if tool.OwnerID != "" {
		return BuildCapabilityID(source, "backend", tool.OwnerID, tool.Name)
	}
	return BuildCapabilityID(source, "backend", tool.Name)
}

func ListCapabilityManifests() []CapabilityManifest {
	allTools := GetAllTools()
	result := make([]CapabilityManifest, 0, len(allTools))
	for _, tool := range allTools {
		source := tool.Source
		if source == "" {
			source = "native"
		}
		runtime := tool.Runtime
		if runtime == "" {
			runtime = "kernel"
		}
		effects, _ := tool.EffectsFor("")
		result = append(result, CapabilityManifest{
			ID:          CapabilityIDForTool(tool),
			Name:        tool.Name,
			Title:       tool.Title,
			Description: tool.Description,
			Source:      source,
			OwnerID:     tool.OwnerID,
			OwnerName:   tool.OwnerName,
			Runtime:     runtime,
			AgentOnly:   tool.AgentOnly,
			Effects:     effects,
			Available:   tool.IsAvailable(),
			Actions:     capabilityActionsForTool(tool),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].ID < result[j].ID
	})
	return result
}

func capabilityActionsForTool(tool *Tool) []CapabilityActionManifest {
	if tool == nil {
		return nil
	}
	names := map[string]bool{}
	if action, ok := tool.InputSchema.Properties["action"]; ok {
		for _, name := range action.Enum {
			if name != "" {
				names[name] = true
			}
		}
	}
	for name := range tool.ActionEffects {
		if name != "" {
			names[name] = true
		}
	}
	result := make([]CapabilityActionManifest, 0, len(names))
	for name := range names {
		effects, _ := tool.EffectsFor(name)
		result = append(result, CapabilityActionManifest{Name: name, Effects: effects})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result
}
