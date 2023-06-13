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
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
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
}

func GetDocInfo(blockID string) (ret *BlockInfo) {
	WaitForWritingFiles()

	tree, err := loadTreeByBlockID(blockID)
	if nil != err {
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
				if nil == treenode.GetBlockTree(zoomInId.(string)) {
					delete(ret.IAL, "scroll")
				}
			} else {
				if startId := scroll["startId"]; nil != startId {
					if nil == treenode.GetBlockTree(startId.(string)) {
						delete(ret.IAL, "scroll")
					}
				}
				if endId := scroll["endId"]; nil != endId {
					if nil == treenode.GetBlockTree(endId.(string)) {
						delete(ret.IAL, "scroll")
					}
				}
			}
		}
	}
	ret.RefIDs, _ = sql.QueryRefIDsByDefID(blockID, false)
	ret.RefCount = len(ret.RefIDs)

	var subFileCount int
	boxLocalPath := filepath.Join(util.DataDir, tree.Box)
	subFiles, err := os.ReadDir(filepath.Join(boxLocalPath, strings.TrimSuffix(tree.Path, ".sy")))
	if nil == err {
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

func GetBlockRefText(id string) string {
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return ErrBlockNotFound.Error()
	}

	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return ErrTreeNotFound.Error()
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return ErrBlockNotFound.Error()
	}
	return getNodeRefText(node)
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
	if ret := node.IALAttr("name"); "" != ret {
		ret = strings.TrimSpace(ret)
		ret = util.EscapeHTML(ret)
		return ret
	}

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
	}

	if ast.NodeDocument != node.Type && node.IsContainerBlock() {
		node = treenode.FirstLeafBlock(node)
	}
	ret := renderBlockText(node, nil)
	if Conf.Editor.BlockRefDynamicAnchorTextMaxLen < utf8.RuneCountInString(ret) {
		ret = gulu.Str.SubStr(ret, Conf.Editor.BlockRefDynamicAnchorTextMaxLen) + "..."
	}
	return ret
}

func GetBlockRefIDs(id string) (refIDs, refTexts, defIDs []string) {
	refIDs = []string{}
	refTexts = []string{}
	defIDs = []string{}
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}

	isDoc := bt.ID == bt.RootID
	refIDs, refTexts = sql.QueryRefIDsByDefID(id, isDoc)
	if isDoc {
		defIDs = sql.QueryChildDefIDsByRootDefID(id)
	} else {
		defIDs = append(defIDs, id)
	}
	return
}

func GetBlockRefIDsByFileAnnotationID(id string) (refIDs, refTexts []string) {
	refIDs, refTexts = sql.QueryRefIDsByAnnotationID(id)
	return
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
	tree, _ := loadTreeByBlockID(id)
	if nil == tree {
		return
	}
	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	rootChild := node
	for ; nil == rootChild.Parent || ast.NodeDocument != rootChild.Parent.Type; rootChild = rootChild.Parent {
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

type BlockPath struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Type     string       `json:"type"`
	SubType  string       `json:"subType"`
	Children []*BlockPath `json:"children"`
}

func BuildBlockBreadcrumb(id string, excludeTypes []string) (ret []*BlockPath, err error) {
	ret = []*BlockPath{}
	tree, err := loadTreeByBlockID(id)
	if nil == tree {
		err = nil
		return
	}
	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	ret = buildBlockBreadcrumb(node, excludeTypes)
	return
}

func buildBlockBreadcrumb(node *ast.Node, excludeTypes []string) (ret []*BlockPath) {
	ret = []*BlockPath{}
	if nil == node {
		return
	}
	box := Conf.Box(node.Box)
	if nil == box {
		return
	}

	headingLevel := 16
	maxNameLen := 1024
	boxName := box.Name
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
		fc := parent.FirstChild
		if nil != fc && ast.NodeTaskListItemMarker == fc.Type {
			fc = fc.Next
		}

		name := util.EscapeHTML(parent.IALAttr("name"))
		if ast.NodeDocument == parent.Type {
			name = util.EscapeHTML(path.Join(boxName, hPath))
		} else {
			if "" == name {
				if ast.NodeListItem == parent.Type {
					name = gulu.Str.SubStr(renderBlockText(fc, excludeTypes), maxNameLen)
				} else {
					name = gulu.Str.SubStr(renderBlockText(parent, excludeTypes), maxNameLen)
				}
			}
			if ast.NodeHeading == parent.Type {
				headingLevel = parent.HeadingLevel
			}
		}

		add := true
		if ast.NodeList == parent.Type || ast.NodeSuperBlock == parent.Type || ast.NodeBlockquote == parent.Type {
			add = false
		}
		if ast.NodeParagraph == parent.Type && nil != parent.Parent && ast.NodeListItem == parent.Parent.Type && nil == parent.Next && (nil == parent.Previous || ast.NodeTaskListItemMarker == parent.Previous.Type) {
			add = false
		}
		if ast.NodeListItem == parent.Type {
			if "" == name {
				name = gulu.Str.SubStr(renderBlockText(fc, excludeTypes), maxNameLen)
			}
		}

		name = strings.ReplaceAll(name, editor.Caret, "")
		if add {
			ret = append([]*BlockPath{{
				ID:      id,
				Name:    html.EscapeString(name),
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
				name = gulu.Str.SubStr(renderBlockText(b, excludeTypes), maxNameLen)
				ret = append([]*BlockPath{{
					ID:      b.ID,
					Name:    html.EscapeString(name),
					Type:    b.Type.String(),
					SubType: treenode.SubTypeAbbr(b),
				}}, ret...)
				headingLevel = b.HeadingLevel
			}
		}
	}
	return
}
