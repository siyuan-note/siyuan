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
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"strings"
	"sync"
	"text/template"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/lex"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/88250/vitess-sqlparser/sqlparser"
	"github.com/siyuan-note/logging"
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

func NodeStaticContent(node *ast.Node, excludeTypes []string, includeTextMarkATitleURL, includeAssetPath, fullAttrView bool) string {
	if nil == node {
		return ""
	}

	if ast.NodeDocument == node.Type {
		return node.IALAttr("title")
	}

	if ast.NodeAttributeView == node.Type {
		if fullAttrView {
			return getAttributeViewContent(node.AttributeViewID)
		}

		return getAttributeViewName(node.AttributeViewID)
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
				buf.WriteByte(' ')
				lastSpace = true
			}
			return ast.WalkContinue
		}

		if gulu.Str.Contains(n.Type.String(), excludeTypes) {
			return ast.WalkContinue
		}

		switch n.Type {
		case ast.NodeTableCell:
			// 表格块写入数据库表时在单元格之间添加空格 https://github.com/siyuan-note/siyuan/issues/7654
			if 0 < buf.Len() && ' ' != buf.Bytes()[buf.Len()-1] {
				buf.WriteByte(' ')
			}
		case ast.NodeImage:
			linkDest := n.ChildByType(ast.NodeLinkDest)
			var linkDestStr, ocrText string
			if nil != linkDest {
				linkDestStr = linkDest.TokensStr()
				ocrText = util.GetAssetText(linkDestStr, false)
			}

			linkText := n.ChildByType(ast.NodeLinkText)
			if nil != linkText {
				buf.Write(linkText.Tokens)
				buf.WriteByte(' ')
			}
			if "" != ocrText {
				buf.WriteString(ocrText)
				buf.WriteByte(' ')
			}
			if nil != linkDest {
				if !bytes.HasPrefix(linkDest.Tokens, []byte("assets/")) || includeAssetPath {
					buf.Write(linkDest.Tokens)
					buf.WriteByte(' ')
				}
			}
			if linkTitle := n.ChildByType(ast.NodeLinkTitle); nil != linkTitle {
				buf.Write(linkTitle.Tokens)
			}
			return ast.WalkSkipChildren
		case ast.NodeLinkText:
			buf.Write(n.Tokens)
			buf.WriteByte(' ')
		case ast.NodeLinkDest:
			buf.Write(n.Tokens)
			buf.WriteByte(' ')
		case ast.NodeLinkTitle:
			buf.Write(n.Tokens)
		case ast.NodeText, ast.NodeCodeBlockCode, ast.NodeMathBlockContent, ast.NodeHTMLBlock:
			tokens := n.Tokens
			if IsChartCodeBlockCode(n) {
				// 图表块的内容在数据库 `blocks` 表 `content` 字段中被转义 https://github.com/siyuan-note/siyuan/issues/6326
				tokens = html.UnescapeHTML(tokens)
			}
			buf.Write(tokens)
		case ast.NodeTextMark:
			for _, excludeType := range excludeTypes {
				if strings.HasPrefix(excludeType, "NodeTextMark-") {
					if n.IsTextMarkType(excludeType[len("NodeTextMark-"):]) {
						return ast.WalkContinue
					}
				}
			}

			if n.IsTextMarkType("tag") {
				buf.WriteByte('#')
			}
			buf.WriteString(n.Content())
			if n.IsTextMarkType("tag") {
				buf.WriteByte('#')
			}
			if n.IsTextMarkType("a") && includeTextMarkATitleURL {
				// 搜索不到超链接元素的 URL 和标题 https://github.com/siyuan-note/siyuan/issues/7352
				if "" != n.TextMarkATitle {
					buf.WriteString(" " + html.UnescapeHTMLStr(n.TextMarkATitle))
				}

				if !strings.HasPrefix(n.TextMarkAHref, "assets/") || includeAssetPath {
					buf.WriteString(" " + html.UnescapeHTMLStr(n.TextMarkAHref))
				}
			}
		case ast.NodeBackslash:
			buf.WriteByte(lex.ItemBackslash)
		case ast.NodeBackslashContent:
			buf.Write(n.Tokens)
		case ast.NodeAudio, ast.NodeVideo:
			buf.WriteString(GetNodeSrcTokens(n))
			buf.WriteByte(' ')
		}
		lastSpace = false
		return ast.WalkContinue
	})

	// 这里不要 trim，否则无法搜索首尾空格
	// Improve search and replace for spaces https://github.com/siyuan-note/siyuan/issues/10231
	return buf.String()
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

