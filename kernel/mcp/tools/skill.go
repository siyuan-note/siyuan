// SiYuan - From thought to insight, with agents
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
	"html"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var SkillTool = &Tool{
	Name:        "skill",
	Description: "Skill operations: load(name) loads Skill instructions; load(name/resource-path) loads a bundled text resource; save(name, content), install(url), remove(name), rename(name, new_name), list().\n\n" + skillListDesc(),
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"load", "save", "install", "remove", "rename", "list"}},
			"name": {
				Type:        "string",
				Description: "Skill name. For load, use <skill-name> for instructions or <skill-name>/<relative-resource-path> for a bundled text resource",
			},
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

	loaded, err := util.LoadSkill(name, model.EnabledUserSkills())
	if err != nil {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: err.Error()}},
			IsError: true,
		}, nil
	}

	var result string
	if loaded.ResourcePath == "" {
		// Variables.Resolve 还会匹配 $NAME 和 ${NAME}。
		// 资源可能包含脚本或模板，因此只解析技能正文，避免误改资源内容。
		loaded.Content = model.Conf.Variables.Resolve(loaded.Content)
		result = formatSkillContent(loaded)
	} else {
		result = formatSkillResource(loaded)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: result}},
	}, nil
}

func formatSkillContent(loaded *util.SkillLoadResult) string {
	var sb strings.Builder
	sb.WriteString(`<skill_content name="`)
	sb.WriteString(html.EscapeString(loaded.Name))
	sb.WriteString("\">\n\n")
	sb.WriteString(loaded.Content)

	if len(loaded.Resources) > 0 || loaded.ResourcesTruncated {
		sb.WriteString("\n\n<skill_resources")
		if loaded.ResourcesTruncated {
			sb.WriteString(` truncated="true"`)
		}
		sb.WriteString(">\n")
		for _, resource := range loaded.Resources {
			sb.WriteString("  <file>")
			sb.WriteString(html.EscapeString(resource))
			sb.WriteString("</file>\n")
		}
		sb.WriteString("</skill_resources>")
	}

	if location := workspaceSkillLocation(loaded.SkillDir); location != "" {
		sb.WriteString("\n\n<skill_location path=\"")
		sb.WriteString(html.EscapeString(location))
		sb.WriteString("\">\n")
		sb.WriteString("  For this skill directory, use the `file` tool's read-only actions: `read`, `list`, `grep`, and `find`.\n")
		sb.WriteString("</skill_location>")
	}

	sb.WriteString("\n\n</skill_content>")
	return sb.String()
}

func formatSkillResource(loaded *util.SkillLoadResult) string {
	return `<skill_resource skill="` + html.EscapeString(loaded.Name) + `" path="` +
		html.EscapeString(loaded.ResourcePath) + "\">\n\n" + loaded.Content + "\n\n</skill_resource>"
}

func workspaceSkillLocation(skillDir string) string {
	location, err := filepath.Rel(util.WorkspaceDir, skillDir)
	if err != nil {
		return ""
	}
	location = filepath.ToSlash(location)
	if _, err = resolvePath(location); err != nil {
		return ""
	}
	return location
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
	skills := util.DiscoverSkills(model.EnabledUserSkills())
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
	skills := util.DiscoverSkills(model.EnabledUserSkills())
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
