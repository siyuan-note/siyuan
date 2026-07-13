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

	"github.com/88250/lute/ast"
)

// InboxTool 把收集箱（云端剪藏、消息、语音/视频/文件等）暴露给智能体，使其能够列出、阅读并把内容批量转为本地文档。
// 收集箱数据存放在思源云端，需要订阅会员；底层复用 model 层的云端 shorthand 读写函数。
var InboxTool = &Tool{
	Name:        "inbox",
	Description: "Inbox management (cloud-clipped web pages, messages, and audio/video/file attachments; requires subscription). Actions: list(page=1), get(id), convert(ids, notebook, path=/, remove_after=true) — converts one or more shorthands into local documents under the target notebook, deleting the cloud originals on success.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":       {Type: "string", Description: "Operation", Enum: []string{"list", "get", "convert"}},
			"page":         {Type: "integer", Description: "Page number for list (1-based, default 1)"},
			"id":           {Type: "string", Description: "Shorthand ID (for get)"},
			"ids":          {Type: "string", Description: "Comma-separated shorthand IDs (for convert), e.g. \"1700000000000,1700000000001\""},
			"notebook":     {Type: "string", Description: "Target notebook ID (for convert)"},
			"path":         {Type: "string", Description: "Target hPath in the notebook for the new documents (default \"/\", the notebook root). Parent path must already exist."},
			"remove_after": {Type: "boolean", Description: "Whether to delete the cloud shorthand after a successful conversion (default true)"},
		},
		Required: []string{"action"},
	},
	Handler: inboxHandler,
}

func init() {
	register(InboxTool)
}

func inboxHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "list":
		return inboxList(args)
	case "get":
		return inboxGet(args)
	case "convert":
		return inboxConvert(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [list, get, convert]"}},
		IsError: true,
	}, nil
}

// inboxList 分页列出收集箱，仅返回摘要而非正文，控制 token 开销；正文用 get 按需拉取。
func inboxList(args map[string]any) (CallToolResult, error) {
	page := 1
	if v, ok := args["page"]; ok {
		if f, ok := toInt(v); ok {
			page = f
		}
	}
	if page < 1 {
		page = 1
	}

	result, err := model.GetCloudShorthands(page)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "list inbox failed: " + err.Error()}}, IsError: true}, nil
	}

	data, _ := result["data"].(map[string]any)
	shorthands, _ := data["shorthands"].([]any)
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Inbox (page %d, %d item(s)):\n\n", page, len(shorthands)))
	for _, item := range shorthands {
		sh, _ := item.(map[string]any)
		if sh == nil {
			continue
		}
		id, _ := sh["oId"].(string)
		title, _ := sh["shorthandTitle"].(string)
		desc, _ := sh["shorthandDesc"].(string)
		url, _ := sh["shorthandURL"].(string)
		hCreated, _ := sh["hCreated"].(string)
		sb.WriteString(fmt.Sprintf("- id: %s\n  title: %s\n  created: %s", id, title, hCreated))
		if url != "" {
			sb.WriteString("\n  url: " + url)
		}
		if desc != "" {
			sb.WriteString("\n  summary: " + desc)
		}
		sb.WriteString("\n\n")
	}
	if len(shorthands) > 0 {
		sb.WriteString("Tip: if this page is full, call list again with a larger page number. Use get(id) to read a shorthand's full content before converting.")
	} else {
		sb.WriteString("Inbox is empty.")
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

// inboxGet 取单条收集箱详情，返回完整 markdown 正文（shorthandMd）。
func inboxGet(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	sh, err := model.GetCloudShorthand(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "get inbox failed: " + err.Error()}}, IsError: true}, nil
	}

	title, _ := sh["shorthandTitle"].(string)
	url, _ := sh["shorthandURL"].(string)
	hCreated, _ := sh["hCreated"].(string)
	md, _ := sh["shorthandMd"].(string)
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("id: %s\ntitle: %s\ncreated: %s\n", id, title, hCreated))
	if url != "" {
		sb.WriteString("url: " + url + "\n")
	}
	sb.WriteString("\nmarkdown:\n" + md)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