func GetAttributeViewName(avID string) (name string) {
	if "" == avID {
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	buf := bytes.Buffer{}
	for _, v := range attrView.Views {
		buf.WriteString(v.Name)
		buf.WriteByte(' ')
	}

	name = strings.TrimSpace(buf.String())
	return
}

func getAttributeViewName(avID string) (name string) {
	if "" == avID {
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	buf := bytes.Buffer{}
	buf.WriteString(attrView.Name)
	buf.WriteByte(' ')
	for _, v := range attrView.Views {
		buf.WriteString(v.Name)
		buf.WriteByte(' ')
	}
	name = strings.TrimSpace(buf.String())
	return
}

func getAttributeViewContent(avID string) (content string) {
	if "" == avID {
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	buf := bytes.Buffer{}
	buf.WriteString(attrView.Name)
	buf.WriteByte(' ')
	for _, v := range attrView.Views {
		buf.WriteString(v.Name)
		buf.WriteByte(' ')
	}

	if 1 > len(attrView.Views) {
		content = strings.TrimSpace(buf.String())
		return
	}

	var view *av.View
	for _, v := range attrView.Views {
		if av.LayoutTypeTable == v.LayoutType {
			view = v
			break
		}
	}
	if nil == view {
		content = strings.TrimSpace(buf.String())
		return
	}

	table, err := renderAttributeViewTable(attrView, view)
	if nil != err {
		content = strings.TrimSpace(buf.String())
		return
	}

	for _, col := range table.Columns {
		buf.WriteString(col.Name)
		buf.WriteByte(' ')
	}

	for _, row := range table.Rows {
		for _, cell := range row.Cells {
			if nil == cell.Value {
				continue
			}
			buf.WriteString(cell.Value.String())
			buf.WriteByte(' ')
		}
	}

	content = strings.TrimSpace(buf.String())
	return
}

func renderAttributeViewTable(attrView *av.AttributeView, view *av.View) (ret *av.Table, err error) {
	ret = &av.Table{
		ID:               view.ID,
		Icon:             view.Icon,
		Name:             view.Name,
		HideAttrViewName: view.HideAttrViewName,
		Columns:          []*av.TableColumn{},
		Rows:             []*av.TableRow{},
	}

	// 组装列
	for _, col := range view.Table.Columns {
		key, _ := attrView.GetKey(col.ID)
		if nil == key {
			continue
		}

		ret.Columns = append(ret.Columns, &av.TableColumn{
			ID:           key.ID,
			Name:         key.Name,
			Type:         key.Type,
			Icon:         key.Icon,
			Options:      key.Options,
			NumberFormat: key.NumberFormat,
			Template:     key.Template,
			Relation:     key.Relation,
			Rollup:       key.Rollup,
			Wrap:         col.Wrap,
			Hidden:       col.Hidden,
			Width:        col.Width,
			Pin:          col.Pin,
			Calc:         col.Calc,
		})
	}

	// 生成行
	rows := map[string][]*av.KeyValues{}
	for _, keyValues := range attrView.KeyValues {
		for _, val := range keyValues.Values {
			values := rows[val.BlockID]
			if nil == values {
				values = []*av.KeyValues{{Key: keyValues.Key, Values: []*av.Value{val}}}
			} else {
				values = append(values, &av.KeyValues{Key: keyValues.Key, Values: []*av.Value{val}})
			}
			rows[val.BlockID] = values
		}
	}

	// 过滤掉不存在的行
	var notFound []string
	for blockID, keyValues := range rows {
		blockValue := getRowBlockValue(keyValues)
		if nil == blockValue {
			notFound = append(notFound, blockID)
			continue
		}

		if blockValue.IsDetached {
			continue
		}

		if nil != blockValue.Block && "" == blockValue.Block.ID {
			notFound = append(notFound, blockID)
			continue
		}

		if GetBlockTree(blockID) == nil {
			notFound = append(notFound, blockID)
		}
	}
	for _, blockID := range notFound {
		delete(rows, blockID)
	}

	// 生成行单元格
	for rowID, row := range rows {
		var tableRow av.TableRow
		for _, col := range ret.Columns {
			var tableCell *av.TableCell
			for _, keyValues := range row {
				if keyValues.Key.ID == col.ID {
					tableCell = &av.TableCell{
						ID:        keyValues.Values[0].ID,
						Value:     keyValues.Values[0],
						ValueType: col.Type,
					}
					break
				}
			}
			if nil == tableCell {
				tableCell = &av.TableCell{
					ID:        ast.NewNodeID(),
					ValueType: col.Type,
				}
			}
			tableRow.ID = rowID

			switch tableCell.ValueType {
			case av.KeyTypeNumber: // 格式化数字
				if nil != tableCell.Value && nil != tableCell.Value.Number && tableCell.Value.Number.IsNotEmpty {
					tableCell.Value.Number.Format = col.NumberFormat
					tableCell.Value.Number.FormatNumber()
				}
			case av.KeyTypeTemplate: // 渲染模板列
				tableCell.Value = &av.Value{ID: tableCell.ID, KeyID: col.ID, BlockID: rowID, Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: col.Template}}
			case av.KeyTypeCreated: // 填充创建时间列值，后面再渲染
				tableCell.Value = &av.Value{ID: tableCell.ID, KeyID: col.ID, BlockID: rowID, Type: av.KeyTypeCreated}
			case av.KeyTypeUpdated: // 填充更新时间列值，后面再渲染
				tableCell.Value = &av.Value{ID: tableCell.ID, KeyID: col.ID, BlockID: rowID, Type: av.KeyTypeUpdated}
			case av.KeyTypeRelation: // 清空关联列值，后面再渲染 https://ld246.com/article/1703831044435
				if nil != tableCell.Value && nil != tableCell.Value.Relation {
					tableCell.Value.Relation.Contents = nil
				}
			}

			FillAttributeViewTableCellNilValue(tableCell, rowID, col.ID)

			tableRow.Cells = append(tableRow.Cells, tableCell)
		}
		ret.Rows = append(ret.Rows, &tableRow)
	}

	// 渲染自动生成的列值，比如关联列、汇总列、创建时间列和更新时间列
	for _, row := range ret.Rows {
		for _, cell := range row.Cells {
			switch cell.ValueType {
			case av.KeyTypeRollup: // 渲染汇总列
				rollupKey, _ := attrView.GetKey(cell.Value.KeyID)
				if nil == rollupKey || nil == rollupKey.Rollup {
					break
				}

				relKey, _ := attrView.GetKey(rollupKey.Rollup.RelationKeyID)
				if nil == relKey || nil == relKey.Relation {
					break
				}

				relVal := attrView.GetValue(relKey.ID, row.ID)
				if nil == relVal || nil == relVal.Relation {
					break
				}

				destAv, _ := av.ParseAttributeView(relKey.Relation.AvID)
				if nil == destAv {
					break
				}

				destKey, _ := destAv.GetKey(rollupKey.Rollup.KeyID)
				if nil == destKey {
					continue
				}

				for _, blockID := range relVal.Relation.BlockIDs {
					destVal := destAv.GetValue(rollupKey.Rollup.KeyID, blockID)
					if nil == destVal {
						continue
					}
					if av.KeyTypeNumber == destKey.Type {
						destVal.Number.Format = destKey.NumberFormat
						destVal.Number.FormatNumber()
					}

					cell.Value.Rollup.Contents = append(cell.Value.Rollup.Contents, destVal.Clone())
				}

				cell.Value.Rollup.RenderContents(rollupKey.Rollup.Calc, destKey)

				// 将汇总列的值保存到 rows 中，后续渲染模板列的时候会用到，下同
				// Database table view template columns support reading relation, rollup, created and updated columns https://github.com/siyuan-note/siyuan/issues/10442
				keyValues := rows[row.ID]
				keyValues = append(keyValues, &av.KeyValues{Key: rollupKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: rollupKey.ID, BlockID: row.ID, Type: av.KeyTypeRollup, Rollup: cell.Value.Rollup}}})
				rows[row.ID] = keyValues
			case av.KeyTypeRelation: // 渲染关联列
				relKey, _ := attrView.GetKey(cell.Value.KeyID)
				if nil != relKey && nil != relKey.Relation {
					destAv, _ := av.ParseAttributeView(relKey.Relation.AvID)
					if nil != destAv {
						blocks := map[string]*av.Value{}
						for _, blockValue := range destAv.GetBlockKeyValues().Values {
							blocks[blockValue.BlockID] = blockValue
						}
						for _, blockID := range cell.Value.Relation.BlockIDs {
							cell.Value.Relation.Contents = append(cell.Value.Relation.Contents, blocks[blockID])
						}
					}
				}
			case av.KeyTypeCreated: // 渲染创建时间
				createdStr := row.ID[:len("20060102150405")]
				created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
				if nil == parseErr {
					cell.Value.Created = av.NewFormattedValueCreated(created.UnixMilli(), 0, av.CreatedFormatNone)
					cell.Value.Created.IsNotEmpty = true
				} else {
					cell.Value.Created = av.NewFormattedValueCreated(time.Now().UnixMilli(), 0, av.CreatedFormatNone)
				}

				keyValues := rows[row.ID]
				createdKey, _ := attrView.GetKey(cell.Value.KeyID)
				keyValues = append(keyValues, &av.KeyValues{Key: createdKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: createdKey.ID, BlockID: row.ID, Type: av.KeyTypeCreated, Created: cell.Value.Created}}})
				rows[row.ID] = keyValues
			case av.KeyTypeUpdated: // 渲染更新时间
				ial := map[string]string{}
				block := row.GetBlockValue()
				if nil != block && !block.IsDetached {
					ial = cache.GetBlockIAL(row.ID)
					if nil == ial {
						ial = map[string]string{}
					}
				}
				updatedStr := ial["updated"]
				if "" == updatedStr && nil != block {
					cell.Value.Updated = av.NewFormattedValueUpdated(block.Block.Updated, 0, av.UpdatedFormatNone)
					cell.Value.Updated.IsNotEmpty = true
				} else {
					updated, parseErr := time.ParseInLocation("20060102150405", updatedStr, time.Local)
					if nil == parseErr {
						cell.Value.Updated = av.NewFormattedValueUpdated(updated.UnixMilli(), 0, av.UpdatedFormatNone)
						cell.Value.Updated.IsNotEmpty = true
					} else {
						cell.Value.Updated = av.NewFormattedValueUpdated(time.Now().UnixMilli(), 0, av.UpdatedFormatNone)
					}
				}

				keyValues := rows[row.ID]
				updatedKey, _ := attrView.GetKey(cell.Value.KeyID)
				keyValues = append(keyValues, &av.KeyValues{Key: updatedKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: updatedKey.ID, BlockID: row.ID, Type: av.KeyTypeUpdated, Updated: cell.Value.Updated}}})
				rows[row.ID] = keyValues
			}
		}
	}

	// 最后单独渲染模板列，这样模板列就可以使用汇总、关联、创建时间和更新时间列的值了
	// Database table view template columns support reading relation, rollup, created and updated columns https://github.com/siyuan-note/siyuan/issues/10442
	for _, row := range ret.Rows {
		for _, cell := range row.Cells {
			switch cell.ValueType {
			case av.KeyTypeTemplate: // 渲染模板列
				keyValues := rows[row.ID]
				ial := map[string]string{}
				block := row.GetBlockValue()
				if nil != block && !block.IsDetached {
					ial = cache.GetBlockIAL(row.ID)
					if nil == ial {
						ial = map[string]string{}
					}
				}
				content := renderTemplateCol(ial, keyValues, cell.Value.Template.Content)
				cell.Value.Template.Content = content
			}
		}
	}
	return
}

