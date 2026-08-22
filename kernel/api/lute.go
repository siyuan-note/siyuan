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

package api

import (
	"html"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/PuerkitoBio/goquery"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// maxSpinBlockDOMBytes 限制 spinBlockDOM 输入 DOM 的最大字节数。
const maxSpinBlockDOMBytes = 1024 * 1024

func copyStdMarkdown(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	assetsDestSpace2Underscore := false
	if nil != arg["assetsDestSpace2Underscore"] {
		assetsDestSpace2Underscore = arg["assetsDestSpace2Underscore"].(bool)
	}

	fillCSSVar := false
	if nil != arg["fillCSSVar"] {
		fillCSSVar = arg["fillCSSVar"].(bool)
	}

	adjustHeadingLevel := false
	if nil != arg["adjustHeadingLevel"] {
		adjustHeadingLevel = arg["adjustHeadingLevel"].(bool)
	}

	imgTag := false
	if nil != arg["imgTag"] {
		imgTag = arg["imgTag"].(bool)
	}

	markdownContent := model.ExportStdMarkdown(id, assetsDestSpace2Underscore, fillCSSVar, adjustHeadingLevel, imgTag)
	if model.IsReadOnlyRoleContext(c) {
		bt := treenode.GetBlockTree(id)
		if bt != nil {
			publishAccess := model.GetPublishAccess()
			markdownContent = model.FilterContentByPublishAccess(c, publishAccess, bt.BoxID, bt.Path, markdownContent, true)
		}
	}
	ret.Data = markdownContent
}

func html2BlockDOM(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var dom string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("dom", &dom, true, false)) {
		return
	}
	// 可选 notebook 参数：指定目标加密笔记本时资源写入 box 内并加密
	boxID := ""
	if notebook, ok := arg["notebook"].(string); ok && notebook != "" {
		if model.IsEncryptedBox(notebook) {
			boxID = notebook
		}
	}
	if err := holdEncryptedBoxRequest(c, boxID); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	text, _ := arg["text"].(string)
	mathML, _ := arg["mathML"].(string)
	office, _ := arg["office"].(string)
	officeMathHTML, _ := arg["officeMathHTML"].(string)
	wps, _ := arg["wps"].(string)
	skipLocalAssets, _ := arg["skipLocalAssets"].(bool)
	luteEngine := util.NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	luteEngine.SetHTML2MarkdownAttrs([]string{"alias", "memo", "bookmark", "custom-*"})
	// 将 Word 和 WPS 公式转换为可编辑公式 https://github.com/siyuan-note/siyuan/issues/18747
	if markdown, converted := convertClipboardMath(mathML, office, wps); converted {
		luteEngine.SetInlineMath(true)
		ret.Data = luteEngine.Md2BlockDOM(markdown, false)
		return
	}
	if markdown, converted := convertOfficeHTMLClipboardMath(officeMathHTML); converted {
		luteEngine.SetInlineMath(true)
		ret.Data = luteEngine.Md2BlockDOM(markdown, false)
		return
	}
	// 将 Word 和 WPS 批注转换为行级备注 https://github.com/siyuan-note/siyuan/issues/18748
	dom = normalizeWPSComments(dom, text, wps)
	dom = normalizeMSWordComments(dom)
	tree, _ := model.HTML2Tree(dom, luteEngine, boxID)
	if nil == tree {
		ret.Data = "Failed to convert"
		return
	}

	var unlinks []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeListItem == n.Type && nil == n.FirstChild {
			newNode := treenode.NewParagraph("")
			n.AppendChild(newNode)
			n.SetIALAttr("updated", util.TimeFromID(newNode.ID))
			return ast.WalkSkipChildren
		} else if ast.NodeBlockquote == n.Type && nil == n.FirstChild.Next {
			unlinks = append(unlinks, n)
		}
		return ast.WalkContinue
	})
	for _, n := range unlinks {
		n.Unlink()
	}

	// 表格只包含一个单元格时，将其转换为段落
	// Copy one cell from Excel/HTML table and paste it using the cell's content https://github.com/siyuan-note/siyuan/issues/9614
	unlinks = nil
	if nil != tree.Root.FirstChild && ast.NodeTable == tree.Root.FirstChild.Type && (nil == tree.Root.FirstChild.Next ||
		(ast.NodeKramdownBlockIAL == tree.Root.FirstChild.Next.Type && nil == tree.Root.FirstChild.Next.Next)) {
		if nil != tree.Root.FirstChild.FirstChild && ast.NodeTableHead == tree.Root.FirstChild.FirstChild.Type {
			head := tree.Root.FirstChild.FirstChild
			if nil == head.Next && nil != head.FirstChild && nil == head.FirstChild.Next {
				row := head.FirstChild
				if nil != row.FirstChild && nil == row.FirstChild.Next {
					cell := row.FirstChild
					p := treenode.NewParagraph("")
					var contents []*ast.Node
					for c := cell.FirstChild; nil != c; c = c.Next {
						contents = append(contents, c)
					}
					for _, c := range contents {
						p.AppendChild(c)
					}
					tree.Root.FirstChild.Unlink()
					tree.Root.PrependChild(p)
				}
			}
		}
	}

	if util.ContainerStd == model.Conf.System.Container && !skipLocalAssets {
		// 处理本地资源文件复制
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || ast.NodeLinkDest != n.Type {
				return ast.WalkContinue
			}

			if "" == n.TokensStr() {
				return ast.WalkContinue
			}

			localPath := n.TokensStr()
			if strings.HasPrefix(localPath, "http") {
				return ast.WalkContinue
			}
			localPath = util.FileURLToLocalPath(localPath)
			if !filepath.IsAbs(localPath) {
				// Kernel crash when copy-pasting from some browsers https://github.com/siyuan-note/siyuan/issues/9203
				return ast.WalkContinue
			}
			if !gulu.File.IsExist(localPath) {
				return ast.WalkContinue
			}

			if util.IsSensitivePath(localPath) {
				logging.LogWarnf("skip copying asset [%s] due to sensitive path", localPath)
				return ast.WalkContinue
			}
			if encryptedBoxID := model.EncryptedRawPathBoxID(localPath); encryptedBoxID != "" {
				logging.LogWarnf("skip copying asset [%s] from encrypted notebook [%s]", localPath, encryptedBoxID)
				return ast.WalkContinue
			}

			name := filepath.Base(localPath)
			ext := filepath.Ext(name)
			name = name[0 : len(name)-len(ext)]
			name = name + "-" + ast.NewNodeID() + ext

			data, readErr := os.ReadFile(localPath)
			if readErr != nil {
				logging.LogErrorf("read asset [%s] failed: %s", localPath, readErr)
				return ast.WalkStop
			}
			assetsDir := filepath.Join(util.DataDir, "assets")
			if boxID != "" {
				assetsDir = filepath.Join(util.DataDir, boxID, "assets")
			}
			storedName, storeErr := model.StoreAssetForBox(boxID, assetsDir, name, data)
			if storeErr != nil {
				logging.LogErrorf("store asset [%s] failed: %s", localPath, storeErr)
				return ast.WalkStop
			}
			assetURL := "assets/" + storedName
			if boxID != "" {
				assetURL += "?box=" + boxID
			}
			n.Tokens = gulu.Str.ToBytes(assetURL)
			return ast.WalkContinue
		})
	}

	parse.TextMarks2Inlines(tree) // 先将 TextMark 转换为 Inlines https://github.com/siyuan-note/siyuan/issues/13056
	parse.NestedInlines2FlattedSpansHybrid(tree, false)

	md, err := lute.FormatNodeSync(tree.Root, luteEngine.ParseOptions, luteEngine.RenderOptions)
	if nil != err {
		ret.Data = "Failed to convert"
		return
	}

	tree = parse.Parse("", []byte(md), luteEngine.ParseOptions)
	renderer := render.NewProtyleRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	output := renderer.Render()
	ret.Data = gulu.Str.FromBytes(output)
}

