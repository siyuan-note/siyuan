// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var DocumentTool = &Tool{
	Name:        "document",
	Description: "Document operations. Actions: get(id), create(notebook, parentID, title, markdown?), list(notebook, parentID=notebook root by default), delete(id), rename(id, title), move(id, notebook, parentID), duplicate(id), search_docs(keyword), info(id). Use parentID=\"\" for the notebook root. Titles are independent literal text. The legacy path=hPath parameter checks each candidate ancestor chain; ambiguous paths, empty or slash-containing ancestor titles and unavailable indexes return explicit errors. Never derive identity or hierarchy from a display hPath.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation", Enum: []string{"get", "create", "list", "delete", "rename", "move", "duplicate", "search_docs", "info"}},
			"id":       {Type: "string", Description: "Document block ID"},
			"title":    {Type: "string", Description: "Document title (for create, rename)"},
			"parentID": {Type: "string", Description: "Target parent document ID (for create, list, move); an empty string explicitly selects the notebook root. Do not combine with path. Obtain IDs from list, search_docs or get."},
			"path":     {Type: "string", Description: "Legacy hPath (for create, list, move). Requires a unique ancestor chain with non-empty titles and no literal slash. Conflicts return pathAmbiguous or legacyPathUnsupported; unavailable metadata returns indexUnavailable. Prefer parentID."},
			"markdown": {Type: "string", Description: "Initial markdown content (for create).\n\n" + markdownContentSyntax},
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
	target, err := resolveDocumentTarget(notebook, args, true, false)
	if err != nil {
		return documentTargetFailure(err), nil
	}
	markdown, _ := args["markdown"].(string)
	title, _ := args["title"].(string)
	if target.structured {
		if _, ok := args["title"].(string); !ok {
			return documentTargetFailure(errors.New("title is required with parentID")), nil
		}
		doc, err := model.CreateDocByParent(model.DocumentCreateRequest{Notebook: notebook, ParentID: target.id,
			ID: ast.NewNodeID(), TitleFormat: "plain", Title: title, Markdown: markdown})
		if err != nil {
			return documentTargetFailure(fmt.Errorf("create doc failed: %w", err)), nil
		}
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("document created: %s (hPath: %s)", doc.ID, doc.DisplayPath)}}}, nil
	}
	hPath, _ := args["path"].(string)
	if title == "" {
		title = hPath
		if strings.Contains(title, "/") {
			parts := strings.Split(strings.TrimRight(title, "/"), "/")
			title = parts[len(parts)-1]
		}
	}

	id := ast.NewNodeID()
	docPath := strings.TrimSuffix(strings.TrimRight(target.path, "/"), ".sy") + "/" + id + ".sy"
	tree, err := model.CreateDocByMd(notebook, docPath, title, markdown, nil, nil)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("create doc failed: %s", err)}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("document created: %s (hPath: %s)", tree.Root.ID, hPath)}}}, nil
}

type documentTarget struct {
	id         *string
	path       string
	hPath      string
	structured bool
}

func documentTargetFailure(err error) CallToolResult {
	var creation *model.DocumentCreateFailure
	if errors.As(err, &creation) {
		failure := map[string]any{"error": err.Error(), "reason": creation.Reason,
			"commitState": creation.CommitState, "id": creation.ID, "stage": creation.Stage, "completed": creation.Completed}
		encoded, _ := json.Marshal(failure)
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: string(encoded)}},
			StructuredContent: failure, StructuredContentSet: true, IsError: true, ExecutionUnknown: creation.CommitState == "unknown"}
	}
	if failure, ok := model.LegacyPathFailure(err); ok {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: failure.Reason + ": " + err.Error()}}, IsError: true}
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}
}

