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

package model

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type BlockInfo struct {
	ID           string            `json:"id"`
	RootID       string            `json:"rootID"`
	Name         string            `json:"name"`
	RefCount     int               `json:"refCount"`
	SubFileCount int               `json:"subFileCount"`
	RefIDs       []string          `json:"refIDs"`
	IAL          map[string]string `json:"ial"`
	Icon         string            `json:"icon"`
	AttrViews    []*AttrView       `json:"attrViews"`
}

type AttrView struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func GetDocInfo(blockID string) (ret *BlockInfo) {
	FlushTxQueue()

	tree, err := LoadTreeByBlockID(blockID)
	if err != nil {
		logging.LogErrorf("load tree by root id [%s] failed: %s", blockID, err)
		return
	}

	title := tree.Root.IALAttr("title")
	ret = &BlockInfo{ID: blockID, RootID: tree.Root.ID, Name: title}
	ret.IAL = parse.IAL2Map(tree.Root.KramdownIAL)
	scrollData := ret.IAL["scroll"]
	if 0 < len(scrollData) {
		scroll := map[string]interface{}{}
		if parseErr := gulu.JSON.UnmarshalJSON([]byte(scrollData), &scroll); nil != parseErr {
			logging.LogWarnf("parse scroll data [%s] failed: %s", scrollData, parseErr)
			delete(ret.IAL, "scroll")
		} else {
			if zoomInId := scroll["zoomInId"]; nil != zoomInId {
				if !treenode.ExistBlockTree(zoomInId.(string)) {
					delete(ret.IAL, "scroll")
				}
			} else {
				if startId := scroll["startId"]; nil != startId {
					if !treenode.ExistBlockTree(startId.(string)) {
						delete(ret.IAL, "scroll")
					}
				}
				if endId := scroll["endId"]; nil != endId {
					if !treenode.ExistBlockTree(endId.(string)) {
						delete(ret.IAL, "scroll")
					}
				}
			}
		}
	}

	bt := treenode.GetBlockTree(blockID)
	refDefs := queryBlockRefDefs(bt)
	buildBacklinkListItemRefs(refDefs)
	var refIDs []string
	for _, refDef := range refDefs {
		refIDs = append(refIDs, refDef.RefID)
	}
	if 1 > len(refIDs) {
		refIDs = []string{}
	}
	ret.RefIDs = refIDs
	ret.RefCount = len(ret.RefIDs)

	// 填充属性视图角标 Display the database title on the block superscript https://github.com/siyuan-note/siyuan/issues/10545
	avIDs := strings.Split(ret.IAL[av.NodeAttrNameAvs], ",")
	for _, avID := range avIDs {
		avName, getErr := av.GetAttributeViewName(avID)
		if nil != getErr {
			continue
		}

		if "" == avName {
			avName = Conf.language(105)
		}

		attrView := &AttrView{ID: avID, Name: avName}
		ret.AttrViews = append(ret.AttrViews, attrView)
	}

	var subFileCount int
	boxLocalPath := filepath.Join(util.DataDir, tree.Box)
	subFiles, err := os.ReadDir(filepath.Join(boxLocalPath, strings.TrimSuffix(tree.Path, ".sy")))
	if err == nil {
		for _, subFile := range subFiles {
			if strings.HasSuffix(subFile.Name(), ".sy") {
				subFileCount++
			}
		}
	}
	ret.SubFileCount = subFileCount
	ret.Icon = tree.Root.IALAttr("icon")
	return
}