func normalizeMSWordComments(dom string) string {
	if !strings.Contains(dom, "mso-comment") && !strings.Contains(dom, "MsoComment") && !strings.Contains(dom, "msocom") {
		return dom
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(dom))
	if err != nil {
		return dom
	}

	comments := map[string]string{}
	doc.Find(`[id^="_com_"]`).Each(func(_ int, comment *goquery.Selection) {
		id, _ := comment.Attr("id")
		var paragraphs []string
		comment.Find(".MsoCommentText").Each(func(_ int, paragraph *goquery.Selection) {
			paragraph = paragraph.Clone()
			paragraph.Find(".MsoCommentReference, .msocomoff").Remove()
			if text := strings.TrimSpace(paragraph.Text()); text != "" {
				paragraphs = append(paragraphs, text)
			}
		})
		if 0 < len(paragraphs) {
			comments[strings.TrimPrefix(id, "_com_")] = strings.Join(paragraphs, "\n")
		}
	})

	doc.Find("a[style]").Each(func(_ int, anchor *goquery.Selection) {
		style, _ := anchor.Attr("style")
		if !strings.Contains(strings.ToLower(style), "mso-comment-reference:") {
			return
		}
		if href, exists := anchor.Attr("href"); exists && href != "" {
			return
		}

		content, err := anchor.Html()
		if err != nil {
			return
		}
		comment := comments[msWordCommentID(anchor, style)]
		if comment == "" {
			anchor.ReplaceWithHtml(content)
			return
		}
		anchor.ReplaceWithHtml(`<span title="` + html.EscapeString(comment) + `">` + content + `</span>`)
	})

	doc.Find(".MsoCommentReference, .msocomanchor, .msocomoff").Remove()
	doc.Find("[style]").Each(func(_ int, selection *goquery.Selection) {
		style, _ := selection.Attr("style")
		if strings.Contains(strings.ToLower(style), "mso-element:comment-list") {
			selection.Remove()
		}
	})

	ret, err := doc.Find("body").Html()
	if err != nil {
		return dom
	}
	return ret
}