// inboxConvert 把一条或多条剪藏转为本地文档：取云端 md → 本地建文档 → 成功后清理云端原件。
// 失败的条目不会被删除，也不会中断后续条目的处理；返回逐条结果供智能体汇报与生成文档链接。
func inboxConvert(args map[string]any) (CallToolResult, error) {
	notebook, _ := args["notebook"].(string)
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}

	ids := parseShorthandIDs(args["ids"])
	if len(ids) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "ids is required"}}, IsError: true}, nil
	}

	hPath, _ := args["path"].(string)
	if hPath == "" {
		hPath = "/"
	}
	removeAfter := true
	if v, ok := args["remove_after"]; ok {
		if b, ok := toBool(v); ok {
			removeAfter = b
		}
	}

	// 解析目标父路径（与 document.create 保持一致的 hPath→fsPath 解析逻辑）。
	parentPath := "/"
	parentDir := parentDir(hPath)
	if parentDir != "/" {
		bt := treenode.GetBlockTreeRootByHPath(notebook, parentDir)
		if bt == nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "parent path not found: " + parentDir}}, IsError: true}, nil
		}
		parentPath = strings.TrimSuffix(bt.Path, ".sy")
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Converting %d shorthand(s) -> notebook %s (hPath: %s):\n\n", len(ids), notebook, hPath))

	successIDs := make([]string, 0, len(ids))
	failed := 0
	for _, id := range ids {
		sh, err := model.GetCloudShorthand(id)
		if err != nil {
			sb.WriteString(fmt.Sprintf("- [%s] FAILED: %s\n", id, err.Error()))
			failed++
			continue
		}

		title, _ := sh["shorthandTitle"].(string)
		if title == "" {
			title = "Untitled"
		}
		md, _ := sh["shorthandMd"].(string)
		// content 为空（既无 md 也无渲染正文）但有来源 URL 时，回退为 markdown 链接，与前端行为一致。
		if md == "" {
			if content, _ := sh["shorthandContent"].(string); content == "" {
				if url, _ := sh["shorthandURL"].(string); url != "" {
					md = "[" + title + "](" + url + ")"
				}
			}
		}

		docID := ast.NewNodeID()
		docPath := strings.TrimRight(parentPath, "/") + "/" + docID + ".sy"
		tree, err := model.CreateDocByMd(notebook, docPath, title, md, nil, nil)
		if err != nil {
			sb.WriteString(fmt.Sprintf("- [%s] %s -> FAILED: %s\n", id, title, err.Error()))
			failed++
			continue
		}
		successIDs = append(successIDs, id)
		sb.WriteString(fmt.Sprintf("- [%s] %s -> created %s\n", id, title, tree.Root.ID))
	}

	// 仅在全部转换成功的条目上清理云端原件；失败条目保留以便重试。
	if removeAfter && len(successIDs) > 0 {
		if err := model.RemoveCloudShorthands(successIDs); err != nil {
			sb.WriteString("\nWARNING: failed to remove cloud originals: " + err.Error())
		}
	}

	util.PushReloadFiletree()
	sb.WriteString(fmt.Sprintf("\nDone: %d succeeded, %d failed.", len(successIDs), failed))
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

// parseShorthandIDs 兼容字符串（逗号分隔）和数组两种形态的 ids 入参，去除空白与重复。
func parseShorthandIDs(v any) []string {
	if v == nil {
		return nil
	}
	raw := make([]string, 0, 4)
	switch val := v.(type) {
	case string:
		if val == "" {
			return nil
		}
		for p := range strings.SplitSeq(val, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				raw = append(raw, p)
			}
		}
	case []any:
		for _, item := range val {
			if s, ok := item.(string); ok {
				s = strings.TrimSpace(s)
				if s != "" {
					raw = append(raw, s)
				}
			}
		}
	case []string:
		for _, s := range val {
			s = strings.TrimSpace(s)
			if s != "" {
				raw = append(raw, s)
			}
		}
	}
	seen := make(map[string]bool, len(raw))
	out := raw[:0]
	for _, s := range raw {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// toInt 把 JSON 反序列化出的数字（float64）或整数类型安全地转成 int。
func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case float32:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	}
	return 0, false
}

// toBool 把 JSON 反序列化出的布尔值安全地转成 bool。
func toBool(v any) (bool, bool) {
	if b, ok := v.(bool); ok {
		return b, true
	}
	return false, false
}
