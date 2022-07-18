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

package model

import (
	"bytes"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type GraphNode struct {
	ID    string          `json:"id"`
	Box   string          `json:"box"`
	Path  string          `json:"path"`
	Size  float64         `json:"size"`
	Title string          `json:"title,omitempty"`
	Label string          `json:"label"`
	Type  string          `json:"type"`
	Refs  int             `json:"refs"`
	Defs  int             `json:"defs"`
	Color *GraphNodeColor `json:"color"`
}

type GraphNodeColor struct {
	Background string `json:"background"`
}

type GraphLink struct {
	From   string          `json:"from"`
	To     string          `json:"to"`
	Ref    bool            `json:"-"`
	Color  *GraphLinkColor `json:"color"`
	Arrows *GraphArrows    `json:"arrows"`
}

type GraphLinkColor struct {
	Color string `json:"color"`
}

type GraphArrows struct {
	To *GraphArrowsTo `json:"to"`
}

type GraphArrowsTo struct {
	Enabled bool `json:"enabled"`
}

func BuildTreeGraph(id, query string) (boxID string, nodes []*GraphNode, links []*GraphLink) {
	nodes = []*GraphNode{}
	links = []*GraphLink{}

	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return
	}
	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}
	sqlBlock := sql.BuildBlockFromNode(node, tree)
	boxID = sqlBlock.Box
	block := fromSQLBlock(sqlBlock, "", 0)

	stmt := query2Stmt(query)
	stmt += graphTypeFilter(true)
	stmt += graphDailyNoteFilter(true)
	stmt = strings.ReplaceAll(stmt, "content", "ref.content")
	forwardlinks, backlinks := buildFullLinks(stmt)

	var sqlBlocks []*sql.Block
	var rootID string
	if "NodeDocument" == block.Type {
		sqlBlocks = sql.GetAllChildBlocks(block.ID, stmt)
		rootID = block.ID
	} else {
		sqlBlocks = sql.GetChildBlocks(block.ID, stmt)
	}
	blocks := fromSQLBlocks(&sqlBlocks, "", 0)
	if "" != rootID {
		// 局部关系图中添加文档链接关系 https://github.com/siyuan-note/siyuan/issues/4996
		rootBlock := getBlockIn(blocks, rootID)
		if nil != rootBlock {
			// 按引用处理
			sqlRootDefs := sql.QueryDefRootBlocksByRefRootID(rootID)
			for _, sqlRootDef := range sqlRootDefs {
				rootDef := fromSQLBlock(sqlRootDef, "", 0)
				blocks = append(blocks, rootDef)

				sqlRootRefs := sql.QueryRefRootBlocksByDefRootID(sqlRootDef.ID)
				rootRefs := fromSQLBlocks(&sqlRootRefs, "", 0)
				rootDef.Refs = append(rootDef.Refs, rootRefs...)
			}

			// 按定义处理
			sqlRootRefs := sql.QueryRefRootBlocksByDefRootID(rootID)
			for _, sqlRootRef := range sqlRootRefs {
				rootRef := fromSQLBlock(sqlRootRef, "", 0)
				blocks = append(blocks, rootRef)

				rootBlock.Refs = append(rootBlock.Refs, rootRef)
			}
		}
	}
	style := graphStyle(true)
	genTreeNodes(blocks, &nodes, &links, true, style)
	growTreeGraph(&forwardlinks, &backlinks, &nodes)
	blocks = append(blocks, forwardlinks...)
	blocks = append(blocks, backlinks...)
	buildLinks(&blocks, &links, style, true)
	if Conf.Graph.Local.Tag {
		p := sqlBlock.Path
		linkTagBlocks(&blocks, &nodes, &links, p, style)
	}
	markLinkedNodes(&nodes, &links, true)
	nodes = removeDuplicatedUnescape(nodes)
	return
}

