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
	Description: "Search. Actions: fulltext(query, page=1, pageSize=20, notebook?, path?, type?, subtype?, method?, orderBy?, groupBy?), semantic(query, page=1, pageSize=20, notebook?, path?, type?, subtype?) — semantic needs AI embedding configured; asset(query, page=1, pageSize=32, ext?, method?, orderBy?) — full-text search inside asset file contents (PDF/Word/Excel/txt etc.), returns matched snippets with <mark> tags; getasset(path) — get the full indexed content of one asset file by its path (e.g. 'assets/foo.pdf').",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation: fulltext, semantic, asset, or getasset", Enum: []string{"fulltext", "semantic", "asset", "getasset"}},
			"query":    {Type: "string", Description: "Search keywords (required for fulltext/semantic/asset)"},
			"page":     {Type: "number", Description: "Page number (default 1)"},
			"pageSize": {Type: "number", Description: "Results per page (default 20 for fulltext/semantic, 32 for asset)"},
			"notebook": {Type: "string", Description: "Comma-separated notebook IDs to filter (optional, fulltext/semantic only)"},
			"path":     {Type: "string", Description: "Comma-separated path prefixes to filter (optional, fulltext/semantic only); for getasset, a single asset file path like 'assets/foo.pdf'"},
			"type":     {Type: "string", Description: "Comma-separated block types to filter, e.g. 'document,heading,paragraph' (optional, fulltext/semantic only)"},
			"subtype":  {Type: "string", Description: "Comma-separated block subtypes to filter, e.g. 'o,u,t' (optional, fulltext/semantic only)"},
			"ext":      {Type: "string", Description: "Comma-separated asset file extensions to filter, e.g. 'pdf,docx,xlsx' (optional, asset only)"},
			"method":   {Type: "number", Description: "Search method: fulltext/asset 0=keyword 1=query-syntax 2=sql 3=regex (default 0)"},
			"orderBy":  {Type: "number", Description: "Sort order — fulltext: 0=type 1=created-asc 2=created-desc 3=updated-asc 4=updated-desc 5=content 6=relevance-asc 7=relevance-desc; asset: 0=relevance-desc 1=relevance-asc 2=updated-asc 3=updated-desc (default 0)"},
			"groupBy":  {Type: "number", Description: "Group by (fulltext only): 0=none 1=document (default 0)"},
		},
		Required: []string{"action"},
	},
	EffectScope: EffectScopeLocal,
	ActionEffects: map[string]ToolEffects{
		"fulltext": {LocalRead: true},
		"semantic": {LocalRead: true, DataEgress: true, ExternalCost: true},
		"asset":    {LocalRead: true},
		"getasset": {LocalRead: true},
	},
	Handler: searchHandler,
}

func init() {
	register(SearchTool)
}

func searchHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "fulltext":
		return fulltextSearch(args)
	case "semantic":
		return semanticSearch(args)
	case "asset":
		return assetSearch(args)
	case "getasset":
		return getAssetHandler(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [fulltext, semantic, asset, getasset]"}},
		IsError: true,
	}, nil
}

func fulltextSearch(args map[string]any) (CallToolResult, error) {
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

func semanticSearch(args map[string]any) (CallToolResult, error) {
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

func assetSearch(args map[string]any) (CallToolResult, error) {
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

	// ext 入参为逗号分隔的扩展名白名单，底层按 map[string]bool 接收
	extSlice := parseStringSlice(args["ext"])
	types := map[string]bool{}
	for _, e := range extSlice {
		types[e] = true
	}

	method := 0
	if v, ok := args["method"].(float64); ok {
		method = int(v)
	}
	orderBy := 0
	if v, ok := args["orderBy"].(float64); ok {
		orderBy = int(v)
	}

	assetContents, matchedAssetCount, pageCount, err := model.FullTextSearchAssetContent(query, types, method, orderBy, page, pageSize)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}

	if matchedAssetCount == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "No asset content results found."}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Found %d asset matches (page %d/%d):\n\n", matchedAssetCount, page, pageCount))
	for _, a := range assetContents {
		content := a.Content
		if len(content) > 200 {
			content = content[:200] + "..."
		}
		sb.WriteString(fmt.Sprintf("- [%s] %s\n", a.Ext, a.Name))
		sb.WriteString(fmt.Sprintf("  path: %s\n", a.Path))
		sb.WriteString(fmt.Sprintf("  size: %s\n", a.HSize))
		sb.WriteString(fmt.Sprintf("  content: %s\n", content))
		sb.WriteString(fmt.Sprintf("  id: %s\n\n", a.ID))
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: sb.String()}},
	}, nil
}

func getAssetHandler(args map[string]any) (CallToolResult, error) {
	path, _ := args["path"].(string)
	if path == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "missing required parameter 'path' (e.g. 'assets/foo.pdf')"}},
			IsError: true,
		}, nil
	}

	a := model.GetAssetContentByPath(path)
	if a == nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "No indexed content found for path: " + path + " (the file may not be indexed yet)"}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Asset: %s\n", a.Name))
	sb.WriteString(fmt.Sprintf("Ext: %s\n", a.Ext))
	sb.WriteString(fmt.Sprintf("Path: %s\n", a.Path))
	sb.WriteString(fmt.Sprintf("Size: %s\n", a.HSize))
	sb.WriteString(fmt.Sprintf("ID: %s\n", a.ID))
	sb.WriteString("\nContent:\n")
	sb.WriteString(a.Content)
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: sb.String()}},
	}, nil
}

func parseStringSlice(v any) []string {
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

func parseStringSet(v any) map[string]bool {
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
