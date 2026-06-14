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

// FrontendTool exposes UI actions (open settings, focus block, open document, open search) to
// the agent. The Handler is a fallback stub: in the agent loop, "frontend" tool calls are
// special-cased and dispatched to agent.handleFrontendTool, which streams the action to the
// browser over SSE and blocks until the browser responds. The stub exists only so that
// convertMCPToolsToOpenAI() lists this tool for the LLM.
var FrontendTool = &Tool{
	Name: "frontend",
	Description: "Frontend/UI actions in the SiYuan editor. These execute in the browser and may change what the user sees (open panels, scroll, navigate). The result tells you whether the action succeeded.\n" +
		"- open_setting: Open the settings panel. Optional: query (search keyword to filter config items and locate a specific setting).\n" +
		"- focus_block: Scroll the active editor to focus a specific block. Requires: id (block ID).\n" +
		"- open_document: Open a document by its root block ID in a new tab. Requires: id.\n" +
		"- open_search: Open the global search dialog. Optional: query (pre-filled search keyword).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"open_setting", "focus_block", "open_document", "open_search"}},
			"id":     {Type: "string", Description: "Block or document ID (for focus_block and open_document)"},
			"query":  {Type: "string", Description: "Search keyword (for open_setting to locate a config item, for open_search to pre-fill the search box)"},
		},
		Required: []string{"action"},
	},
	Handler: frontendHandler,
}

func init() {
	register(FrontendTool)
}

func frontendHandler(args map[string]interface{}) (CallToolResult, error) {
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "frontend actions are only available in the interactive agent chat (not via direct tool invocation)"}},
		IsError: true,
	}, nil
}
