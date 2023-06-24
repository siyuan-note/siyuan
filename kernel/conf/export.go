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

package conf

type Export struct {
	ParagraphBeginningSpace bool   `json:"paragraphBeginningSpace"` // 是否使用中文排版段落开头空两格
	AddTitle                bool   `json:"addTitle"`                // 是否添加标题
	BlockRefMode            int    `json:"blockRefMode"`            // 内容块引用导出模式，2：锚文本块链，3：仅锚文本，4：块引转脚注，（0：使用原始文本，1：使用 Blockquote。0 和 1 都已经废弃 https://github.com/siyuan-note/siyuan/issues/3155）
	BlockEmbedMode          int    `json:"blockEmbedMode"`          // 内容块引用导出模式，0：使用原始文本，1：使用 Blockquote
	BlockRefTextLeft        string `json:"blockRefTextLeft"`        // 内容块引用导出锚文本左侧符号，默认留空
	BlockRefTextRight       string `json:"blockRefTextRight"`       // 内容块引用导出锚文本右侧符号，默认留空
	TagOpenMarker           string `json:"tagOpenMarker"`           // 标签开始标记符，默认是 #
	TagCloseMarker          string `json:"tagCloseMarker"`          // 标签结束标记符，默认是 #
	FileAnnotationRefMode   int    `json:"fileAnnotationRefMode"`   // 文件标注引用导出模式，0：文件名 - 页码 - 锚文本，1：仅锚文本
	PandocBin               string `json:"pandocBin"`               // Pandoc 可执行文件路径
	MarkdownYFM             bool   `json:"markdownYFM"`             // Markdown 导出时是否添加 YAML Front Matter https://github.com/siyuan-note/siyuan/issues/7727
	PDFFooter               string `json:"pdfFooter"`               // PDF 导出时页脚内容
}

func NewExport() *Export {
	return &Export{
		ParagraphBeginningSpace: false,
		AddTitle:                true,
		BlockRefMode:            3,
		BlockEmbedMode:          1,
		BlockRefTextLeft:        "",
		BlockRefTextRight:       "",
		TagOpenMarker:           "#",
		TagCloseMarker:          "#",
		FileAnnotationRefMode:   0,
		PandocBin:               "",
		MarkdownYFM:             false,
		PDFFooter:               "%page / %pages",
	}
}
