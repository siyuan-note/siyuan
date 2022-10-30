// SiYuan - Build Your Eternal Digital Garden
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

package treenode

import (
	"bytes"
	"strings"
	"sync"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/lex"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/88250/lute/util"
	"github.com/siyuan-note/logging"
)

func GetBlockRef(n *ast.Node) (blockRefID, blockRefText, blockRefSubtype string) {
	if !IsBlockRef(n) {
		return
	}
	if ast.NodeBlockRef == n.Type {
		id := n.ChildByType(ast.NodeBlockRefID)
		if nil == id {
			return
		}
		blockRefID = id.TokensStr()
		text := n.ChildByType(ast.NodeBlockRefText)
		if nil != text {
			blockRefText = text.Text()
			blockRefSubtype = "s"
			return
		}
		text = n.ChildByType(ast.NodeBlockRefDynamicText)
		if nil != text {
			blockRefText = text.Text()
			blockRefSubtype = "d"
			return
		}
	}
	if ast.NodeTextMark == n.Type {
		blockRefID = n.TextMarkBlockRefID
		blockRefText = n.TextMarkTextContent
		blockRefSubtype = n.TextMarkBlockRefSubtype
	}
	return
}

func IsBlockRef(n *ast.Node) bool {
	if nil == n {
		return false
	}
	if ast.NodeBlockRef == n.Type {
		return true
	}
	if ast.NodeTextMark == n.Type {
		return n.IsTextMarkType("block-ref")
	}
	return false
}

func NodeStaticMdContent(node *ast.Node, luteEngine *lute.Lute) (md, content string) {
	md = ExportNodeStdMd(node, luteEngine)
	content = NodeStaticContent(node)
	return
}

func FormatNode(node *ast.Node, luteEngine *lute.Lute) string {
	markdown, err := lute.FormatNodeSync(node, luteEngine.ParseOptions, luteEngine.RenderOptions)
	if nil != err {
		root := TreeRoot(node)
		logging.LogFatalf("format node [%s] in tree [%s] failed: %s", node.ID, root.ID, err)
	}
	return markdown
}

func ExportNodeStdMd(node *ast.Node, luteEngine *lute.Lute) string {
	markdown, err := lute.ProtyleExportMdNodeSync(node, luteEngine.ParseOptions, luteEngine.RenderOptions)
	if nil != err {
		root := TreeRoot(node)
		logging.LogFatalf("export markdown for node [%s] in tree [%s] failed: %s", node.ID, root.ID, err)
	}
	return markdown
}

func NodeStaticContent(node *ast.Node) string {
	if nil == node {
		return ""
	}

	if ast.NodeDocument == node.Type {
		return node.IALAttr("title")
	}

	buf := bytes.Buffer{}
	buf.Grow(4096)
	lastSpace := false
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if n.IsContainerBlock() {
			if !lastSpace {
				buf.WriteString(" ")
				lastSpace = true
			}
			return ast.WalkContinue
		}

		switch n.Type {
		case ast.NodeTagOpenMarker, ast.NodeTagCloseMarker:
			buf.WriteByte('#')
		case ast.NodeBlockRef:
			buf.WriteString(GetDynamicBlockRefText(n))
			lastSpace = false
			return ast.WalkSkipChildren
		case ast.NodeLinkText:
			buf.Write(n.Tokens)
			buf.WriteByte(' ')
		case ast.NodeLinkDest:
			buf.Write(n.Tokens)
			buf.WriteByte(' ')
		case ast.NodeLinkTitle:
			buf.Write(n.Tokens)
		case ast.NodeText, ast.NodeFileAnnotationRefText, ast.NodeFootnotesRef,
			ast.NodeCodeSpanContent, ast.NodeInlineMathContent, ast.NodeCodeBlockCode, ast.NodeMathBlockContent, ast.NodeHTMLBlock:
			tokens := n.Tokens
			if IsChartCodeBlockCode(n) {
				// 图表块的内容在数据库 `blocks` 表 `content` 字段中被转义 https://github.com/siyuan-note/siyuan/issues/6326
				tokens = html.UnescapeHTML(tokens)
			}
			buf.Write(tokens)
		case ast.NodeTextMark:
			if n.IsTextMarkType("tag") {
				buf.WriteByte('#')
			}
			buf.WriteString(n.Content())
			if n.IsTextMarkType("tag") {
				buf.WriteByte('#')
			}
		case ast.NodeBackslash:
			buf.WriteByte(lex.ItemBackslash)
		case ast.NodeBackslashContent:
			buf.Write(n.Tokens)
		}
		lastSpace = false
		return ast.WalkContinue
	})
	return strings.TrimSpace(buf.String())
}

