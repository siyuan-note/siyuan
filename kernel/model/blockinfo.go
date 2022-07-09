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
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type BlockInfo struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	RefCount     int               `json:"refCount"`
	SubFileCount int               `json:"subFileCount"`
	RefIDs       []string          `json:"refIDs"`
	IAL          map[string]string `json:"ial"`
	Icon         string            `json:"icon"`
}

func GetDocInfo(rootID string) (ret *BlockInfo) {
	WaitForWritingFiles()

	tree, err := loadTreeByBlockID(rootID)
	if nil != err {
		util.LogErrorf("load tree by root id [%s] failed: %s", rootID, err)
		return
	}

	title := tree.Root.IALAttr("title")
	ret = &BlockInfo{ID: rootID, Name: title}
	ret.IAL = parse.IAL2Map(tree.Root.KramdownIAL)
	ret.RefIDs, _ = sql.QueryRefIDsByDefID(rootID, false)
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
	WaitForWritingFiles()

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

	if name := node.IALAttr("name"); "" != name {
		return name
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
	ret := renderBlockText(node)
	if Conf.Editor.BlockRefDynamicAnchorTextMaxLen < utf8.RuneCountInString(ret) {
		ret = gulu.Str.SubStr(ret, Conf.Editor.BlockRefDynamicAnchorTextMaxLen) + "..."
	}
	return ret
}

func GetBlockRefIDs(id string) (refIDs, refTexts, defIDs []string) {
	refIDs = []string{}
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
	return
}

type BlockPath struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Type     string       `json:"type"`
	SubType  string       `json:"subType"`
	Children []*BlockPath `json:"children"`
}

func BuildBlockBreadcrumb(id string) (ret []*BlockPath, err error) {
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

	ret = buildBlockBreadcrumb(node)
	return
}

func buildBlockBreadcrumb(node *ast.Node) (ret []*BlockPath) {
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

		name := html.EscapeHTMLStr(parent.IALAttr("name"))
		if ast.NodeDocument == parent.Type {
			name = html.EscapeHTMLStr(path.Join(boxName, hPath))
		} else {
			if "" == name {
				if ast.NodeListItem == parent.Type {
					name = gulu.Str.SubStr(renderBlockText(parent.FirstChild), maxNameLen)
				} else {
					name = gulu.Str.SubStr(renderBlockText(parent), maxNameLen)
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
		if ast.NodeParagraph == parent.Type && nil != parent.Parent && ast.NodeListItem == parent.Parent.Type && nil == parent.Next && nil == parent.Previous {
			add = false
		}
		if ast.NodeListItem == parent.Type {
			if "" == name {
				name = gulu.Str.SubStr(renderBlockText(parent.FirstChild), maxNameLen)
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
			if ast.NodeHeading == prev.Type && headingLevel > prev.HeadingLevel {
				name = gulu.Str.SubStr(renderBlockText(prev), maxNameLen)
				ret = append([]*BlockPath{{
					ID:      prev.ID,
					Name:    name,
					Type:    prev.Type.String(),
					SubType: treenode.SubTypeAbbr(prev),
				}}, ret...)
				headingLevel = prev.HeadingLevel
			}
		}
	}
	return
}
