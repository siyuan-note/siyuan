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

package util

import (
	"strings"

	"github.com/88250/lute"
	"github.com/PuerkitoBio/goquery"
	"github.com/siyuan-note/logging"
)

// MarkdownSettings 运行时 Markdown 配置。
var MarkdownSettings = &Markdown{
	InlineAsterisk:      true,
	InlineUnderscore:    true,
	InlineSup:           true,
	InlineSub:           true,
	InlineTag:           true,
	InlineMath:          true,
	InlineStrikethrough: true,
	InlineMark:          true,
}

type Markdown struct {
	InlineAsterisk      bool `json:"inlineAsterisk"`      // 是否启用行级 * 语法
	InlineUnderscore    bool `json:"inlineUnderscore"`    // 是否启用行级 _ 语法
	InlineSup           bool `json:"inlineSup"`           // 是否启用行级上标
	InlineSub           bool `json:"inlineSub"`           // 是否启用行级下标
	InlineTag           bool `json:"inlineTag"`           // 是否启用行级标签
	InlineMath          bool `json:"inlineMath"`          // 是否启用行级公式
	InlineStrikethrough bool `json:"inlineStrikethrough"` // 是否启用行级删除线
	InlineMark          bool `json:"inlineMark"`          // 是否启用行级标记
}

func NewLute() (ret *lute.Lute) {
	ret = lute.New()
	ret.SetTextMark(true)
	ret.SetProtyleWYSIWYG(true)
	ret.SetBlockRef(true)
	ret.SetFileAnnotationRef(true)
	ret.SetKramdownIAL(true)
	ret.SetTag(true)
	ret.SetSuperBlock(true)
	ret.SetImgPathAllowSpace(true)
	ret.SetGitConflict(true)
	ret.SetInlineAsterisk(MarkdownSettings.InlineAsterisk)
	ret.SetInlineUnderscore(MarkdownSettings.InlineUnderscore)
	ret.SetSup(MarkdownSettings.InlineSup)
	ret.SetSub(MarkdownSettings.InlineSub)
	ret.SetTag(MarkdownSettings.InlineTag)
	ret.SetInlineMath(MarkdownSettings.InlineMath)
	ret.SetGFMStrikethrough(MarkdownSettings.InlineStrikethrough)
	ret.SetMark(MarkdownSettings.InlineMark)
	ret.SetInlineMathAllowDigitAfterOpenMarker(true)
	ret.SetGFMStrikethrough1(false)
	ret.SetFootnotes(false)
	ret.SetToC(false)
	ret.SetIndentCodeBlock(false)
	ret.SetParagraphBeginningSpace(true)
	ret.SetAutoSpace(false)
	ret.SetHeadingID(false)
	ret.SetSetext(false)
	ret.SetYamlFrontMatter(false)
	ret.SetLinkRef(false)
	ret.SetCodeSyntaxHighlight(false)
	ret.SetSanitize(true)
	ret.SetUnorderedListMarker("-")
	ret.SetCallout(true)
	return
}

func NewStdLute() (ret *lute.Lute) {
	ret = lute.New()
	ret.SetFootnotes(false)
	ret.SetToC(false)
	ret.SetIndentCodeBlock(true) // 导入 Markdown 时支持缩进代码块语法 Support indented code block syntax when importing Markdown https://github.com/siyuan-note/siyuan/issues/14429
	ret.SetAutoSpace(false)
	ret.SetHeadingID(false)
	ret.SetSetext(false)
	ret.SetYamlFrontMatter(false)
	ret.SetLinkRef(false)
	ret.SetGFMAutoLink(false) // 导入 Markdown 时不自动转换超链接 https://github.com/siyuan-note/siyuan/issues/7682
	ret.SetImgPathAllowSpace(true)
	ret.SetInlineMathAllowDigitAfterOpenMarker(true) // Formula parsing supports $ followed by numbers when importing Markdown https://github.com/siyuan-note/siyuan/issues/8362

	// 导入 Markdown 时遵循编辑器 Markdown 语法设置
	// Follow editor Markdown syntax settings when importing Markdown https://github.com/siyuan-note/siyuan/issues/14731
	ret.SetInlineAsterisk(MarkdownSettings.InlineAsterisk)
	ret.SetInlineUnderscore(MarkdownSettings.InlineUnderscore)
	ret.SetSup(MarkdownSettings.InlineSup)
	ret.SetSub(MarkdownSettings.InlineSub)
	ret.SetTag(MarkdownSettings.InlineTag)
	ret.SetInlineMath(MarkdownSettings.InlineMath)
	ret.SetGFMStrikethrough(MarkdownSettings.InlineStrikethrough)
	ret.SetGFMStrikethrough1(false)
	return
}

func LinkTarget(htmlStr, linkBase string) (ret string) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(htmlStr))
	if err != nil {
		logging.LogErrorf("parse HTML failed: %s", err)
		return
	}

	doc.Find("a").Each(func(i int, selection *goquery.Selection) {
		if href, ok := selection.Attr("href"); ok {
			if IsRelativePath(href) {
				selection.SetAttr("href", linkBase+href)
			}

			// The hyperlink in the marketplace package README fails to jump to the browser to open https://github.com/siyuan-note/siyuan/issues/8452
			selection.SetAttr("target", "_blank")
		}
	})

	ret, _ = doc.Find("body").Html()
	return
}
