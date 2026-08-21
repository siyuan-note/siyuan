// SiYuan - From thought to insight, with agents
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
	"html"
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const maxHTMLAssetContentSize = 2 * 1024 * 1024

var AssetTool = &Tool{
	Name:        "asset",
	Description: "Asset management. Actions: upload(id, files=comma-separated absolute paths), create_html(id, html, name?, parentID?, previousID?, nextID?), unused(), clean(path?), stat(path). create_html writes an HTML asset and inserts a sandboxed IFrame block in one operation.",
	EffectScope: EffectScopeLocal,
	ActionEffects: map[string]ToolEffects{
		"upload":      {LocalWrite: true},
		"create_html": {LocalWrite: true},
		"unused":      {LocalRead: true},
		"clean":       {LocalWrite: true},
		"stat":        {LocalRead: true},
	},
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":     {Type: "string", Description: "Operation", Enum: []string{"upload", "create_html", "unused", "clean", "stat"}},
			"notebook":   {Type: "string", Description: "Notebook ID that owns the target document; required for encrypted notebooks"},
			"id":         {Type: "string", Description: "Document block ID (for upload, create_html)"},
			"files":      {Type: "string", Description: "Comma-separated absolute file paths (for upload)"},
			"name":       {Type: "string", Description: "HTML asset filename ending in .html or .htm (for create_html, default component.html)"},
			"html":       {Type: "string", Description: "HTML document content (for create_html, maximum 2 MiB)"},
			"parentID":   {Type: "string", Description: "Parent block ID (for create_html, defaults to the document ID)"},
			"previousID": {Type: "string", Description: "Previous sibling block ID (for create_html)"},
			"nextID":     {Type: "string", Description: "Next sibling block ID (for create_html)"},
			"path":       {Type: "string", Description: "Single unused asset path to remove, relative to data directory (for clean, optional). Use as returned by the unused action, e.g. assets/image/xxx.png."},
		},
		Required: []string{"action"},
	},
	Handler: assetHandler,
}

func init() {
	register(AssetTool)
}

func assetHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "upload":
		return assetUpload(args)
	case "create_html":
		return assetCreateHTML(args)
	case "unused":
		return assetUnused(args)
	case "clean":
		return assetClean(args)
	case "stat":
		return assetStat(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [upload, create_html, unused, clean, stat]"}},
		IsError: true,
	}, nil
}

func assetCreateHTML(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	htmlContent, exists := args["html"].(string)
	if !exists || strings.TrimSpace(htmlContent) == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "html is required"}}, IsError: true}, nil
	}
	if len([]byte(htmlContent)) > maxHTMLAssetContentSize {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "html exceeds the 2 MiB limit"}}, IsError: true}, nil
	}
	name, nameErr := normalizeHTMLAssetName(args["name"])
	if nameErr != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: nameErr.Error()}}, IsError: true}, nil
	}

	parentID, _ := args["parentID"].(string)
	previousID, _ := args["previousID"].(string)
	nextID, _ := args["nextID"].(string)
	if parentID == "" && previousID == "" && nextID == "" {
		parentID = id
	}
	boxID, release, scopeErr := beginBlockToolScope(args, true, id, parentID, previousID, nextID)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	docBlockTree := treenode.GetBlockTreeInExactBox(id, boxID)
	if docBlockTree == nil || docBlockTree.ID != docBlockTree.RootID {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id must be a document block ID"}}, IsError: true}, nil
	}
	for _, targetID := range []string{parentID, previousID, nextID} {
		if targetID == "" {
			continue
		}
		target := treenode.GetBlockTreeInExactBox(targetID, boxID)
		if target == nil || target.RootID != docBlockTree.RootID {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "insertion target must belong to document " + id}}, IsError: true}, nil
		}
	}
	if parentID != "" && previousID == "" && nextID == "" {
		if err := treenode.CheckContainerParent(parentID); err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
		}
	}

	assetPath, _, err := model.InsertAssetBytes(id, name, []byte(htmlContent))
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "create HTML asset failed: " + err.Error()}}, IsError: true}, nil
	}
	blockDOM, blockID, err := htmlAssetIFrameBlockDOM(assetPath)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "create IFrame block failed: " + err.Error()}}, IsError: true}, nil
	}

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:     "insert",
			Data:       blockDOM,
			ParentID:   parentID,
			PreviousID: previousID,
			NextID:     nextID,
		}},
	}}
	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	util.PushReloadProtyle(docBlockTree.RootID)

	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("Created HTML IFrame block: %s\nAsset: %s", blockID, assetPath)}},
		StructuredContent: map[string]any{
			"blockID":   blockID,
			"assetPath": assetPath,
		},
		StructuredContentSet: true,
	}, nil
}

