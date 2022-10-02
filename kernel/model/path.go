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
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func createDocsByHPath(boxID, hPath, content string) (id string, err error) {
	hPath = strings.TrimSuffix(hPath, ".sy")
	if docExist := nil != treenode.GetBlockTreeRootByHPath(boxID, hPath); docExist {
		hPath += "-" + gulu.Rand.String(7)
	}
	pathBuilder := bytes.Buffer{}
	pathBuilder.WriteString("/")
	hPathBuilder := bytes.Buffer{}
	hPathBuilder.WriteString("/")

	parts := strings.Split(hPath, "/")[1:]
	for i, part := range parts {
		hPathBuilder.WriteString(part)
		hp := hPathBuilder.String()
		root := treenode.GetBlockTreeRootByHPath(boxID, hp)
		isNotLast := i < len(parts)-1
		if nil == root {
			id = ast.NewNodeID()
			pathBuilder.WriteString(id)
			docP := pathBuilder.String() + ".sy"
			if isNotLast {
				if err = createDoc(boxID, docP, part, ""); nil != err {
					return
				}
			} else {
				if err = createDoc(boxID, docP, part, content); nil != err {
					return
				}
			}

			if isNotLast {
				dirPath := filepath.Join(util.DataDir, boxID, pathBuilder.String())
				if err = os.MkdirAll(dirPath, 0755); nil != err {
					logging.LogErrorf("mkdir [%s] failed: %s", dirPath, err)
					return
				}
			}
		} else {
			id = root.ID
			pathBuilder.WriteString(root.ID)
			if !isNotLast {
				pathBuilder.WriteString(".sy")
			}
		}

		if isNotLast {
			pathBuilder.WriteString("/")
			hPathBuilder.WriteString("/")
		}
	}
	return
}

func toFlatTree(blocks []*Block, baseDepth int, typ string) (ret []*Path) {
	var blockRoots []*Block
	for _, block := range blocks {
		root := getBlockIn(blockRoots, block.RootID)
		if nil == root {
			root, _ = getBlock(block.RootID)
			blockRoots = append(blockRoots, root)
		}
		if nil == root {
			return
		}
		block.Depth = baseDepth + 1
		block.Count = len(block.Children)
		root.Children = append(root.Children, block)
	}

	for _, root := range blockRoots {
		treeNode := &Path{
			ID:       root.ID,
			Box:      root.Box,
			Name:     path.Base(root.HPath),
			NodeType: root.Type,
			Type:     typ,
			SubType:  root.SubType,
			Depth:    baseDepth,
			Count:    len(root.Children),
		}
		for _, c := range root.Children {
			treeNode.Blocks = append(treeNode.Blocks, c)
		}
		ret = append(ret, treeNode)
	}

	sort.Slice(ret, func(i, j int) bool {
		return ret[i].ID > ret[j].ID
	})
	return
}

func toSubTree(blocks []*Block, keyword string) (ret []*Path) {
	keyword = strings.TrimSpace(keyword)
	var blockRoots []*Block
	for _, block := range blocks {
		root := getBlockIn(blockRoots, block.RootID)
		if nil == root {
			root, _ = getBlock(block.RootID)
			blockRoots = append(blockRoots, root)
		}
		block.Depth = 1
		block.Count = len(block.Children)
		root.Children = append(root.Children, block)
	}

	for _, root := range blockRoots {
		treeNode := &Path{
			ID:       root.ID,
			Box:      root.Box,
			Name:     path.Base(root.HPath),
			Type:     "backlink",
			NodeType: "NodeDocument",
			SubType:  root.SubType,
			Depth:    0,
			Count:    len(root.Children),
		}

		rootPos := -1
		var rootContent string
		if "" != keyword {
			rootPos, rootContent = search.MarkText(treeNode.Name, keyword, 12, Conf.Search.CaseSensitive)
			treeNode.Name = rootContent
		}
		if 0 < len(treeNode.Children) || 0 < len(treeNode.Blocks) || (-1 < rootPos && "" != keyword) {
			ret = append(ret, treeNode)
		}
	}

	sort.Slice(ret, func(i, j int) bool {
		return ret[i].ID > ret[j].ID
	})
	return
}

func getBlockIn(blocks []*Block, id string) *Block {
	if "" == id {
		return nil
	}
	for _, block := range blocks {
		if block.ID == id {
			return block
		}
	}
	return nil
}