func FirstLeafBlock(node *ast.Node) (ret *ast.Node) {
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || n.IsMarker() {
			return ast.WalkContinue
		}

		if !n.IsContainerBlock() {
			ret = n
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return
}

func CountBlockNodes(node *ast.Node) (ret int) {
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() || ast.NodeList == n.Type || ast.NodeBlockquote == n.Type || ast.NodeSuperBlock == n.Type {
			return ast.WalkContinue
		}

		if "1" == n.IALAttr("fold") {
			ret++
			return ast.WalkSkipChildren
		}

		ret++
		return ast.WalkContinue
	})
	return
}

func ParentNodes(node *ast.Node) (parents []*ast.Node) {
	const maxDepth = 256
	i := 0
	for n := node.Parent; nil != n; n = n.Parent {
		i++
		parents = append(parents, n)
		if ast.NodeDocument == n.Type {
			return
		}
		if maxDepth < i {
			logging.LogWarnf("parent nodes of node [%s] is too deep", node.ID)
			return
		}
	}
	return
}

func ParentBlock(node *ast.Node) *ast.Node {
	for p := node.Parent; nil != p; p = p.Parent {
		if "" != p.ID && p.IsBlock() {
			return p
		}
	}
	return nil
}

func GetNodeInTree(tree *parse.Tree, id string) (ret *ast.Node) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if id == n.ID {
			ret = n
			ret.Box = tree.Box
			ret.Path = tree.Path
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return
}

func GetDocTitleImgPath(root *ast.Node) (ret string) {
	if nil == root {
		return
	}

	const background = "background-image: url("
	titleImg := root.IALAttr("title-img")
	titleImg = strings.TrimSpace(titleImg)
	titleImg = html.UnescapeString(titleImg)
	titleImg = strings.ReplaceAll(titleImg, "background-image:url(", background)
	if !strings.Contains(titleImg, background) {
		return
	}

	start := strings.Index(titleImg, background) + len(background)
	end := strings.LastIndex(titleImg, ")")
	ret = titleImg[start:end]
	ret = strings.TrimPrefix(ret, "\"")
	ret = strings.TrimPrefix(ret, "'")
	ret = strings.TrimSuffix(ret, "\"")
	ret = strings.TrimSuffix(ret, "'")
	return ret
}

var typeAbbrMap = map[string]string{
	// 块级元素
	"NodeDocument":         "d",
	"NodeHeading":          "h",
	"NodeList":             "l",
	"NodeListItem":         "i",
	"NodeCodeBlock":        "c",
	"NodeMathBlock":        "m",
	"NodeTable":            "t",
	"NodeBlockquote":       "b",
	"NodeSuperBlock":       "s",
	"NodeParagraph":        "p",
	"NodeHTMLBlock":        "html",
	"NodeBlockQueryEmbed":  "query_embed",
	"NodeKramdownBlockIAL": "ial",
	"NodeIFrame":           "iframe",
	"NodeWidget":           "widget",
	"NodeThematicBreak":    "tb",
	"NodeVideo":            "video",
	"NodeAudio":            "audio",
	// 行级元素
	"NodeText":          "text",
	"NodeImage":         "img",
	"NodeLinkText":      "link_text",
	"NodeLinkDest":      "link_dest",
	"NodeTag":           "tag",
	"NodeCodeSpan":      "code_span",
	"NodeInlineMath":    "inline_math",
	"NodeBlockRefID":    "ref_id",
	"NodeEmphasis":      "em",
	"NodeStrong":        "strong",
	"NodeStrikethrough": "strikethrough",
	"NodeMark":          "mark",
	"NodeSup":           "sup",
	"NodeSub":           "sub",
	"NodeKbd":           "kbd",
	"NodeUnderline":     "underline",
	"NodeTextMark":      "textmark",
}