func BuildGraph(query string) (boxID string, nodes []*GraphNode, links []*GraphLink) {
	nodes = []*GraphNode{}
	links = []*GraphLink{}

	stmt := query2Stmt(query)
	stmt = strings.TrimPrefix(stmt, "select * from blocks where")
	stmt += graphTypeFilter(false)
	stmt += graphDailyNoteFilter(false)
	stmt = strings.ReplaceAll(stmt, "content", "ref.content")
	forwardlinks, backlinks := buildFullLinks(stmt)

	var blocks []*Block
	roots := sql.GetAllRootBlocks()
	style := graphStyle(false)
	if 0 < len(roots) {
		boxID = roots[0].Box
	}
	for _, root := range roots {
		sqlBlocks := sql.GetAllChildBlocks(root.ID, stmt)
		treeBlocks := fromSQLBlocks(&sqlBlocks, "", 0)
		genTreeNodes(treeBlocks, &nodes, &links, false, style)
		blocks = append(blocks, treeBlocks...)

		// 文档块关联
		rootBlock := getBlockIn(treeBlocks, root.ID)
		if nil == rootBlock {
			continue
		}

		sqlRootRefs := sql.QueryRefRootBlocksByDefRootID(root.ID)
		rootRefs := fromSQLBlocks(&sqlRootRefs, "", 0)
		rootBlock.Refs = append(rootBlock.Refs, rootRefs...)
	}
	growTreeGraph(&forwardlinks, &backlinks, &nodes)
	blocks = append(blocks, forwardlinks...)
	blocks = append(blocks, backlinks...)
	buildLinks(&blocks, &links, style, false)
	if Conf.Graph.Global.Tag {
		linkTagBlocks(&blocks, &nodes, &links, "", style)
	}
	markLinkedNodes(&nodes, &links, false)
	pruneUnref(&nodes, &links)
	nodes = removeDuplicatedUnescape(nodes)
	return
}

func linkTagBlocks(blocks *[]*Block, nodes *[]*GraphNode, links *[]*GraphLink, p string, style map[string]string) {
	tagSpans := sql.QueryTagSpans(p, 1024)
	if 1 > len(tagSpans) {
		return
	}

	isGlobal := "" == p
	nodeSize := Conf.Graph.Global.NodeSize
	if !isGlobal {
		nodeSize = Conf.Graph.Local.NodeSize
	}

	// 构造标签节点
	var tagNodes []*GraphNode
	for _, tagSpan := range tagSpans {
		if nil == tagNodeIn(tagNodes, tagSpan.Content) {
			node := &GraphNode{
				ID:    tagSpan.Content,
				Label: tagSpan.Content,
				Size:  nodeSize,
				Type:  tagSpan.Type,
				Color: &GraphNodeColor{Background: style["--b3-graph-tag-point"]},
			}
			*nodes = append(*nodes, node)
			tagNodes = append(tagNodes, node)
		}
	}

	// 连接标签和块
	for _, block := range *blocks {
		for _, tagSpan := range tagSpans {
			if isGlobal { // 全局关系图将标签链接到文档块上
				if block.RootID == tagSpan.RootID { // 局部关系图将标签链接到子块上
					*links = append(*links, &GraphLink{
						From:  tagSpan.Content,
						To:    block.RootID,
						Color: &GraphLinkColor{Color: style["--b3-graph-tag-line"]},
					})
				}
			} else {
				if block.ID == tagSpan.BlockID { // 局部关系图将标签链接到子块上
					*links = append(*links, &GraphLink{
						From:  tagSpan.Content,
						To:    block.ID,
						Color: &GraphLinkColor{Color: style["--b3-graph-tag-line"]},
					})
				}
			}
		}
	}

	// 连接层级标签
	for _, tagNode := range tagNodes {
		ids := strings.Split(tagNode.ID, "/")
		if 2 > len(ids) {
			continue
		}

		for _, targetID := range ids[:len(ids)-1] {
			if targetTag := tagNodeIn(tagNodes, targetID); nil != targetTag {

				*links = append(*links, &GraphLink{
					From:  tagNode.ID,
					To:    targetID,
					Color: &GraphLinkColor{Color: style["--b3-graph-tag-tag-line"]},
				})
			}
		}
	}
}

func tagNodeIn(tagNodes []*GraphNode, content string) *GraphNode {
	for _, tagNode := range tagNodes {
		if tagNode.Label == content {
			return tagNode
		}
	}
	return nil
}

func growTreeGraph(forwardlinks, backlinks *[]*Block, nodes *[]*GraphNode) {
	forwardDepth, backDepth := 0, 0
	growLinkedNodes(forwardlinks, backlinks, nodes, nodes, &forwardDepth, &backDepth)
}