func FillAttributeViewTableCellNilValue(tableCell *av.TableCell, rowID, colID string) {
	if nil == tableCell.Value {
		tableCell.Value = GetAttributeViewDefaultValue(tableCell.ID, colID, rowID, tableCell.ValueType)
		return
	}

	tableCell.Value.Type = tableCell.ValueType
	switch tableCell.ValueType {
	case av.KeyTypeText:
		if nil == tableCell.Value.Text {
			tableCell.Value.Text = &av.ValueText{}
		}
	case av.KeyTypeNumber:
		if nil == tableCell.Value.Number {
			tableCell.Value.Number = &av.ValueNumber{}
		}
	case av.KeyTypeDate:
		if nil == tableCell.Value.Date {
			tableCell.Value.Date = &av.ValueDate{}
		}
	case av.KeyTypeSelect:
		if 1 > len(tableCell.Value.MSelect) {
			tableCell.Value.MSelect = []*av.ValueSelect{}
		}
	case av.KeyTypeMSelect:
		if 1 > len(tableCell.Value.MSelect) {
			tableCell.Value.MSelect = []*av.ValueSelect{}
		}
	case av.KeyTypeURL:
		if nil == tableCell.Value.URL {
			tableCell.Value.URL = &av.ValueURL{}
		}
	case av.KeyTypeEmail:
		if nil == tableCell.Value.Email {
			tableCell.Value.Email = &av.ValueEmail{}
		}
	case av.KeyTypePhone:
		if nil == tableCell.Value.Phone {
			tableCell.Value.Phone = &av.ValuePhone{}
		}
	case av.KeyTypeMAsset:
		if 1 > len(tableCell.Value.MAsset) {
			tableCell.Value.MAsset = []*av.ValueAsset{}
		}
	case av.KeyTypeTemplate:
		if nil == tableCell.Value.Template {
			tableCell.Value.Template = &av.ValueTemplate{}
		}
	case av.KeyTypeCreated:
		if nil == tableCell.Value.Created {
			tableCell.Value.Created = &av.ValueCreated{}
		}
	case av.KeyTypeUpdated:
		if nil == tableCell.Value.Updated {
			tableCell.Value.Updated = &av.ValueUpdated{}
		}
	case av.KeyTypeCheckbox:
		if nil == tableCell.Value.Checkbox {
			tableCell.Value.Checkbox = &av.ValueCheckbox{}
		}
	case av.KeyTypeRelation:
		if nil == tableCell.Value.Relation {
			tableCell.Value.Relation = &av.ValueRelation{}
		}
	case av.KeyTypeRollup:
		if nil == tableCell.Value.Rollup {
			tableCell.Value.Rollup = &av.ValueRollup{}
		}
	}
}