func GetDocsInfo(blockIDs []string, queryRefCount bool, queryAv bool) (rets []*BlockInfo) {
	FlushTxQueue()

	trees := filesys.LoadTrees(blockIDs)
	bts := treenode.GetBlockTrees(blockIDs)
	for _, blockID := range blockIDs {
		tree := trees[blockID]
		if nil == tree {
			continue
		}
		title := tree.Root.IALAttr("title")
		ret := &BlockInfo{ID: blockID, RootID: tree.Root.ID, Name: title}
		ret.IAL = parse.IAL2Map(tree.Root.KramdownIAL)
		scrollData := ret.IAL["scroll"]
		if 0 < len(scrollData) {
			scroll := map[string]interface{}{}
			if parseErr := gulu.JSON.UnmarshalJSON([]byte(scrollData), &scroll); nil != parseErr {
				logging.LogWarnf("parse scroll data [%s] failed: %s", scrollData, parseErr)
				delete(ret.IAL, "scroll")
			} else {
				if zoomInId := scroll["zoomInId"]; nil != zoomInId {
					if !treenode.ExistBlockTree(zoomInId.(string)) {
						delete(ret.IAL, "scroll")
					}
				} else {
					if startId := scroll["startId"]; nil != startId {
						if !treenode.ExistBlockTree(startId.(string)) {
							delete(ret.IAL, "scroll")
						}
					}
					if endId := scroll["endId"]; nil != endId {
						if !treenode.ExistBlockTree(endId.(string)) {
							delete(ret.IAL, "scroll")
						}
					}
				}
			}
		}
		if queryRefCount {
			var refIDs []string
			refDefs := queryBlockRefDefs(bts[blockID])
			buildBacklinkListItemRefs(refDefs)
			for _, refDef := range refDefs {
				refIDs = append(refIDs, refDef.RefID)
			}
			if 1 > len(refIDs) {
				refIDs = []string{}
			}
			ret.RefIDs = refIDs
			ret.RefCount = len(ret.RefIDs)
		}

		if queryAv {
			// 填充属性视图角标 Display the database title on the block superscript https://github.com/siyuan-note/siyuan/issues/10545
			avIDs := strings.Split(ret.IAL[av.NodeAttrNameAvs], ",")
			for _, avID := range avIDs {
				avName, getErr := av.GetAttributeViewName(avID)
				if nil != getErr {
					continue
				}

				if "" == avName {
					avName = Conf.language(105)
				}

				attrView := &AttrView{ID: avID, Name: avName}
				ret.AttrViews = append(ret.AttrViews, attrView)
			}
		}

		var subFileCount int
		boxLocalPath := filepath.Join(util.DataDir, tree.Box)
		subFiles, err := os.ReadDir(filepath.Join(boxLocalPath, strings.TrimSuffix(tree.Path, ".sy")))
		if err == nil {
			for _, subFile := range subFiles {
				if strings.HasSuffix(subFile.Name(), ".sy") {
					subFileCount++
				}
			}
		}
		ret.SubFileCount = subFileCount
		ret.Icon = tree.Root.IALAttr("icon")

		rets = append(rets, ret)

	}
	return
}

func GetBlockRefText(id string) string {
	FlushTxQueue()

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return ErrBlockNotFound.Error()
	}

	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return ""
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return ErrBlockNotFound.Error()
	}

	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if n.IsTextMarkType("inline-memo") {
			// Block ref anchor text no longer contains contents of inline-level memos https://github.com/siyuan-note/siyuan/issues/9363
			n.TextMarkInlineMemoContent = ""
			return ast.WalkContinue
		}
		return ast.WalkContinue
	})
	return getNodeRefText(node)
}

func GetDOMText(dom string) (ret string) {
	luteEngine := NewLute()
	tree := luteEngine.BlockDOM2Tree(dom)
	ret = renderBlockText(tree.Root.FirstChild, nil, true)
	return
}

func getBlockRefText(id string, tree *parse.Tree) (ret string) {
	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	ret = getNodeRefText(node)
	ret = maxContent(ret, Conf.Editor.BlockRefDynamicAnchorTextMaxLen)
	return
}

func getNodeRefText(node *ast.Node) string {
	if nil == node {
		return ""
	}

	if ret := node.IALAttr("name"); "" != ret {
		ret = strings.TrimSpace(ret)
		ret = util.EscapeHTML(ret)
		return ret
	}
	return getNodeRefText0(node, Conf.Editor.BlockRefDynamicAnchorTextMaxLen, true)
}