func growLinkedNodes(forwardlinks, backlinks *[]*Block, nodes, all *[]*GraphNode, forwardDepth, backDepth *int) {
	if 1 > len(*nodes) {
		return
	}

	forwardGeneration := &[]*GraphNode{}
	if 16 > *forwardDepth {
		for _, ref := range *forwardlinks {
			for _, node := range *nodes {
				if node.ID == ref.ID {
					var defs []*Block
					for _, refDef := range ref.Defs {
						if existNodes(all, refDef.ID) || existNodes(forwardGeneration, refDef.ID) || existNodes(nodes, refDef.ID) {
							continue
						}
						defs = append(defs, refDef)
					}

					for _, refDef := range defs {
						defNode := &GraphNode{
							ID:   refDef.ID,
							Box:  refDef.Box,
							Path: refDef.Path,
							Size: Conf.Graph.Local.NodeSize,
							Type: refDef.Type,
						}
						nodeTitleLabel(defNode, nodeContentByBlock(refDef))
						*forwardGeneration = append(*forwardGeneration, defNode)
					}
				}
			}
		}
	}

	backGeneration := &[]*GraphNode{}
	if 16 > *backDepth {
		for _, def := range *backlinks {
			for _, node := range *nodes {
				if node.ID == def.ID {
					for _, ref := range def.Refs {
						if existNodes(all, ref.ID) || existNodes(backGeneration, ref.ID) || existNodes(nodes, ref.ID) {
							continue
						}

						refNode := &GraphNode{
							ID:   ref.ID,
							Box:  ref.Box,
							Path: ref.Path,
							Size: Conf.Graph.Local.NodeSize,
							Type: ref.Type,
						}
						nodeTitleLabel(refNode, nodeContentByBlock(ref))
						*backGeneration = append(*backGeneration, refNode)
					}
				}
			}
		}
	}

	generation := &[]*GraphNode{}
	*generation = append(*generation, *forwardGeneration...)
	*generation = append(*generation, *backGeneration...)
	*forwardDepth++
	*backDepth++
	growLinkedNodes(forwardlinks, backlinks, generation, nodes, forwardDepth, backDepth)
	*nodes = append(*nodes, *generation...)
}

func existNodes(nodes *[]*GraphNode, id string) bool {
	for _, node := range *nodes {
		if node.ID == id {
			return true
		}
	}
	return false
}

func buildLinks(defs *[]*Block, links *[]*GraphLink, style map[string]string, local bool) {
	for _, def := range *defs {
		for _, ref := range def.Refs {
			link := &GraphLink{
				From:  ref.ID,
				To:    def.ID,
				Ref:   true,
				Color: linkColor(true, style),
			}
			if local {
				if Conf.Graph.Local.Arrow {
					link.Arrows = &GraphArrows{To: &GraphArrowsTo{Enabled: true}}
				}
			} else {
				if Conf.Graph.Global.Arrow {
					link.Arrows = &GraphArrows{To: &GraphArrowsTo{Enabled: true}}
				}
			}
			*links = append(*links, link)
		}
	}
}

func genTreeNodes(blocks []*Block, nodes *[]*GraphNode, links *[]*GraphLink, local bool, style map[string]string) {
	nodeSize := Conf.Graph.Local.NodeSize
	if !local {
		nodeSize = Conf.Graph.Global.NodeSize
	}

	for _, block := range blocks {
		node := &GraphNode{
			ID:    block.ID,
			Box:   block.Box,
			Path:  block.Path,
			Type:  block.Type,
			Size:  nodeSize,
			Color: &GraphNodeColor{Background: nodeColor(block.Type, style)},
		}
		nodeTitleLabel(node, nodeContentByBlock(block))
		*nodes = append(*nodes, node)

		*links = append(*links, &GraphLink{
			From:  block.ParentID,
			To:    block.ID,
			Ref:   false,
			Color: linkColor(false, style),
		})
	}
}