func GetAttributeViewDefaultValue(valueID, keyID, blockID string, typ av.KeyType) (ret *av.Value) {
	if "" == valueID {
		valueID = ast.NewNodeID()
	}

	ret = &av.Value{ID: valueID, KeyID: keyID, BlockID: blockID, Type: typ}

	createdStr := valueID[:len("20060102150405")]
	created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
	if nil == parseErr {
		ret.CreatedAt = created.UnixMilli()
	} else {
		ret.CreatedAt = time.Now().UnixMilli()
	}
	if 0 == ret.UpdatedAt {
		ret.UpdatedAt = ret.CreatedAt
	}

	switch typ {
	case av.KeyTypeText:
		ret.Text = &av.ValueText{}
	case av.KeyTypeNumber:
		ret.Number = &av.ValueNumber{}
	case av.KeyTypeDate:
		ret.Date = &av.ValueDate{}
	case av.KeyTypeSelect:
		ret.MSelect = []*av.ValueSelect{}
	case av.KeyTypeMSelect:
		ret.MSelect = []*av.ValueSelect{}
	case av.KeyTypeURL:
		ret.URL = &av.ValueURL{}
	case av.KeyTypeEmail:
		ret.Email = &av.ValueEmail{}
	case av.KeyTypePhone:
		ret.Phone = &av.ValuePhone{}
	case av.KeyTypeMAsset:
		ret.MAsset = []*av.ValueAsset{}
	case av.KeyTypeTemplate:
		ret.Template = &av.ValueTemplate{}
	case av.KeyTypeCreated:
		ret.Created = &av.ValueCreated{}
	case av.KeyTypeUpdated:
		ret.Updated = &av.ValueUpdated{}
	case av.KeyTypeCheckbox:
		ret.Checkbox = &av.ValueCheckbox{}
	case av.KeyTypeRelation:
		ret.Relation = &av.ValueRelation{}
	case av.KeyTypeRollup:
		ret.Rollup = &av.ValueRollup{}
	}
	return
}