// resolveDocumentTarget uses the shared ancestor-chain check for legacy paths and identity resolution for parentID.
func resolveDocumentTarget(notebook string, args map[string]any, create, defaultRoot bool) (*documentTarget, error) {
	parent, hasParent := args["parentID"]
	legacy, hasPath := args["path"]
	if hasParent && hasPath {
		return nil, errors.New("parentID and path cannot be combined")
	}
	if text, ok := legacy.(string); ok && text == "" && defaultRoot {
		hasPath = false
	}
	if hasParent || !hasPath && defaultRoot {
		parentID, ok := parent.(string)
		if hasParent && !ok {
			return nil, errors.New("parentID must be a string; use an empty string for the notebook root")
		}
		kind := "root"
		var id *string
		if parentID != "" {
			kind, id = "document", &parentID
		}
		resolved, err := model.ResolveDocPath(notebook, kind, id, nil)
		if err != nil {
			return nil, err
		}
		target := &documentTarget{path: "/", hPath: "/", structured: true}
		if resolved.Resolved != nil {
			target.id, target.path, target.hPath = &resolved.Resolved.ID, resolved.Resolved.Path, resolved.Resolved.DisplayPath
		}
		return target, nil
	}
	hPath, ok := legacy.(string)
	if !hasPath || !ok || hPath == "" {
		return nil, errors.New("parentID or path is required")
	}
	if create {
		hPath = util.ParentHPath(hPath)
	}
	bt, err := model.ResolveLegacyDocumentPath(notebook, hPath, create)
	if err != nil {
		return nil, err
	}
	if bt == nil {
		return nil, fmt.Errorf("target path not found: %s", hPath)
	}
	target := &documentTarget{path: bt.Path, hPath: hPath}
	if bt.Path != "/" {
		target.id = &bt.ID
	}
	return target, nil
}

func documentList(args map[string]any) (CallToolResult, error) {
	notebook, _ := args["notebook"].(string)
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}
	target, err := resolveDocumentTarget(notebook, args, false, true)
	if err != nil {
		return documentTargetFailure(err), nil
	}

	files, _, err := model.ListDocTree(notebook, target.path, 0, false, false, 128)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("list docs failed: %s", err)}}, IsError: true}, nil
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "Documents in %s (hPath: %s):\n\n", notebook, target.hPath)
	for _, f := range files {
		fmt.Fprintf(&sb, "- %s (id: %s, hPath: %s)\n", f.Name, f.ID, strings.TrimRight(target.hPath, "/")+"/"+f.Name)
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
	if id == "" || notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id and notebook are required"}}, IsError: true}, nil
	}
	target, err := resolveDocumentTarget(notebook, args, false, false)
	if err != nil {
		return documentTargetFailure(err), nil
	}
	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("load doc failed: %s", err)}}, IsError: true}, nil
	}

	if err := model.MoveDocs([]string{tree.Path}, notebook, target.path, nil); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("move doc failed: %s", err)}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("document moved: %s -> %s (hPath: %s)", id, notebook, target.hPath)}}}, nil
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

	if err = model.DuplicateDoc(tree); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("duplicate doc failed: %s", err)}}, IsError: true}, nil
	}
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
	fmt.Fprintf(&sb, "Search results matching '%s' (%d):\n\n", keyword, len(docs))
	for _, d := range docs {
		typ, id, name := model.SearchDocDisplayFields(d)
		if typ == "NOTEBOOK" {
			fmt.Fprintf(&sb, "- [%s] %s (id: %s, hPath: %s)\n", typ, name, id, d["hPath"])
		} else {
			fmt.Fprintf(&sb, "- [%s] %s (id: %s, notebook: %s, hPath: %s)\n", typ, name, id, d["box"], d["hPath"])
		}
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
	fmt.Fprintf(&sb, "ID: %s\nRootID: %s\nName: %s\nRefCount: %d\nSubFileCount: %d\nIcon: %s",
		info.ID, info.RootID, info.Name, info.RefCount, info.SubFileCount, info.Icon)
	if len(info.RefIDs) > 0 {
		fmt.Fprintf(&sb, "\nRefIDs: %s", strings.Join(info.RefIDs, ", "))
	}
	if len(info.AttrViews) > 0 {
		sb.WriteString("\nAttrViews:")
		for _, av := range info.AttrViews {
			fmt.Fprintf(&sb, "\n  - %s: %s", av.ID, av.Name)
		}
	}
	if len(info.IAL) > 0 {
		sb.WriteString("\nIAL:")
		for k, v := range info.IAL {
			v = truncateText(v, 100)
			fmt.Fprintf(&sb, "\n  %s: %s", k, v)
		}
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}
