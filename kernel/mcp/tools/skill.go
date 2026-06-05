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

	"github.com/siyuan-note/siyuan/kernel/model"
)

var SkillTool = &Tool{
	Name:        "skill",
	Description: "Load a specialized skill when the task at hand matches one of the skills listed in the available skills. The skill name must match one of the skills listed in the system prompt.\n- name: The skill name to load.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"name": {Type: "string", Description: "The name of the skill to load"},
		},
		Required: []string{"name"},
	},
	Handler: skillHandler,
}

func init() {
	register(SkillTool)
}

func skillHandler(args map[string]interface{}) (CallToolResult, error) {
	name, _ := args["name"].(string)
	if name == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "skill name is required"}},
			IsError: true,
		}, nil
	}

	content := model.LoadAgentSkillContent(name)
	if content == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("skill not found: %s", name)}},
			IsError: true,
		}, nil
	}

	result := "<skill_content name=\"" + name + "\">\n\n" + content + "\n\n</skill_content>"
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: result}},
	}, nil
}
