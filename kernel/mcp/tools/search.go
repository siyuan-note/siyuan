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
)

var SearchTool = &Tool{
	Name:        "search",
	Description: "Full-text search in SiYuan notes.\n- fulltext: Search blocks by keywords. Required: query. Optional: page (default 1), pageSize (default 20).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation: fulltext", Enum: []string{"fulltext"}},
			"query":    {Type: "string", Description: "Search keywords"},
			"page":     {Type: "number", Description: "Page number (default 1)"},
			"pageSize": {Type: "number", Description: "Results per page (default 20)"},
		},
		Required: []string{"action", "query"},
	},
	Handler: searchHandler,
}

func init() {
	register(SearchTool)
}

func searchHandler(args map[string]interface{}) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "fulltext":
		return fulltextSearch(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action: " + action}},
		IsError: true,
	}, nil
}

func fulltextSearch(args map[string]interface{}) (CallToolResult, error) {
	query, _ := args["query"].(string)
	page := 1
	if v, ok := args["page"].(float64); ok {
		page = int(v)
	}
	pageSize := 20
	if v, ok := args["pageSize"].(float64); ok {
		pageSize = int(v)
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}

	blocks, matchedCount, _, pageCount, _ := model.FullTextSearchBlock(
		query, nil, nil, nil, nil, 0, 0, 0, page, pageSize,
	)

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Found %d results (page %d/%d):\n\n", matchedCount, page, pageCount))
	for _, b := range blocks {
		hPath := b.HPath
		if hPath == "" {
			hPath = "/"
		}
		content := b.Markdown
		if content == "" {
			content = b.Content
		}
		if len(content) > 200 {
			content = content[:200] + "..."
		}
		sb.WriteString(fmt.Sprintf("- [%s] %s\n  %s\n  id: %s\n\n", hPath, b.Type, content, b.ID))
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: sb.String()}},
	}, nil
}
