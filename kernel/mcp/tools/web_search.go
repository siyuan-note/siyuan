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
	"context"
	"fmt"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var WebSearchTool = &Tool{
	Name:           "web_search",
	Description:    "Search the web using the configured provider (Exa or DeepSeek). Returns links and summaries; use web_fetch for page content. Query is sent externally; DeepSeek charges per successful request.",
	ResolveEffects: func(string) (ToolEffects, bool) { return webToolEffects(webToolConfig().SearchProvider) },
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"query": {Type: "string", Description: "Search query keywords"},
		},
		Required: []string{"query"},
	},
	ContextHandler: webSearchHandler,
}

func init() {
	register(WebSearchTool)
}

func webSearchHandler(ctx context.Context, args map[string]any) (CallToolResult, error) {
	query, _ := args["query"].(string)

	config := webToolConfig()
	var result string
	var err error
	switch config.SearchProvider {
	case "deepseek":
		result, err = util.DeepSeekWebSearch(ctx, util.DeepSeekWebOptions{APIKey: config.APIKey, Timeout: config.Timeout}, query)
	case "exa", "":
		result, err = util.WebSearchContext(ctx, query, "", config.Timeout)
	default:
		err = fmt.Errorf("unknown web search provider: %s", config.SearchProvider)
	}
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