func markLinkedNodes(nodes *[]*GraphNode, links *[]*GraphLink, local bool) {
	nodeSize := Conf.Graph.Local.NodeSize
	if !local {
		nodeSize = Conf.Graph.Global.NodeSize
	}

	tmpLinks := (*links)[:0]
	for _, link := range *links {
		var sourceFound, targetFound bool
		for _, node := range *nodes {
			if link.To == node.ID {
				if link.Ref {
					size := nodeSize
					node.Defs++
					size = math.Log2(float64(node.Defs))*nodeSize + nodeSize
					node.Size = size
				}
				targetFound = true
			} else if link.From == node.ID {
				node.Refs++
				sourceFound = true
			}
			if targetFound && sourceFound {
				break
			}
		}
		if sourceFound && targetFound {
			tmpLinks = append(tmpLinks, link)
		}
	}
	*links = tmpLinks
}

func removeDuplicatedUnescape(nodes []*GraphNode) (ret []*GraphNode) {
	m := map[string]*GraphNode{}
	for _, n := range nodes {
		if nil == m[n.ID] {
			n.Title = html.UnescapeString(n.Title)
			n.Label = html.UnescapeString(n.Label)
			ret = append(ret, n)
			m[n.ID] = n
		}
	}
	return ret
}

func pruneUnref(nodes *[]*GraphNode, links *[]*GraphLink) {
	maxBlocks := Conf.Graph.MaxBlocks
	tmpNodes := (*nodes)[:0]
	for _, node := range *nodes {
		if 0 == Conf.Graph.Global.MinRefs {
			tmpNodes = append(tmpNodes, node)
		} else {
			if Conf.Graph.Global.MinRefs <= node.Refs {
				tmpNodes = append(tmpNodes, node)
				continue
			}

			if Conf.Graph.Global.MinRefs <= node.Defs {
				tmpNodes = append(tmpNodes, node)
				continue
			}
		}

		if maxBlocks < len(tmpNodes) {
			logging.LogWarnf("exceeded the maximum number of render nodes [%d]", maxBlocks)
			break
		}
	}
	*nodes = tmpNodes

	tmpLinks := (*links)[:0]
	for _, link := range *links {
		var sourceFound, targetFound bool
		for _, node := range *nodes {
			if link.To == node.ID {
				targetFound = true
			} else if link.From == node.ID {
				sourceFound = true
			}
		}
		if sourceFound && targetFound {
			tmpLinks = append(tmpLinks, link)
		}
	}
	*links = tmpLinks
}

func nodeContentByBlock(block *Block) (ret string) {
	if ret = block.Name; "" != ret {
		return
	}
	if ret = block.Memo; "" != ret {
		return
	}
	ret = block.Content
	if maxLen := 48; maxLen < utf8.RuneCountInString(ret) {
		ret = gulu.Str.SubStr(ret, maxLen) + "..."
	}
	return
}

func nodeContentByNode(node *ast.Node, text string) (ret string) {
	if ret = node.IALAttr("name"); "" != ret {
		return
	}
	if ret = node.IALAttr("memo"); "" != ret {
		return
	}
	if maxLen := 48; maxLen < utf8.RuneCountInString(text) {
		text = gulu.Str.SubStr(text, maxLen) + "..."
	}
	ret = html.EscapeString(text)
	return
}

func linkColor(ref bool, style map[string]string) (ret *GraphLinkColor) {
	ret = &GraphLinkColor{}
	if ref {
		ret.Color = style["--b3-graph-ref-line"]
		return
	}
	ret.Color = style["--b3-graph-line"]
	return
}

func nodeColor(typ string, style map[string]string) string {
	switch typ {
	case "NodeDocument":
		return style["--b3-graph-doc-point"]
	case "NodeParagraph":
		return style["--b3-graph-p-point"]
	case "NodeHeading":
		return style["--b3-graph-heading-point"]
	case "NodeMathBlock":
		return style["--b3-graph-math-point"]
	case "NodeCodeBlock":
		return style["--b3-graph-code-point"]
	case "NodeTable":
		return style["--b3-graph-table-point"]
	case "NodeList":
		return style["--b3-graph-list-point"]
	case "NodeListItem":
		return style["--b3-graph-listitem-point"]
	case "NodeBlockquote":
		return style["--b3-graph-bq-point"]
	case "NodeSuperBlock":
		return style["--b3-graph-super-point"]
	}
	return style["--b3-graph-p-point"]
}