func msWordCommentID(anchor *goquery.Selection, style string) string {
	if href, exists := anchor.Next().Find(`a[href^="#_msocom_"]`).First().Attr("href"); exists {
		return strings.TrimPrefix(href, "#_msocom_")
	}

	style = style[strings.Index(strings.ToLower(style), "mso-comment-reference:")+len("mso-comment-reference:"):]
	if semicolon := strings.IndexByte(style, ';'); 0 <= semicolon {
		style = style[:semicolon]
	}
	if underscore := strings.LastIndexByte(style, '_'); 0 <= underscore {
		return strings.TrimSpace(style[underscore+1:])
	}
	return ""
}

func spinBlockDOM(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var dom string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("dom", &dom, true, false)) {
		return
	}
	if len(dom) > maxSpinBlockDOMBytes {
		// 限制输入大小，避免解析超大 DOM 导致资源消耗
		ret.Code = http.StatusRequestEntityTooLarge
		ret.Msg = "dom input exceeds the maximum permitted size"
		return
	}
	luteEngine := model.NewLute()

	dom = luteEngine.SpinBlockDOM(dom)
	ret.Data = map[string]any{
		"dom": dom,
	}
}

// md2HTML 将 Markdown 转换为 HTML。
func md2HTML(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var markdown, mode string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("markdown", &markdown, true, false),
		util.BindJsonArg("mode", &mode, false, false),
	) {
		return
	}

	var html string
	switch mode {
	case "protyle-preview":
		html = model.MarkdownToProtylePreviewHTML(markdown)
	case "":
		html = model.MarkdownToMarkdownStrHTML(markdown)
	default:
		ret.Code = -1
		ret.Msg = "unknown [mode]"
		return
	}

	ret.Data = map[string]any{
		"html": html,
	}
}
