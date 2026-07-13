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
	Name:        "frontend",
	Description: "Frontend/UI actions in the SiYuan editor (run in the browser; may change what the user sees). Actions: open_setting(query?), focus_block(id), open_document(id), open_search(query?). Plugins may register more — see <plugin_actions> and invoke by full name (e.g. plugin__myplugin__myaction).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation"},
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

func frontendHandler(args map[string]any) (CallToolResult, error) {
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "frontend actions are only available in the interactive agent chat (not via direct tool invocation)"}},
		IsError: true,
	}, nil
}
