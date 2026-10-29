// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"context"
	"fmt"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var WebSearchTool = &Tool{
	Name:        "web_search",
	Description: "Search the web using the configured provider (Exa or DeepSeek). Returns links and summaries; use web_fetch for page content. Query is sent externally; authenticated Exa and DeepSeek requests may incur charges.",
	ResolveEffects: func(string) (ToolEffects, bool) {
		config := webToolConfig()
		if (config.SearchProvider == "exa" || config.SearchProvider == "") && config.ExaAPIKey != "" {
			return ToolEffects{DataEgress: true, ExternalCost: true}, true
		}
		return webToolEffects(config.SearchProvider)
	},
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

var exaWebSearch = util.WebSearchContext

func webSearchHandler(ctx context.Context, args map[string]any) (CallToolResult, error) {
	query, _ := args["query"].(string)

	config := webToolConfig()
	var result string
	var err error
	switch config.SearchProvider {
	case "deepseek":
		result, err = util.DeepSeekWebSearch(ctx, util.DeepSeekWebOptions{APIKey: config.APIKey, Timeout: config.Timeout}, query)
	case "exa", "":
		result, err = exaWebSearch(ctx, query, config.ExaAPIKey, config.Timeout)
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
