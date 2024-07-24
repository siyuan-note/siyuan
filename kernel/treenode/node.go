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

package treenode

import (
	"bytes"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/88250/vitess-sqlparser/sqlparser"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func GetEmbedBlockRef(embedNode *ast.Node) (blockRefID string) {
	if nil == embedNode || ast.NodeBlockQueryEmbed != embedNode.Type {
		return
	}

	scriptNode := embedNode.ChildByType(ast.NodeBlockQueryEmbedScript)
	if nil == scriptNode {
		return
	}

	stmt := scriptNode.TokensStr()
	parsedStmt, err := sqlparser.Parse(stmt)
	if nil != err {
		return
	}

	switch parsedStmt.(type) {
	case *sqlparser.Select:
		slct := parsedStmt.(*sqlparser.Select)
		if nil == slct.Where || nil == slct.Where.Expr {
			return
		}

		switch slct.Where.Expr.(type) {
		case *sqlparser.ComparisonExpr: // WHERE id = '20060102150405-1a2b3c4'
			comp := slct.Where.Expr.(*sqlparser.ComparisonExpr)
			switch comp.Left.(type) {
			case *sqlparser.ColName:
				col := comp.Left.(*sqlparser.ColName)
				if nil == col || "id" != col.Name.Lowered() {
					return
				}
			}
			switch comp.Right.(type) {
			case *sqlparser.SQLVal:
				val := comp.Right.(*sqlparser.SQLVal)
				if nil == val || sqlparser.StrVal != val.Type {
					return
				}

				idVal := string(val.Val)
				if !ast.IsNodeIDPattern(idVal) {
					return
				}
				blockRefID = idVal
			}
		}
	}
	return
}

func GetBlockRef(n *ast.Node) (blockRefID, blockRefText, blockRefSubtype string) {
	if !IsBlockRef(n) {
		return
	}

	blockRefID = n.TextMarkBlockRefID
	blockRefText = n.TextMarkTextContent
	blockRefSubtype = n.TextMarkBlockRefSubtype
	return
}

func IsBlockRef(n *ast.Node) bool {
	if nil == n {
		return false
	}
	return ast.NodeTextMark == n.Type && n.IsTextMarkType("block-ref")
}

func IsFileAnnotationRef(n *ast.Node) bool {
	if nil == n {
		return false
	}
	return ast.NodeTextMark == n.Type && n.IsTextMarkType("file-annotation-ref")
}

func IsEmbedBlockRef(n *ast.Node) bool {
	return "" != GetEmbedBlockRef(n)
}

func FormatNode(node *ast.Node, luteEngine *lute.Lute) string {
	markdown, err := lute.FormatNodeSync(node, luteEngine.ParseOptions, luteEngine.RenderOptions)
	if nil != err {
		root := TreeRoot(node)
		logging.LogFatalf(logging.ExitCodeFatal, "format node [%s] in tree [%s] failed: %s", node.ID, root.ID, err)
	}
	return markdown
}

func ExportNodeStdMd(node *ast.Node, luteEngine *lute.Lute) string {
	markdown, err := lute.ProtyleExportMdNodeSync(node, luteEngine.ParseOptions, luteEngine.RenderOptions)
	if nil != err {
		root := TreeRoot(node)
		logging.LogFatalf(logging.ExitCodeFatal, "export markdown for node [%s] in tree [%s] failed: %s", node.ID, root.ID, err)
	}
	return markdown
}

func IsNodeOCRed(node *ast.Node) (ret bool) {
	if !util.TesseractEnabled || nil == node {
		return true
	}

	ret = true
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeImage == n.Type {
			linkDest := n.ChildByType(ast.NodeLinkDest)
			if nil == linkDest {
				return ast.WalkContinue
			}

			linkDestStr := linkDest.TokensStr()
			if !cache.ExistAsset(linkDestStr) {
				return ast.WalkContinue
			}

			if !util.ExistsAssetText(linkDestStr) {
				ret = false
				return ast.WalkStop
			}
		}
		return ast.WalkContinue
	})
	return
}

