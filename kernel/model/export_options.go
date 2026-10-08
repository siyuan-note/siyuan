// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "github.com/siyuan-note/siyuan/kernel/conf"

// ExportRenderOptions 是导出入口的格式与访问上下文，不属于 HTTP 请求或持久化配置。
type ExportRenderOptions struct {
	AssetsDestSpace2Underscore, FillCSSVar, AdjustHeadingLevel, ImgTag bool
	AVPublishFilter                                                    AVExportPublishFilter
	AccessCheckers                                                     []EmbedBlockAccessChecker
}

func exportRenderOptions(opts *ExportOptions) ExportRenderOptions {
	if opts == nil {
		return ExportRenderOptions{}
	}
	return opts.Render
}

// 导出入口先把可选覆盖解析成独立配置，再与本次格式、引用集合和访问检查一起沿链路传递。
type treeExportOptions struct {
	Config                                         conf.Export
	WYSIWYG, RichTableCells, KeepFold, AVHiddenCol bool
	CustomTitle                                    string
	AddDocAnchorSpan                               bool
	References                                     *markdownExportReferences
	AVPublishFilter                                AVExportPublishFilter
	AccessCheckers                                 []EmbedBlockAccessChecker
}

type markdownExportOptions struct {
	Config                                                             conf.Export
	CloudAssetsBase                                                    string
	AssetsDestSpace2Underscore, AdjustHeadingLevel, ImgTag, FillCSSVar bool
	Ext                                                                string
	DefBlockIDs                                                        []string
	References                                                         *markdownExportReferences
	BoxPaths                                                           map[string]string
	AVPublishFilter                                                    AVExportPublishFilter
	AccessCheckers                                                     []EmbedBlockAccessChecker
}

type archiveExportOptions struct {
	Config                    conf.Export
	BoxID, BaseFolderName     string
	DocPaths, DefBlockIDs     []string
	PandocFrom, PandocTo, Ext string
	BoxPaths                  map[string]string
}

func ExportPandocConvertZip(ids []string, pandocTo, ext string) (name, zipPath string) {
	return ExportPandocConvertZipWithOptions(ids, pandocTo, ext, nil)
}

func ExportNotebookMarkdown(boxID string) (zipPath string) {
	return ExportNotebookMarkdownWithOptions(boxID, nil)
}

func ExportNotebooksMarkdown(boxIDs []string) (zipPath string) {
	return ExportNotebooksMarkdownWithOptions(boxIDs, nil)
}
