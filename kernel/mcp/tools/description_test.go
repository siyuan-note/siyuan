// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"strings"
	"testing"
	"time"
)

func TestToolDescriptionsExplainOverlappingOperations(t *testing.T) {
	for _, tc := range []struct {
		tool *Tool
		want []string
	}{
		{DocumentTool, []string{"block.get", "block.get_kramdown", "export", "search_docs", "title", "notebook names", "name/alias/memo", "search.fulltext", "sql.query", "128 visible direct child", "truncation"}},
		{BlockTool, []string{"document", "sql.query", "export", "scope checks"}},
		{ExportTool, []string{"block.get/get_kramdown", "md/html/preview return text", "Only docx uses output"}},
		{SystemTool, []string{"workspace.info", "workspace.list", "RFC3339"}},
		{WorkspaceTool, []string{"system.workspace", "validity", "container"}},
		{HistoryTool, []string{"repo.file_get/file_open", "history paths", "repository file IDs", "entire document", "overwriting its current content", "not an individual block"}},
		{RepoTool, []string{"history", "history paths", "repository file IDs"}},
		{AssetTool, []string{"Document attachment", "asset rather than file"}},
		{AttrTool, []string{"replace", "read its current attributes first", "each target document", "tag.rename/remove", "Inline body tags"}},
		{TagTool, []string{"across the workspace", "attr.get/set", "inline body tags"}},
		{TemplateTool, []string{"Markdown", "snippet", "CSS/JS"}},
		{SnippetTool, []string{"template", "Markdown"}},
		{DailynoteTool, []string{"append/prepend create today's note automatically", "no preliminary create"}},
	} {
		t.Run(tc.tool.Name, func(t *testing.T) {
			for _, want := range tc.want {
				if !strings.Contains(tc.tool.Description, want) {
					t.Errorf("description is missing %q", want)
				}
			}
		})
	}
	if !strings.Contains(sqlSchemaGuide, "document.search_docs for document discovery") {
		t.Fatal("SQL guide must distinguish document-title search")
	}
}

func TestToolParameterDescriptionsMatchHandlers(t *testing.T) {
	workflow := QuestionTool.InputSchema.Properties["workflow"]
	for _, tc := range []struct {
		name        string
		description string
		want        []string
	}{
		{"export.output", ExportTool.InputSchema.Properties["output"].Description, []string{"directory", "only for docx", "ignored", "absolute", "working directory", "filename"}},
		{"http_request.headers", HTTPRequestTool.InputSchema.Properties["headers"].Description, []string{"strings, numbers or booleans", "Null, arrays and nested objects", "entire request"}},
		{"bazaar.frontend", BazaarTool.InputSchema.Properties["frontend"].Description, []string{"desktop-window", "browser-mobile", "compatibility", "not the kernel host"}},
		{"image.detail", ImageTool.InputSchema.Properties["detail"].Description, []string{"analyze only", "auto", "low", "high", "Omitted defaults to auto", "provider"}},
		{"repo.id", RepoTool.InputSchema.Properties["id"].Description, []string{"Snapshot ID from list", "repository file ID from search or diff", "not interchangeable"}},
		{"question.workflow.action", workflow.Properties["action"].Description, []string{"recover", "recovery-only", "restore_project", "prepare_project", "cancel", "revokes approvals", "without rolling back", "None authorize installation"}},
		{"question.workflow.taskId", workflow.Properties["taskId"].Description, []string{"plan/recover/cancel"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, want := range tc.want {
				if !strings.Contains(tc.description, want) {
					t.Errorf("description is missing %q", want)
				}
			}
		})
	}
}

func TestSystemCurrentTimeMatchesDocumentedFormat(t *testing.T) {
	result, err := systemCurrentTime(nil)
	if err != nil || result.IsError || len(result.Content) != 1 {
		t.Fatalf("unexpected current_time result: %+v, %v", result, err)
	}
	if _, err = time.Parse(time.RFC3339, result.Content[0].Text); err != nil {
		t.Fatalf("current_time does not match its documented format: %v", err)
	}
}