func getNodeAvBlockText(node *ast.Node, avID string) (icon, content string) {
	if nil == node {
		return
	}

	icon = node.IALAttr("icon")
	if name := node.IALAttr("name"); "" != name {
		name = strings.TrimSpace(name)
		name = util.EscapeHTML(name)
		content = name
	} else {
		content = getNodeRefText0(node, 1024, false)
	}

	content = strings.TrimSpace(content)
	if "" != avID {
		if staticText := node.IALAttr(av.NodeAttrViewStaticText + "-" + avID); "" != staticText {
			content = staticText
		}
	}
	if "" == content {
		content = Conf.language(105)
	}
	return
}

func getNodeRefText0(node *ast.Node, maxLen int, removeLineBreak bool) string {
	switch node.Type {
	case ast.NodeBlockQueryEmbed:
		return "Query Embed Block..."
	case ast.NodeIFrame:
		return "IFrame..."
	case ast.NodeThematicBreak:
		return "Thematic Break..."
	case ast.NodeVideo:
		return "Video..."
	case ast.NodeAudio:
		return "Audio..."
	case ast.NodeAttributeView:
		ret, _ := av.GetAttributeViewName(node.AttributeViewID)
		if "" == ret {
			ret = "Database..."
		}
		return ret
	}

	if ast.NodeDocument != node.Type && node.IsContainerBlock() {
		node = treenode.FirstLeafBlock(node)
	}
	ret := renderBlockText(node, nil, removeLineBreak)
	if maxLen < utf8.RuneCountInString(ret) {
		ret = gulu.Str.SubStr(ret, maxLen) + "..."
	}
	return ret
}

type RefDefs struct {
	RefID  string   `json:"refID"`
	DefIDs []string `json:"defIDs"`
}

func GetBlockRefs(defID string) (refDefs []*RefDefs, originalRefBlockIDs map[string]string) {
	refDefs = []*RefDefs{}
	originalRefBlockIDs = map[string]string{}
	bt := treenode.GetBlockTree(defID)
	if nil == bt {
		return
	}

	refDefs = queryBlockRefDefs(bt)
	originalRefBlockIDs = buildBacklinkListItemRefs(refDefs)
	return
}

func queryBlockRefDefs(bt *treenode.BlockTree) (refDefs []*RefDefs) {
	refDefs = []*RefDefs{}
	if nil == bt {
		return
	}

	isDoc := bt.ID == bt.RootID
	if isDoc {
		refDefIDs := sql.QueryChildRefDefIDsByRootDefID(bt.RootID)
		for rID, dIDs := range refDefIDs {
			var defIDs []string
			for _, dID := range dIDs {
				defIDs = append(defIDs, dID)
			}
			if 1 > len(defIDs) {
				defIDs = []string{}
			}
			refDefs = append(refDefs, &RefDefs{RefID: rID, DefIDs: defIDs})
		}
	} else {
		refIDs := sql.QueryRefIDsByDefID(bt.ID, false)
		for _, refID := range refIDs {
			refDefs = append(refDefs, &RefDefs{RefID: refID, DefIDs: []string{bt.ID}})
		}
	}
	return
}

func GetBlockRefIDsByFileAnnotationID(id string) []string {
	return sql.QueryRefIDsByAnnotationID(id)
}

func GetBlockDefIDsByRefText(refText string, excludeIDs []string) (ret []string) {
	ret = sql.QueryBlockDefIDsByRefText(refText, excludeIDs)
	sort.Sort(sort.Reverse(sort.StringSlice(ret)))
	if 1 > len(ret) {
		ret = []string{}
	}
	return
}