func GetNodeSrcTokens(n *ast.Node) (ret string) {
	if index := bytes.Index(n.Tokens, []byte("src=\"")); 0 < index {
		src := n.Tokens[index+len("src=\""):]
		if index = bytes.Index(src, []byte("\"")); 0 < index {
			src = src[:bytes.Index(src, []byte("\""))]
			if !IsRelativePath(src) {
				return
			}

			ret = strings.TrimSpace(string(src))
			return
		}

		logging.LogWarnf("src is missing the closing double quote in tree [%s] ", n.Box+n.Path)
	}
	return
}

func IsRelativePath(dest []byte) bool {
	if 1 > len(dest) {
		return false
	}
	if '/' == dest[0] {
		return false
	}
	return !bytes.Contains(dest, []byte(":"))
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

// ParentNodesWithHeadings 返回所有父级节点。
// 注意:返回的父级节点包括了标题节点，并且不保证父级层次顺序。
func ParentNodesWithHeadings(node *ast.Node) (parents []*ast.Node) {
	const maxDepth = 255
	i := 0
	for n := node; nil != n; n = n.Parent {
		parent := n.Parent
		if maxDepth < i {
			logging.LogWarnf("parent nodes of node [%s] is too deep", node.ID)
			return
		}
		i++

		if nil == parent {
			return
		}

		// 标题下方块编辑后刷新标题块更新时间
		// The heading block update time is refreshed after editing the blocks under the heading https://github.com/siyuan-note/siyuan/issues/11374
		parentHeadingLevel := 7
		if ast.NodeHeading == n.Type {
			parentHeadingLevel = n.HeadingLevel
		}
		for prev := n.Previous; nil != prev; prev = prev.Previous {
			if ast.NodeHeading == prev.Type {
				if prev.HeadingLevel >= parentHeadingLevel {
					break
				}

				parents = append(parents, prev)
				parentHeadingLevel = prev.HeadingLevel
			}
		}

		parents = append(parents, parent)
		if ast.NodeDocument == parent.Type {
			return
		}
	}
	return
}

func ChildBlockNodes(node *ast.Node) (children []*ast.Node) {
	children = []*ast.Node{}
	if !node.IsContainerBlock() || ast.NodeDocument == node.Type {
		children = append(children, node)
		return
	}

	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() {
			return ast.WalkContinue
		}

		children = append(children, n)
		return ast.WalkContinue
	})
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

func PreviousBlock(node *ast.Node) *ast.Node {
	for n := node.Previous; nil != n; n = n.Previous {
		if "" != n.ID && n.IsBlock() {
			return n
		}
	}
	return nil
}

func NextBlock(node *ast.Node) *ast.Node {
	for n := node.Next; nil != n; n = n.Next {
		if "" != n.ID && n.IsBlock() {
			return n
		}
	}
	return nil
}

func FirstChildBlock(node *ast.Node) (ret *ast.Node) {
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if n.IsBlock() {
			ret = n
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return
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
	"NodeAttributeView":    "av",
	"NodeKramdownBlockIAL": "ial",
	"NodeIFrame":           "iframe",
	"NodeWidget":           "widget",
	"NodeThematicBreak":    "tb",
	"NodeVideo":            "video",
	"NodeAudio":            "audio",
	// 行级元素
	"NodeText":     "text",
	"NodeImage":    "img",
	"NodeLinkText": "link_text",
	"NodeLinkDest": "link_dest",
	"NodeTextMark": "textmark",
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

var DynamicRefTexts = sync.Map{}

func SetDynamicBlockRefText(blockRef *ast.Node, refText string) {
	if !IsBlockRef(blockRef) {
		return
	}

	blockRef.TextMarkBlockRefSubtype = "d"
	blockRef.TextMarkTextContent = refText

	// 偶发编辑文档标题后引用处的动态锚文本不更新 https://github.com/siyuan-note/siyuan/issues/5891
	DynamicRefTexts.Store(blockRef.TextMarkBlockRefID, refText)
}

func IsChartCodeBlockCode(code *ast.Node) bool {
	if nil == code.Previous || ast.NodeCodeBlockFenceInfoMarker != code.Previous.Type || 1 > len(code.Previous.CodeBlockInfo) {
		return false
	}

	language := gulu.Str.FromBytes(code.Previous.CodeBlockInfo)
	language = strings.ReplaceAll(language, editor.Caret, "")
	return render.NoHighlight(language)
}
