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

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var DocumentTool = &Tool{
	Name:        "document",
	Description: "Document operations. Actions: get(id), create(notebook, path=hPath, title, markdown?), list(notebook, path=hPath default /), delete(id), rename(id, title), move(id, notebook, path=target hPath), duplicate(id), search_docs(keyword), info(id).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation", Enum: []string{"get", "create", "list", "delete", "rename", "move", "duplicate", "search_docs", "info"}},
			"id":       {Type: "string", Description: "Document block ID"},
			"title":    {Type: "string", Description: "Document title (for create, rename)"},
			"path":     {Type: "string", Description: "Document hPath, the human-readable path shown in the document tree (e.g. /folder/doc). Used for create, list, move."},
			"markdown": {Type: "string", Description: "Initial markdown content (for create)"},
			"keyword":  {Type: "string", Description: "Search keyword (for search_docs)"},
			"notebook": {Type: "string", Description: "Notebook ID (required for create, list, move)"},
		},
		Required: []string{"action"},
	},
	Handler: documentHandler,
}

func init() {
	register(DocumentTool)
}

func documentHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "get":
		return documentGet(args)
	case "create":
		return documentCreate(args)
	case "list":
		return documentList(args)
	case "delete":
		return documentDelete(args)
	case "rename":
		return documentRename(args)
	case "move":
		return documentMove(args)
	case "duplicate":
		return documentDuplicate(args)
	case "search_docs":
		return documentSearchDocs(args)
	case "info":
		return documentInfo(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [get, create, list, delete, rename, move, duplicate, search_docs, info]"}},
		IsError: true,
	}, nil
}

func documentGet(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("load doc failed: %s", err)}}, IsError: true}, nil
	}

	b, _ := model.GetBlock(id, tree)
	if b == nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "document not found: " + id}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf(
		"ID: %s\nTitle: %s\nHPath: %s\nBox: %s\nContent: %s\nMarkdown: %s\nType: %s\nCreated: %s\nUpdated: %s",
		b.ID, b.Name, b.HPath, b.Box, b.Content, b.Markdown, b.Type, b.Created, b.Updated,
	)}}}, nil
}

func documentCreate(args map[string]any) (CallToolResult, error) {
	notebook, _ := args["notebook"].(string)
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}
	hPath, _ := args["path"].(string)
	if hPath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}
	markdown, _ := args["markdown"].(string)
	title, _ := args["title"].(string)
	if title == "" {
		title = hPath
		if strings.Contains(title, "/") {
			parts := strings.Split(strings.TrimRight(title, "/"), "/")
			title = parts[len(parts)-1]
		}
	}

	parentPath := "/"
	parentDir := parentDir(hPath)
	if parentDir != "/" {
		bt := treenode.GetBlockTreeRootByHPath(notebook, parentDir)
		if bt == nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "parent path not found: " + parentDir}}, IsError: true}, nil
		}
		parentPath = strings.TrimSuffix(bt.Path, ".sy")
	}

	id := ast.NewNodeID()
	docPath := strings.TrimRight(parentPath, "/") + "/" + id + ".sy"
	tree, err := model.CreateDocByMd(notebook, docPath, title, markdown, nil, nil)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("create doc failed: %s", err)}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("document created: %s (hPath: %s)", tree.Root.ID, hPath)}}}, nil
}

func parentDir(p string) string {
	i := strings.LastIndex(p, "/")
	if i <= 0 {
		return "/"
	}
	return p[:i]
}

func documentList(args map[string]any) (CallToolResult, error) {
	notebook, _ := args["notebook"].(string)
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}
	hPath, _ := args["path"].(string)
	if hPath == "" {
		hPath = "/"
	}

	fsPath := hPath
	if hPath != "/" {
		bt := treenode.GetBlockTreeRootByHPath(notebook, hPath)
		if bt == nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "target path not found: " + hPath}}, IsError: true}, nil
		}
		fsPath = bt.Path
	}

	files, _, err := model.ListDocTree(notebook, fsPath, 0, false, false, 128)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("list docs failed: %s", err)}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Documents in %s (hPath: %s):\n\n", notebook, hPath))
	for _, f := range files {
		sb.WriteString(fmt.Sprintf("- %s (id: %s, hPath: %s)\n", f.Name, f.ID, strings.TrimRight(hPath, "/")+"/"+f.Name))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func documentDelete(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("load doc failed: %s", err)}}, IsError: true}, nil
	}

	if err = model.RemoveDoc(tree.Box, tree.Path); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("delete doc failed: %s", err)}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "document deleted: " + id}}}, nil
}

func documentRename(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	title, _ := args["title"].(string)
	if id == "" || title == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id and title are required"}}, IsError: true}, nil
	}

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("load doc failed: %s", err)}}, IsError: true}, nil
	}

	if err := model.RenameDoc(tree.Box, tree.Path, title); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("rename doc failed: %s", err)}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("document renamed: %s -> %s", id, title)}}}, nil
}

func documentMove(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	notebook, _ := args["notebook"].(string)
	hPath, _ := args["path"].(string)
	if id == "" || notebook == "" || hPath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id, notebook and path are required"}}, IsError: true}, nil
	}

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("load doc failed: %s", err)}}, IsError: true}, nil
	}

	fsPath := hPath
	if hPath != "/" {
		bt := treenode.GetBlockTreeRootByHPath(notebook, hPath)
		if bt == nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "target path not found: " + hPath}}, IsError: true}, nil
		}
		fsPath = bt.Path
	}

	if err := model.MoveDocs([]string{tree.Path}, notebook, fsPath, nil); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("move doc failed: %s", err)}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("document moved: %s -> %s (hPath: %s)", id, notebook, hPath)}}}, nil
}

func documentDuplicate(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("load doc failed: %s", err)}}, IsError: true}, nil
	}

	model.DuplicateDoc(tree)
	util.PushReloadFiletree()
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "document duplicated: " + id}}}, nil
}

func documentSearchDocs(args map[string]any) (CallToolResult, error) {
	keyword, _ := args["keyword"].(string)
	if keyword == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "keyword is required"}}, IsError: true}, nil
	}

	docs := model.SearchDocs(keyword, false, nil)
	if len(docs) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no documents found"}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Documents matching '%s' (%d):\n\n", keyword, len(docs)))
	for _, d := range docs {
		sb.WriteString(fmt.Sprintf("- %s (id: %s, hPath: %s)\n", d["name"], d["id"], d["hPath"]))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func documentInfo(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	info, err := model.GetDocInfo(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("get doc info failed: %s", err)}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(
		"ID: %s\nRootID: %s\nName: %s\nRefCount: %d\nSubFileCount: %d\nIcon: %s",
		info.ID, info.RootID, info.Name, info.RefCount, info.SubFileCount, info.Icon,
	))
	if len(info.RefIDs) > 0 {
		sb.WriteString(fmt.Sprintf("\nRefIDs: %s", strings.Join(info.RefIDs, ", ")))
	}
	if len(info.AttrViews) > 0 {
		sb.WriteString("\nAttrViews:")
		for _, av := range info.AttrViews {
			sb.WriteString(fmt.Sprintf("\n  - %s: %s", av.ID, av.Name))
		}
	}
	if len(info.IAL) > 0 {
		sb.WriteString("\nIAL:")
		for k, v := range info.IAL {
			if len(v) > 100 {
				v = v[:100] + "..."
			}
			sb.WriteString(fmt.Sprintf("\n  %s: %s", k, v))
		}
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}
