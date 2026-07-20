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

package tools

import (
	"fmt"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var SkillTool = &Tool{
	Name:        "skill",
	Description: "Skill operations: load(name), save(name, content), install(url), remove(name), rename(name, new_name), list().\n\n" + skillListDesc(),
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation", Enum: []string{"load", "save", "install", "remove", "rename", "list"}},
			"name":     {Type: "string", Description: "Skill name (directory name)"},
			"content":  {Type: "string", Description: "SKILL.md full content with YAML frontmatter (for save)"},
			"url":      {Type: "string", Description: "Skill source for install: 'owner/repo' shorthand (e.g. Tencent/WeChatReading), a full GitHub URL, a raw SKILL.md URL, or a release zip URL"},
			"new_name": {Type: "string", Description: "New skill name (for rename)"},
		},
		Required: []string{"action"},
	},
	EffectScope: EffectScopeLocal,
	ActionEffects: map[string]ToolEffects{
		"":        {LocalRead: true},
		"load":    {LocalRead: true},
		"save":    {LocalWrite: true},
		"install": {LocalWrite: true},
		"remove":  {LocalWrite: true},
		"rename":  {LocalWrite: true},
		"list":    {LocalRead: true},
	},
	Handler: skillHandler,
}

func init() {
	register(SkillTool)
}

func skillHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "load", "":
		return skillLoad(args)
	case "save":
		return skillSave(args)
	case "install":
		return skillInstall(args)
	case "remove":
		return skillRemove(args)
	case "rename":
		return skillRename(args)
	case "list":
		return skillList(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [load, save, install, remove, rename, list]"}},
		IsError: true,
	}, nil
}

func skillLoad(args map[string]any) (CallToolResult, error) {
	name, _ := args["name"].(string)
	if name == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "skill name is required"}},
			IsError: true,
		}, nil
	}

	content := util.LoadSkillContent(name)
	if content == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("skill not found: %s", name)}},
			IsError: true,
		}, nil
	}

	// 变量（非敏感）在技能正文注入对话时解析，让 LLM 看到实际值；密钥不进上下文。
	content = model.Conf.Variables.Resolve(content)

	result := "<skill_content name=\"" + name + "\">\n\n" + content + "\n\n</skill_content>"
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: result}},
	}, nil
}

func skillSave(args map[string]any) (CallToolResult, error) {
	name, _ := args["name"].(string)
	if name == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "skill name is required"}},
			IsError: true,
		}, nil
	}
	content, _ := args["content"].(string)
	if content == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "skill content is required"}},
			IsError: true,
		}, nil
	}

	if err := util.SaveSkill(name, content); err != nil {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: err.Error()}},
			IsError: true,
		}, nil
	}

	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "skill saved: " + name}},
	}, nil
}

func skillInstall(args map[string]any) (CallToolResult, error) {
	rawURL, _ := args["url"].(string)
	if rawURL == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "url is required for install (owner/repo shorthand, GitHub URL, raw SKILL.md URL, or release zip URL)"}},
			IsError: true,
		}, nil
	}

	result, err := util.InstallSkill(rawURL)
	if err != nil {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "install failed: " + err.Error()}},
			IsError: true,
		}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("installed %d skill(s):\n", len(result.Names)))
	for i, name := range result.Names {
		desc := ""
		if i < len(result.Descriptions) {
			desc = result.Descriptions[i]
		}
		sb.WriteString("- **" + name + "**: " + desc + "\n")
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: sb.String()}},
	}, nil
}

func skillRemove(args map[string]any) (CallToolResult, error) {
	name, _ := args["name"].(string)
	if name == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "skill name is required"}},
			IsError: true,
		}, nil
	}

	if err := util.RemoveSkill(name); err != nil {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: err.Error()}},
			IsError: true,
		}, nil
	}

	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "skill removed: " + name}},
	}, nil
}

func skillRename(args map[string]any) (CallToolResult, error) {
	name, _ := args["name"].(string)
	if name == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "skill name is required"}},
			IsError: true,
		}, nil
	}
	newName, _ := args["new_name"].(string)
	if newName == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "new skill name is required"}},
			IsError: true,
		}, nil
	}

	if err := util.RenameSkill(name, newName); err != nil {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: err.Error()}},
			IsError: true,
		}, nil
	}

	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "skill renamed: " + name + " -> " + newName}},
	}, nil
}

func skillList(args map[string]any) (CallToolResult, error) {
	skills := util.DiscoverSkills()
	if len(skills) == 0 {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "no skills available"}},
		}, nil
	}

	var sb strings.Builder
	sb.WriteString("available skills:\n")
	for _, s := range skills {
		sb.WriteString("- **" + s.Name + "**: " + s.Description + "\n")
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: sb.String()}},
	}, nil
}

func skillListDesc() string {
	skills := util.DiscoverSkills()
	if len(skills) == 0 {
		return "No skills are currently available."
	}
	var sb strings.Builder
	sb.WriteString("Available skills:\n")
	for _, s := range skills {
		sb.WriteString("- **" + s.Name + "**: " + s.Description + "\n")
	}
	return sb.String()
}