func GetBlockIndex(id string) (ret int) {
	tree, _ := LoadTreeByBlockID(id)
	if nil == tree {
		return
	}
	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	rootChild := node
	for ; nil != rootChild.Parent && ast.NodeDocument != rootChild.Parent.Type; rootChild = rootChild.Parent {
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if !n.IsChildBlockOf(tree.Root, 1) {
			return ast.WalkContinue
		}

		ret++
		if n.ID == rootChild.ID {
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return
}

func GetBlocksIndexes(ids []string) (ret map[string]int) {
	ret = map[string]int{}
	if 1 > len(ids) {
		return
	}

	tree, _ := LoadTreeByBlockID(ids[0])
	if nil == tree {
		return
	}

	idx := 0
	nodesIndexes := map[string]int{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if !n.IsChildBlockOf(tree.Root, 1) {
			if n.IsBlock() {
				nodesIndexes[n.ID] = idx
			}
			return ast.WalkContinue
		}

		idx++
		nodesIndexes[n.ID] = idx
		return ast.WalkContinue
	})

	for _, id := range ids {
		ret[id] = nodesIndexes[id]
	}
	return
}

type BlockPath struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Type     string       `json:"type"`
	SubType  string       `json:"subType"`
	Children []*BlockPath `json:"children"`
}

func BuildBlockBreadcrumb(id string, excludeTypes []string) (ret []*BlockPath, err error) {
	ret = []*BlockPath{}
	tree, err := LoadTreeByBlockID(id)
	if nil == tree {
		err = nil
		return
	}
	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	ret = buildBlockBreadcrumb(node, excludeTypes, false)
	return
}

func buildBlockBreadcrumb(node *ast.Node, excludeTypes []string, isEmbedBlock bool, headingMode ...int) (ret []*BlockPath) {
	ret = []*BlockPath{}
	if nil == node {
		return
	}
	box := Conf.Box(node.Box)
	if nil == box {
		return
	}

	// 默认 headingMode 为 0
	mode := 0
	if len(headingMode) > 0 {
		mode = headingMode[0]
	}

	headingLevel := 16
	maxNameLen := 1024
	var hPath string
	baseBlock := treenode.GetBlockTreeRootByPath(node.Box, node.Path)
	if nil != baseBlock {
		hPath = baseBlock.HPath
	}
	for parent := node; nil != parent; parent = parent.Parent {
		if "" == parent.ID {
			continue
		}
		id := parent.ID
		fc := treenode.FirstLeafBlock(parent)

		name := parent.IALAttr("name")
		if ast.NodeDocument == parent.Type {
			name = box.Name + hPath
		} else if ast.NodeAttributeView == parent.Type {
			name, _ = av.GetAttributeViewName(parent.AttributeViewID)
		} else {
			if "" == name {
				if ast.NodeListItem == parent.Type || ast.NodeList == parent.Type || ast.NodeSuperBlock == parent.Type || ast.NodeBlockquote == parent.Type || ast.NodeCallout == parent.Type {
					name = gulu.Str.SubStr(renderBlockText(fc, excludeTypes, true), maxNameLen)
				} else {
					name = gulu.Str.SubStr(renderBlockText(parent, excludeTypes, true), maxNameLen)
				}
			}
			if ast.NodeHeading == parent.Type {
				headingLevel = parent.HeadingLevel
			}
		}

		add := true
		if ast.NodeList == parent.Type || ast.NodeSuperBlock == parent.Type || ast.NodeBlockquote == parent.Type || ast.NodeCallout == parent.Type {
			add = false
			if parent == node {
				// https://github.com/siyuan-note/siyuan/issues/13141#issuecomment-2476789553
				add = true
			}
		}
		if ast.NodeParagraph == parent.Type && nil != parent.Parent && ast.NodeListItem == parent.Parent.Type && nil == parent.Next && (nil == parent.Previous || ast.NodeTaskListItemMarker == parent.Previous.Type) {
			add = false
		}
		if ast.NodeListItem == parent.Type {
			if "" == name {
				name = gulu.Str.SubStr(renderBlockText(fc, excludeTypes, true), maxNameLen)
			}
		}

		name = strings.ReplaceAll(name, editor.Caret, "")
		name = util.UnescapeHTML(name)
		name = util.EscapeHTML(name)

		if !isEmbedBlock {
			if parent == node {
				name = ""
			}
		} else {
			if ast.NodeDocument != parent.Type {
				// 当headingMode=2（仅显示标题下方的块）且当前节点是标题时，保留标题名称
				if 2 == mode && ast.NodeHeading == parent.Type && parent == node {
					// 保留标题名称，不清空
				} else {
					// 在嵌入块中隐藏最后一个非文档路径的面包屑中的文本 Hide text in breadcrumb of last non-document path in embed block https://github.com/siyuan-note/siyuan/issues/13866
					name = ""
				}
			}
		}

		if add {
			ret = append([]*BlockPath{{
				ID:      id,
				Name:    name,
				Type:    parent.Type.String(),
				SubType: treenode.SubTypeAbbr(parent),
			}}, ret...)
		}

		for prev := parent.Previous; nil != prev; prev = prev.Previous {
			b := prev
			if ast.NodeSuperBlock == prev.Type {
				// 超级块中包含标题块时下方块面包屑计算不正确 https://github.com/siyuan-note/siyuan/issues/6675
				b = treenode.SuperBlockLastHeading(prev)
				if nil == b {
					// 超级块下方块被作为嵌入块时设置显示面包屑后不渲染 https://github.com/siyuan-note/siyuan/issues/6690
					b = prev
				}
			}

			if ast.NodeHeading == b.Type && headingLevel > b.HeadingLevel {
				if b.ParentIs(ast.NodeListItem) {
					// 标题在列表下时不显示 https://github.com/siyuan-note/siyuan/issues/13008
					continue
				}

				name = gulu.Str.SubStr(renderBlockText(b, excludeTypes, true), maxNameLen)
				name = util.UnescapeHTML(name)
				name = util.EscapeHTML(name)
				ret = append([]*BlockPath{{
					ID:      b.ID,
					Name:    name,
					Type:    b.Type.String(),
					SubType: treenode.SubTypeAbbr(b),
				}}, ret...)
				headingLevel = b.HeadingLevel
			}
		}
	}
	return
}

