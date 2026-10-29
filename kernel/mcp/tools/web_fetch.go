// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"context"
	"fmt"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var WebFetchTool = &Tool{
	Name:           "web_fetch",
	Description:    "Fetch a public page using the configured provider (direct HTTP or DeepSeek), as markdown (default) or text. No browser session is used. DeepSeek receives the target URL, charges per successful request, and returns page content only; direct HTTP also downloads files. For client-rendered pages, use native/frontend/web_page_fetch when available in the desktop Electron app.",
	ResolveEffects: func(string) (ToolEffects, bool) { return webToolEffects(webToolConfig().FetchProvider) },
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"url":    {Type: "string", Description: "The page URL to fetch (must start with http:// or https://)"},
			"format": {Type: "string", Description: "Output format: 'markdown' or 'text' (default 'markdown')", Enum: []string{"markdown", "text"}},
		},
		Required: []string{"url"},
	},
	ContextHandler: webFetchHandler,
}

func init() {
	register(WebFetchTool)
}

func webFetchHandler(ctx context.Context, args map[string]any) (CallToolResult, error) {
	rawURL, _ := args["url"].(string)
	format, _ := args["format"].(string)
	if format == "" {
		format = "markdown"
	}

	config := webToolConfig()
	var result string
	var err error
	switch config.FetchProvider {
	case "deepseek":
		result, err = util.DeepSeekWebFetch(ctx, util.DeepSeekWebOptions{APIKey: config.APIKey, Timeout: config.Timeout}, rawURL, format)
	case "direct", "":
		result, err = util.WebFetchContext(ctx, rawURL, format, config.Timeout)
	default:
		err = fmt.Errorf("unknown web fetch provider: %s", config.FetchProvider)
	}
	if err != nil {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "web_fetch error: " + err.Error()}},
			IsError: true,
		}, nil
	}

	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: result}},
	}, nil
}
