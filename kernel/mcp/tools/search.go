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
	Description: "Search. Actions: fulltext(query, page=1, pageSize=20, notebook?, path?, type?, subtype?, method?, orderBy?, groupBy?), semantic(query, page=1, pageSize=20, notebook?, path?, type?, subtype?) — semantic needs AI embedding configured.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation: fulltext or semantic", Enum: []string{"fulltext", "semantic"}},
			"query":    {Type: "string", Description: "Search keywords"},
			"page":     {Type: "number", Description: "Page number (default 1)"},
			"pageSize": {Type: "number", Description: "Results per page (default 20)"},
			"notebook": {Type: "string", Description: "Comma-separated notebook IDs to filter (optional)"},
			"path":     {Type: "string", Description: "Comma-separated path prefixes to filter (optional)"},
			"type":     {Type: "string", Description: "Comma-separated block types to filter, e.g. 'document,heading,paragraph' (optional)"},
			"subtype":  {Type: "string", Description: "Comma-separated block subtypes to filter, e.g. 'o,u,t' (optional)"},
			"method":   {Type: "number", Description: "Search method (fulltext only): 0=keyword 1=query-syntax 2=sql 3=regex (default 0)"},
			"orderBy":  {Type: "number", Description: "Sort order (fulltext only): 0=type 1=created-asc 2=created-desc 3=updated-asc 4=updated-desc 5=content 6=relevance-asc 7=relevance-desc (default 0)"},
			"groupBy":  {Type: "number", Description: "Group by (fulltext only): 0=none 1=document (default 0)"},
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
	case "semantic":
		return semanticSearch(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [fulltext, semantic]"}},
		IsError: true,
	}, nil
}

func fulltextSearch(args map[string]interface{}) (CallToolResult, error) {
	query, _ := args["query"].(string)
	page := 1
	if v, ok := args["page"].(float64); ok {
		page = int(v)
	}
	pageSize := 32
	if v, ok := args["pageSize"].(float64); ok {
		pageSize = int(v)
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 32
	}

	notebooks := parseStringSlice(args["notebook"])
	paths := parseStringSlice(args["path"])
	types := parseStringSet(args["type"])
	subtypes := parseStringSet(args["subtype"])
	method := 0
	if v, ok := args["method"].(float64); ok {
		method = int(v)
	}
	orderBy := 0
	if v, ok := args["orderBy"].(float64); ok {
		orderBy = int(v)
	}
	groupBy := 0
	if v, ok := args["groupBy"].(float64); ok {
		groupBy = int(v)
	}

	blocks, matchedCount, matchedRootCount, pageCount, docMode := model.FullTextSearchBlock(
		query, notebooks, paths, types, subtypes, method, orderBy, groupBy, page, pageSize,
	)

	if matchedCount == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "No results found."}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Found %d results (page %d/%d):\n\n", matchedCount, page, pageCount))
	for _, b := range blocks {
		content := b.Markdown
		if content == "" {
			content = b.Content
		}
		if len(content) > 200 {
			content = content[:200] + "..."
		}
		sb.WriteString(fmt.Sprintf("- [%s] %s\n  %s\n  id: %s\n\n", b.HPath, b.Type, content, b.ID))
	}
	if docMode {
		sb.WriteString(fmt.Sprintf("(grouped by document, %d documents matched)\n", matchedRootCount))
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: sb.String()}},
	}, nil
}

func semanticSearch(args map[string]interface{}) (CallToolResult, error) {
	query, _ := args["query"].(string)
	page := 1
	if v, ok := args["page"].(float64); ok {
		page = int(v)
	}
	pageSize := 32
	if v, ok := args["pageSize"].(float64); ok {
		pageSize = int(v)
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 32
	}

	notebooks := parseStringSlice(args["notebook"])
	paths := parseStringSlice(args["path"])
	types := parseStringSet(args["type"])
	subtypes := parseStringSet(args["subtype"])

	blocks, matchedCount, matchedRootCount, pageCount := model.SemanticSearchBlock(
		query, notebooks, paths, types, subtypes, page, pageSize,
	)

	if matchedCount == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "No semantic search results. Make sure AI embedding is configured in SiYuan settings."}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Found %d semantic results (page %d/%d):\n\n", matchedCount, page, pageCount))
	for _, b := range blocks {
		content := b.Markdown
		if content == "" {
			content = b.Content
		}
		if len(content) > 200 {
			content = content[:200] + "..."
		}
		sb.WriteString(fmt.Sprintf("- [%s] %s\n  %s\n  id: %s\n\n", b.HPath, b.Type, content, b.ID))
	}
	if matchedRootCount > 0 {
		sb.WriteString(fmt.Sprintf("(%d documents matched)\n", matchedRootCount))
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: sb.String()}},
	}, nil
}

func parseStringSlice(v interface{}) []string {
	s, ok := v.(string)
	if !ok || s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	var result []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func parseStringSet(v interface{}) map[string]bool {
	slice := parseStringSlice(v)
	if len(slice) == 0 {
		return nil
	}
	m := make(map[string]bool)
	for _, s := range slice {
		m[s] = true
	}
	return m
}