func normalizeHTMLAssetName(value any) (string, error) {
	name, _ := value.(string)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "component.html"
	}
	name = filepath.Base(name)
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".html" && ext != ".htm" {
		return "", fmt.Errorf("name must end in .html or .htm")
	}
	return name, nil
}

func htmlAssetIFrameBlockDOM(assetPath string) (dom, blockID string, err error) {
	src := html.EscapeString(model.HTMLAssetIFrameSrc(assetPath))
	dom, err = markdownToBlockDOM(`<iframe sandbox="allow-scripts" src="` + src + `" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`)
	if err != nil {
		return
	}
	tree := util.NewLute().BlockDOM2Tree(dom)
	if tree == nil || tree.Root == nil || tree.Root.FirstChild == nil {
		return "", "", fmt.Errorf("empty IFrame block")
	}
	blockID = tree.Root.FirstChild.ID
	return
}

func assetUpload(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	filesStr, _ := args["files"].(string)
	if filesStr == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "files is required"}}, IsError: true}, nil
	}
	fileList := strings.Split(filesStr, ",")
	fileList, err := validateAssetUploadPaths(fileList)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "invalid asset path: " + err.Error()}}, IsError: true}, nil
	}

	_, succFiles, failedFiles, err := model.InsertLocalAssets(id, fileList, true)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "upload assets failed: " + err.Error()}}, IsError: true}, nil
	}
	if 0 < len(failedFiles) {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "upload asset failed: " +
			failedFiles[0].Name + ": " + failedFiles[0].Error}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Uploaded %d file(s):\n\n", len(succFiles)))
	for _, result := range succFiles {
		sb.WriteString(fmt.Sprintf("- %s -> %s\n", result.Name, result.Path))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

// validateAssetUploadPaths 将上传路径归一化为绝对路径，并拒绝敏感路径，
// 防止通过 AI 提示注入诱导上传本地凭据等敏感文件（如 SSH 私钥、云服务凭据）后外泄。
// 非敏感的工作区外绝对路径仍然允许上传，与 globalCopyFiles 等接受工作区外路径的接口保持一致。
func validateAssetUploadPaths(fileList []string) ([]string, error) {
	for i, f := range fileList {
		abs, err := filepath.Abs(strings.TrimSpace(f))
		if err != nil {
			return nil, err
		}
		if util.IsSensitivePath(abs) {
			return nil, fmt.Errorf("asset path is sensitive: %s", abs)
		}
		fileList[i] = abs
	}
	return fileList, nil
}

func assetUnused(args map[string]any) (CallToolResult, error) {
	items := model.UnusedAssets(true)
	if len(items) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no unused assets found"}}}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Unused assets (%d):\n\n", len(items)))
	for _, item := range items {
		sb.WriteString(fmt.Sprintf("- %s (%s)\n", item.Item, item.Name))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func assetClean(args map[string]any) (CallToolResult, error) {
	pathValue, pathSet := args["path"]
	if pathSet {
		singlePath, _ := pathValue.(string)
		if singlePath == "" {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path must not be empty"}}, IsError: true}, nil
		}
		ret, err := model.RemoveUnusedAsset(singlePath)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "clean failed: " + err.Error()}}, IsError: true}, nil
		}
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("removed: %v", ret)}}}, nil
	}
	removed := model.RemoveUnusedAssets()
	if len(removed) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no unused assets to clean"}}}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Removed %d asset(s):\n\n", len(removed)))
	for _, p := range removed {
		sb.WriteString(fmt.Sprintf("- %s\n", p))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func assetStat(args map[string]any) (CallToolResult, error) {
	p, _ := args["path"].(string)
	if p == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}

	relativePath, abs, err := model.ResolveDataAssetPath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "stat failed: " + err.Error()}}, IsError: true}, nil
	}
	info, err := os.Stat(abs)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "stat failed: " + err.Error()}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf(
		"Path: %s\nSize: %d\nIsDir: %v\nModTime: %s",
		relativePath, info.Size(), info.IsDir(), info.ModTime().Format("2006-01-02 15:04:05"),
	)}}}, nil
}