func renderTemplateCol(ial map[string]string, rowValues []*av.KeyValues, tplContent string) string {
	if "" == ial["id"] {
		block := getRowBlockValue(rowValues)
		ial["id"] = block.Block.ID
	}
	if "" == ial["updated"] {
		block := getRowBlockValue(rowValues)
		ial["updated"] = time.UnixMilli(block.Block.Updated).Format("20060102150405")
	}

	goTpl := template.New("").Delims(".action{", "}")
	tplFuncMap := util.BuiltInTemplateFuncs()
	// 这里存在依赖问题所以不支持 SQLTemplateFuncs(&tplFuncMap)
	goTpl = goTpl.Funcs(tplFuncMap)
	tpl, tplErr := goTpl.Funcs(tplFuncMap).Parse(tplContent)
	if nil != tplErr {
		logging.LogWarnf("parse template [%s] failed: %s", tplContent, tplErr)
		return ""
	}

	buf := &bytes.Buffer{}
	dataModel := map[string]interface{}{} // 复制一份 IAL 以避免修改原始数据
	for k, v := range ial {
		dataModel[k] = v

		// Database template column supports `created` and `updated` built-in variables https://github.com/siyuan-note/siyuan/issues/9364
		createdStr := ial["id"]
		if "" != createdStr {
			createdStr = createdStr[:len("20060102150405")]
		}
		created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
		if nil == parseErr {
			dataModel["created"] = created
		} else {
			logging.LogWarnf("parse created [%s] failed: %s", createdStr, parseErr)
			dataModel["created"] = time.Now()
		}
		updatedStr := ial["updated"]
		updated, parseErr := time.ParseInLocation("20060102150405", updatedStr, time.Local)
		if nil == parseErr {
			dataModel["updated"] = updated
		} else {
			dataModel["updated"] = time.Now()
		}
	}

	for _, rowValue := range rowValues {
		if 0 < len(rowValue.Values) {
			v := rowValue.Values[0]
			if av.KeyTypeNumber == v.Type {
				dataModel[rowValue.Key.Name] = v.Number.Content
			} else if av.KeyTypeDate == v.Type {
				dataModel[rowValue.Key.Name] = time.UnixMilli(v.Date.Content)
			} else {
				dataModel[rowValue.Key.Name] = v.String()
			}
		}
	}

	if err := tpl.Execute(buf, dataModel); nil != err {
		logging.LogWarnf("execute template [%s] failed: %s", tplContent, err)
	}
	return buf.String()
}

func getRowBlockValue(keyValues []*av.KeyValues) (ret *av.Value) {
	for _, kv := range keyValues {
		if av.KeyTypeBlock == kv.Key.Type && 0 < len(kv.Values) {
			ret = kv.Values[0]
			break
		}
	}
	return
}