func buildBacklinkListItemRefs(refDefs []*RefDefs) (originalRefBlockIDs map[string]string) {
	originalRefBlockIDs = map[string]string{}

	var refIDs []string
	for _, refDef := range refDefs {
		refIDs = append(refIDs, refDef.RefID)
	}
	sqlRefBlocks := sql.GetBlocks(refIDs)
	refBlocks := fromSQLBlocks(&sqlRefBlocks, "", 12)

	parentRefParagraphs := map[string]*Block{}
	var paragraphParentIDs []string
	for _, ref := range refBlocks {
		if nil != ref && "NodeParagraph" == ref.Type {
			parentRefParagraphs[ref.ParentID] = ref
			paragraphParentIDs = append(paragraphParentIDs, ref.ParentID)
		}
	}
	sqlParagraphParents := sql.GetBlocks(paragraphParentIDs)
	paragraphParents := fromSQLBlocks(&sqlParagraphParents, "", 12)

	luteEngine := util.NewLute()
	processedParagraphs := hashset.New()
	for _, parent := range paragraphParents {
		if nil == parent {
			continue
		}

		if "NodeListItem" == parent.Type || "NodeBlockquote" == parent.Type || "NodeSuperBlock" == parent.Type || "NodeCallout" == parent.Type {
			refBlock := parentRefParagraphs[parent.ID]
			if nil == refBlock {
				continue
			}

			paragraphUseParentLi := true
			if "NodeListItem" == parent.Type && parent.FContent != refBlock.Content {
				if inlineTree := parse.Inline("", []byte(refBlock.Markdown), luteEngine.ParseOptions); nil != inlineTree {
					for c := inlineTree.Root.FirstChild.FirstChild; c != nil; c = c.Next {
						if treenode.IsBlockRef(c) {
							continue
						}

						if "" != strings.TrimSpace(c.Text()) {
							paragraphUseParentLi = false
							break
						}
					}
				}
			}

			if paragraphUseParentLi {
				for _, refDef := range refDefs {
					if refDef.RefID == refBlock.ID {
						refDef.RefID = parent.ID
						break
					}
				}
				processedParagraphs.Add(parent.ID)
			}

			originalRefBlockIDs[parent.ID] = refBlock.ID
		}
	}
	return
}