var abbrTypeMap = map[string]string{}

func init() {
	for typ, abbr := range typeAbbrMap {
		abbrTypeMap[abbr] = typ
	}
}

func TypeAbbr(nodeType string) string {
	return typeAbbrMap[nodeType]
}

func FromAbbrType(abbrType string) string {
	return abbrTypeMap[abbrType]
}

func SubTypeAbbr(n *ast.Node) string {
	switch n.Type {
	case ast.NodeList, ast.NodeListItem:
		if 0 == n.ListData.Typ {
			return "u"
		}
		if 1 == n.ListData.Typ {
			return "o"
		}
		if 3 == n.ListData.Typ {
			return "t"
		}
	case ast.NodeHeading:
		if 1 == n.HeadingLevel {
			return "h1"
		}
		if 2 == n.HeadingLevel {
			return "h2"
		}
		if 3 == n.HeadingLevel {
			return "h3"
		}
		if 4 == n.HeadingLevel {
			return "h4"
		}
		if 5 == n.HeadingLevel {
			return "h5"
		}
		if 6 == n.HeadingLevel {
			return "h6"
		}
	}
	return ""
}

func GetLegacyDynamicBlockRefDefIDs(node *ast.Node) (ret []string) {
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if ast.NodeBlockRefID == n.Type && ast.NodeCloseParen == n.Next.Type {
			ret = append(ret, n.TokensStr())
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
	return
}

var DynamicRefTexts = sync.Map{}

func SetDynamicBlockRefText(blockRef *ast.Node, refText string) {
	if !IsBlockRef(blockRef) {
		return
	}

	if ast.NodeBlockRef == blockRef.Type {
		idNode := blockRef.ChildByType(ast.NodeBlockRefID)
		if nil == idNode {
			return
		}

		var spacesRefTexts []*ast.Node // 可能会有多个空格，或者遗留错误插入的锚文本节点，这里做一次订正
		for n := idNode.Next; ast.NodeCloseParen != n.Type; n = n.Next {
			spacesRefTexts = append(spacesRefTexts, n)
		}
		for _, toRemove := range spacesRefTexts {
			toRemove.Unlink()
		}
		refText = strings.TrimSpace(refText)
		idNode.InsertAfter(&ast.Node{Type: ast.NodeBlockRefDynamicText, Tokens: []byte(refText)})
		idNode.InsertAfter(&ast.Node{Type: ast.NodeBlockRefSpace})
		return
	}

	blockRef.TextMarkBlockRefSubtype = "d"
	blockRef.TextMarkTextContent = refText

	// 偶发编辑文档标题后引用处的动态锚文本不更新 https://github.com/siyuan-note/siyuan/issues/5891
	DynamicRefTexts.Store(blockRef.TextMarkBlockRefID, refText)
}

func GetDynamicBlockRefText(blockRef *ast.Node) string {
	refText := blockRef.ChildByType(ast.NodeBlockRefText)
	if nil != refText {
		return refText.Text()
	}
	refText = blockRef.ChildByType(ast.NodeBlockRefDynamicText)
	if nil != refText {
		return refText.Text()
	}
	return "ref resolve failed"
}

func IsChartCodeBlockCode(code *ast.Node) bool {
	if nil == code.Previous || ast.NodeCodeBlockFenceInfoMarker != code.Previous.Type || 1 > len(code.Previous.CodeBlockInfo) {
		return false
	}

	language := util.BytesToStr(code.Previous.CodeBlockInfo)
	language = strings.ReplaceAll(language, editor.Caret, "")
	return render.NoHighlight(language)
}
