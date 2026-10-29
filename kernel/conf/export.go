// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

type Export struct {
	ParagraphBeginningSpace bool `json:"paragraphBeginningSpace"` // 是否使用中文排版段落开头空两格
	AddTitle                bool `json:"addTitle"`                // 是否添加标题
	// 内容块引用导出模式
	//   2：锚文本块链
	//   3：仅锚文本
	//   4：块引转脚注+锚点哈希
	//  （5：锚点哈希 https://github.com/siyuan-note/siyuan/issues/10265 已经废弃 https://github.com/siyuan-note/siyuan/issues/13331）
	//  （0：使用原始文本，1：使用 Blockquote，都已经废弃 https://github.com/siyuan-note/siyuan/issues/3155）
	BlockRefMode          int    `json:"blockRefMode"`
	BlockEmbedMode        int    `json:"blockEmbedMode"`        // 内容块嵌入导出模式，0：使用原始文本，1：使用引述块
	BlockRefTextLeft      string `json:"blockRefTextLeft"`      // 内容块引用导出锚文本左侧符号，默认留空
	BlockRefTextRight     string `json:"blockRefTextRight"`     // 内容块引用导出锚文本右侧符号，默认留空
	TagOpenMarker         string `json:"tagOpenMarker"`         // 标签开始标记符，默认是 #
	TagCloseMarker        string `json:"tagCloseMarker"`        // 标签结束标记符，默认是 #
	FileAnnotationRefMode int    `json:"fileAnnotationRefMode"` // 文件标注引用导出模式，0：文件名 - 页码 - 锚文本，1：仅锚文本
	PandocBin             string `json:"pandocBin"`             // Pandoc 可执行文件路径
	PandocParams          string `json:"pandocParams"`          // Pandoc 额外参数
	RemoveAssetsID        bool   `json:"removeAssetsID"`        // Markdown 导出时是否移除资源文件名 ID 部分 https://github.com/siyuan-note/siyuan/issues/16065
	MarkdownYFM           bool   `json:"markdownYFM"`           // Markdown 导出时是否添加 YAML Front Matter https://github.com/siyuan-note/siyuan/issues/7727
	InlineMemo            bool   `json:"inlineMemo"`            // 是否导出行级备注 https://github.com/siyuan-note/siyuan/issues/14605
	IncludeSubDocs        bool   `json:"includeSubDocs"`        // 是否导出子文档 https://github.com/siyuan-note/siyuan/issues/13635
	IncludeRelatedDocs    bool   `json:"includeRelatedDocs"`    // 是否导出关联文档 https://github.com/siyuan-note/siyuan/issues/13635
	PDFFooter             string `json:"pdfFooter"`             // PDF 导出时页脚内容
	PDFWatermarkStr       string `json:"pdfWatermarkStr"`       // PDF 导出时水印文本或水印文件路径
	PDFWatermarkDesc      string `json:"pdfWatermarkDesc"`      // PDF 导出时水印位置、大小和样式等
	ImageWatermarkStr     string `json:"imageWatermarkStr"`     // 图片导出时水印文本或水印文件路径
	ImageWatermarkDesc    string `json:"imageWatermarkDesc"`    // 图片导出时水印位置、大小和样式等
}

func NewExport() *Export {
	return &Export{
		ParagraphBeginningSpace: false,
		AddTitle:                true,
		BlockRefMode:            4,
		BlockEmbedMode:          1,
		BlockRefTextLeft:        "",
		BlockRefTextRight:       "",
		TagOpenMarker:           "#",
		TagCloseMarker:          "#",
		FileAnnotationRefMode:   0,
		PandocBin:               "",
		RemoveAssetsID:          false,
		MarkdownYFM:             false,
		InlineMemo:              false,
		IncludeSubDocs:          true,
		IncludeRelatedDocs:      false,
		PDFFooter:               "%page / %pages",
	}
}