func graphTypeFilter(local bool) string {
	var inList []string

	paragraph := Conf.Graph.Local.Paragraph
	if !local {
		paragraph = Conf.Graph.Global.Paragraph
	}
	if paragraph {
		inList = append(inList, "'p'")
	}

	heading := Conf.Graph.Local.Heading
	if !local {
		heading = Conf.Graph.Global.Heading
	}
	if heading {
		inList = append(inList, "'h'")
	}

	math := Conf.Graph.Local.Math
	if !local {
		math = Conf.Graph.Global.Math
	}
	if math {
		inList = append(inList, "'m'")
	}

	code := Conf.Graph.Local.Code
	if !local {
		code = Conf.Graph.Global.Code
	}
	if code {
		inList = append(inList, "'c'")
	}

	table := Conf.Graph.Local.Table
	if !local {
		table = Conf.Graph.Global.Table
	}
	if table {
		inList = append(inList, "'t'")
	}

	list := Conf.Graph.Local.List
	if !local {
		list = Conf.Graph.Global.List
	}
	if list {
		inList = append(inList, "'l'")
	}

	listItem := Conf.Graph.Local.ListItem
	if !local {
		listItem = Conf.Graph.Global.ListItem
	}
	if listItem {
		inList = append(inList, "'i'")
	}

	blockquote := Conf.Graph.Local.Blockquote
	if !local {
		blockquote = Conf.Graph.Global.Blockquote
	}
	if blockquote {
		inList = append(inList, "'b'")
	}

	super := Conf.Graph.Local.Super
	if !local {
		super = Conf.Graph.Global.Super
	}
	if super {
		inList = append(inList, "'s'")
	}

	inList = append(inList, "'d'")
	return " AND ref.type IN (" + strings.Join(inList, ",") + ")"
}

func graphDailyNoteFilter(local bool) string {
	dailyNote := Conf.Graph.Local.DailyNote
	if !local {
		dailyNote = Conf.Graph.Global.DailyNote
	}

	if dailyNote {
		return ""
	}

	var dailyNotesPaths []string
	for _, box := range Conf.GetOpenedBoxes() {
		boxConf := box.GetConf()
		if 1 < strings.Count(boxConf.DailyNoteSavePath, "/") {
			dailyNoteSaveDir := strings.Split(boxConf.DailyNoteSavePath, "/")[1]
			dailyNotesPaths = append(dailyNotesPaths, "/"+dailyNoteSaveDir)
		}
	}
	if 1 > len(dailyNotesPaths) {
		return ""
	}

	buf := bytes.Buffer{}
	for _, p := range dailyNotesPaths {
		buf.WriteString(" AND ref.hpath NOT LIKE '" + p + "%'")
	}
	return buf.String()
}

func graphStyle(local bool) (ret map[string]string) {
	ret = map[string]string{}
	ret["--b3-graph-doc-point"] = currentCSSValue("--b3-graph-doc-point")
	ret["--b3-graph-p-point"] = currentCSSValue("--b3-graph-p-point")
	ret["--b3-graph-heading-point"] = currentCSSValue("--b3-graph-heading-point")
	ret["--b3-graph-math-point"] = currentCSSValue("--b3-graph-math-point")
	ret["--b3-graph-code-point"] = currentCSSValue("--b3-graph-code-point")
	ret["--b3-graph-table-point"] = currentCSSValue("--b3-graph-table-point")
	ret["--b3-graph-list-point"] = currentCSSValue("--b3-graph-list-point")
	ret["--b3-graph-listitem-point"] = currentCSSValue("--b3-graph-listitem-point")
	ret["--b3-graph-bq-point"] = currentCSSValue("--b3-graph-bq-point")
	ret["--b3-graph-super-point"] = currentCSSValue("--b3-graph-super-point")

	ret["--b3-graph-line"] = currentCSSValue("--b3-graph-line")
	ret["--b3-graph-ref-line"] = currentCSSValue("--b3-graph-ref-line")
	ret["--b3-graph-tag-line"] = currentCSSValue("--b3-graph-tag-line")
	ret["--b3-graph-tag-tag-line"] = currentCSSValue("--b3-graph-tag-tag-line")
	ret["--b3-graph-asset-line"] = currentCSSValue("--b3-graph-asset-line")

	return
}

func nodeTitleLabel(node *GraphNode, blockContent string) {
	if "NodeDocument" != node.Type && "NodeHeading" != node.Type {
		node.Title = blockContent
	} else {
		node.Label = blockContent
	}
}
