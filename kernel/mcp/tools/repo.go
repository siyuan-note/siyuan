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
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var RepoTool = &Tool{
	Name:        "repo",
	Description: "Repository (data snapshot) operations. Actions: list(tag?, page=1), create(memo?), tag(id, name), untag(name), checkout(id), diff(left, right), search(keyword, page?), purge(), file_get(id), file_rollback(id), file_open(id), file_export(id).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":  {Type: "string", Description: "Operation", Enum: []string{"list", "create", "tag", "untag", "checkout", "diff", "search", "purge", "file_get", "file_rollback", "file_open", "file_export"}},
			"id":      {Type: "string", Description: "Snapshot ID (for tag, checkout, file_get, file_rollback, file_open, file_export)"},
			"name":    {Type: "string", Description: "Tag name (for tag, untag)"},
			"memo":    {Type: "string", Description: "Snapshot memo (for create, optional)"},
			"keyword": {Type: "string", Description: "Search keyword (for search)"},
			"left":    {Type: "string", Description: "Left snapshot ID (for diff)"},
			"right":   {Type: "string", Description: "Right snapshot ID (for diff)"},
			"tag":     {Type: "boolean", Description: "List tagged snapshots only (for list, optional)"},
			"page":    {Type: "number", Description: "Page number (for list, search; default 1)"},
		},
		Required: []string{"action"},
	},
	Handler: repoHandler,
}

func init() {
	register(RepoTool)
}

func repoHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "list":
		return repoList(args)
	case "create":
		return repoCreate(args)
	case "tag":
		return repoTag(args)
	case "untag":
		return repoUntag(args)
	case "checkout":
		return repoCheckout(args)
	case "diff":
		return repoDiff(args)
	case "search":
		return repoSearch(args)
	case "purge":
		return repoPurge(args)
	case "file_get":
		return repoFileGet(args)
	case "file_rollback":
		return repoFileRollback(args)
	case "file_open":
		return repoFileOpen(args)
	case "file_export":
		return repoFileExport(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [list, create, tag, untag, checkout, diff, search, purge, file_get, file_rollback, file_open, file_export]"}},
		IsError: true,
	}, nil
}

func repoList(args map[string]any) (CallToolResult, error) {
	tagged := false
	if v, ok := args["tag"].(bool); ok {
		tagged = v
	}
	page := 1
	if v, ok := args["page"].(float64); ok {
		page = int(v)
	}
	if page < 1 {
		page = 1
	}

	if tagged {
		snapshots, err := model.GetTagSnapshots()
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "get tagged snapshots failed: " + err.Error()}}, IsError: true}, nil
		}
		if len(snapshots) == 0 {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no tagged snapshots found"}}}, nil
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Tagged snapshots (%d):\n\n", len(snapshots)))
		for _, s := range snapshots {
			sb.WriteString(fmt.Sprintf("- %s (memo: %s)\n", s.ID, s.Memo))
		}
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
	}

	snapshots, pageCount, totalCount, err := model.GetRepoSnapshots(page)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "get snapshots failed: " + err.Error()}}, IsError: true}, nil
	}
	if len(snapshots) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no snapshots found"}}}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Snapshots (page %d/%d, %d total):\n\n", page, pageCount, totalCount))
	for _, s := range snapshots {
		sb.WriteString(fmt.Sprintf("- %s (memo: %s)\n", s.ID, s.Memo))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func repoCreate(args map[string]any) (CallToolResult, error) {
	memo, _ := args["memo"].(string)
	id, err := model.IndexRepo(memo)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "create snapshot failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "snapshot created: " + id}}}, nil
}

func repoTag(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	name, _ := args["name"].(string)
	if id == "" || name == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id and name are required"}}, IsError: true}, nil
	}
	if err := model.TagSnapshot(id, name); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "tag snapshot failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("tagged snapshot %s with '%s'", id, name)}}}, nil
}

