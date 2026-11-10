// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"fmt"

	"github.com/siyuan-note/siyuan/kernel/model"
)

var ExportTool = &Tool{
	Name:        "export",
	Description: "Export operations. Actions: md(id), html(id), preview(id), docx(id, output directory), sy(id) → .sy.zip, md-zip(id), data() → full workspace backup. Use for export-formatted content or export files; prefer block.get/get_kramdown for reading current document/block content. md/html/preview return text, not files. Only docx uses output; other actions ignore it.",
	EffectScope: EffectScopeLocal,
	ResolveEffects: deferredAssetEffects(map[string]ToolEffects{
		"html": {LocalRead: true}, "docx": {LocalWrite: true}, "sy": {LocalWrite: true},
		"md-zip": {LocalWrite: true}, "data": {LocalWrite: true},
	}),
	ActionEffects: map[string]ToolEffects{
		"md":      {LocalRead: true},
		"html":    {LocalRead: true},
		"preview": {LocalRead: true},
		"docx":    {LocalWrite: true},
		"sy":      {LocalWrite: true},
		"md-zip":  {LocalWrite: true},
		"data":    {LocalWrite: true},
	},
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"md", "html", "preview", "docx", "sy", "md-zip", "data"}},
			"id":     {Type: "string", Description: "Document block ID (for md, html, preview, docx, sy, md-zip)"},
			"output": {Type: "string", Description: "Destination directory on the kernel host, required only for docx and ignored by other actions. Use an absolute path; relative paths resolve from the kernel process working directory, not the workspace. The document title determines the .docx filename; an existing filename is made unique"},
		},
		Required: []string{"action"},
	},
	Handler: exportHandler,
}

func init() {
	register(ExportTool)
}

func exportHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "md":
		return exportMd(args)
	case "html":
		return exportHtml(args)
	case "preview":
		return exportPreview(args)
	case "docx":
		return exportDocx(args)
	case "sy":
		return exportSy(args)
	case "md-zip":
		return exportMdZip(args)
	case "data":
		return exportData(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [md, html, preview, docx, sy, md-zip, data]"}},
		IsError: true,
	}, nil
}

func exportMd(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	hPath, content := model.ExportMarkdownContent(id, &model.ExportOptions{
		BlockRefMode:   new(4),
		BlockEmbedMode: new(0),
		MarkdownYFM:    new(true),
		AddTitle:       new(false),
		Render: model.ExportRenderOptions{
			FillCSSVar:         false,
			AdjustHeadingLevel: false,
			ImgTag:             false,
		},
	})
	if content == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "export failed or empty"}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("# %s\n\n%s", hPath, content)}}}, nil
}

func exportHtml(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	_, dom, _ := model.ExportHTML(id, "", false, false, false)
	if dom == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "export failed or empty"}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: dom}}}, nil
}

func exportPreview(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	html := model.ExportPreview(id, false, nil)
	if html == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "export preview failed or empty"}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: html}}}, nil
}

func exportDocx(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	output, _ := args["output"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	if output == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "output directory is required for docx"}}, IsError: true}, nil
	}
	fullPath, err := model.ExportDocx(id, output, false, false)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "export docx failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("exported docx to: %s", fullPath)}}}, nil
}

func exportSy(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	_, zipPath := model.ExportPandocConvertZip([]string{id}, "", ".sy")
	if zipPath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "export sy failed"}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("exported sy.zip to: %s", zipPath)}}}, nil
}

func exportMdZip(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	_, zipPath := model.ExportPandocConvertZip([]string{id}, "", ".md")
	if zipPath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "export md-zip failed"}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("exported md zip to: %s", zipPath)}}}, nil
}

func exportData(_ map[string]any) (CallToolResult, error) {
	zipPath, err := model.ExportData()
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "export data failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("exported data backup to: %s", zipPath)}}}, nil
}
