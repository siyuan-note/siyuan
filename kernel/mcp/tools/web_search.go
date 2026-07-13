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
	"github.com/siyuan-note/siyuan/kernel/util"
)

var WebSearchTool = &Tool{
	Name:        "web_search",
	Description: "Web search via Exa, returns text results. Action: query(keywords).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"query": {Type: "string", Description: "Search query keywords"},
		},
		Required: []string{"query"},
	},
	Handler: webSearchHandler,
}

func init() {
	register(WebSearchTool)
}

func webSearchHandler(args map[string]any) (CallToolResult, error) {
	query, _ := args["query"].(string)

	result, err := util.WebSearch(query, "")
	if err != nil {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "web_search error: " + err.Error()}},
			IsError: true,
		}, nil
	}

	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: result}},
	}, nil
}