func repoUntag(args map[string]any) (CallToolResult, error) {
	name, _ := args["name"].(string)
	if name == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "name is required"}}, IsError: true}, nil
	}
	if err := model.RemoveTagSnapshot(name); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "remove tag failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "tag removed: " + name}}}, nil
}

func repoCheckout(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	model.CheckoutRepoDirect(id)
	util.PushReloadFiletree()
	util.ReloadUI()
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "checkout to snapshot: " + id}}}, nil
}

func repoDiff(args map[string]any) (CallToolResult, error) {
	left, _ := args["left"].(string)
	right, _ := args["right"].(string)
	if left == "" || right == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "left and right are required"}}, IsError: true}, nil
	}
	diff, err := model.DiffRepoSnapshots(left, right)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "diff failed: " + err.Error()}}, IsError: true}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Diff between %s and %s:\n\n", left, right))
	if len(diff.AddsLeft) > 0 {
		sb.WriteString(fmt.Sprintf("Adds (%d):\n", len(diff.AddsLeft)))
		for _, f := range diff.AddsLeft {
			sb.WriteString(fmt.Sprintf("- [%s] %s (%s)\n", f.FileID, f.Title, f.Path))
		}
	}
	if len(diff.UpdatesLeft) > 0 {
		sb.WriteString(fmt.Sprintf("\nUpdates (%d):\n", len(diff.UpdatesLeft)))
		for _, f := range diff.UpdatesLeft {
			sb.WriteString(fmt.Sprintf("- [%s] %s (%s)\n", f.FileID, f.Title, f.Path))
		}
	}
	if len(diff.RemovesRight) > 0 {
		sb.WriteString(fmt.Sprintf("\nRemoves (%d):\n", len(diff.RemovesRight)))
		for _, f := range diff.RemovesRight {
			sb.WriteString(fmt.Sprintf("- [%s] %s (%s)\n", f.FileID, f.Title, f.Path))
		}
	}
	if len(diff.AddsLeft) == 0 && len(diff.UpdatesLeft) == 0 && len(diff.RemovesRight) == 0 {
		sb.WriteString("no differences found")
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func repoSearch(args map[string]any) (CallToolResult, error) {
	keyword, _ := args["keyword"].(string)
	if keyword == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "keyword is required"}}, IsError: true}, nil
	}
	page := 1
	if v, ok := args["page"].(float64); ok {
		page = int(v)
	}
	if page < 1 {
		page = 1
	}
	files, pageCount, totalCount, err := model.SearchRepoFile(keyword, page)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "search repo failed: " + err.Error()}}, IsError: true}, nil
	}
	if len(files) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no files found"}}}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Files matching '%s' (page %d/%d, %d total):\n\n", keyword, page, pageCount, totalCount))
	for _, f := range files {
		sb.WriteString(fmt.Sprintf("- [%s] %s (%s)\n", f.FileID, f.Title, f.Path))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func repoPurge(args map[string]any) (CallToolResult, error) {
	if err := model.PurgeRepo(); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "purge failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "old snapshots purged"}}}, nil
}

func repoFileGet(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	data, path, err := model.GetRepoFile(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "get repo file failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("Path: %s\nSize: %d\n---\n%s", path, len(data), string(data))}}}, nil
}

func repoFileRollback(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	if err := model.RollbackRepoSnapshotFile(id); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "rollback repo file failed: " + err.Error()}}, IsError: true}, nil
	}
	if bt := treenode.GetBlockTree(id); bt != nil {
		util.PushReloadProtyle(bt.RootID)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "file rolled back: " + id}}}, nil
}

func repoFileOpen(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	title, content, _, _, err := model.OpenRepoSnapshotFile(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "open repo file failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("Title: %s\n---\n%s", title, content)}}}, nil
}

func repoFileExport(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	exportPath, err := model.ExportRepoFile(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "export repo file failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("exported to: %s", exportPath)}}}, nil
}
