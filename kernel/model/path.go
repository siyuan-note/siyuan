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

package model

import (
	"bytes"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func createDocsByHPath(boxID, hPath, content, parentID, id string, titleEmpty bool) (retID string, err error) {
	return createDocsByHPath0(boxID, hPath, content, parentID, id, titleEmpty, createDoc)
}

func createDocsByHPathSync(boxID, hPath, content, parentID, id string, titleEmpty bool) (retID string, err error) {
	return createDocsByHPath0(boxID, hPath, content, parentID, id, titleEmpty, createDocSync)
}

func createDocsByHPath0(boxID, hPath, content, parentID, id string, titleEmpty bool,
	createDocFn func(boxID, p, title, dom string, titleEmpty bool) (*parse.Tree, error)) (retID string, err error) {
	if "" == id {
		id = ast.NewNodeID()
	}
	retID = id

	hPath = strings.TrimSuffix(hPath, ".sy")
	hPath = util.TrimSpaceInPath(hPath)
	if IsBoxDoc(boxID, parentID) {
		// 笔记本顶层文档是用户可见的逻辑根，完整路径应从笔记本根目录解析。
		parentID = ""
	}
	if "" != parentID {
		// 存在同名文档时通过父文档 ID 精确定位 https://github.com/siyuan-note/siyuan/issues/8138
		parentHPath, name := path.Split(hPath)
		parentHPath = strings.TrimSuffix(parentHPath, "/")
		preferredParent := treenode.GetBlockTreeRootByIDAndHPath(boxID, parentID, parentHPath)
		if nil != preferredParent && preferredParent.RootID == parentID {
			// 如果父文档存在且 ID 一致，则直接在父文档下创建
			p := strings.TrimSuffix(preferredParent.Path, ".sy") + "/" + id + ".sy"
			if _, err = createDocFn(boxID, p, name, content, titleEmpty); err != nil {
				logging.LogErrorf("create doc [%s] failed: %s", p, err)
			}
			return
		}
	}

	hPathBuilder := bytes.Buffer{}
	hpathBtMap := map[string]*treenode.BlockTree{}
	parts := strings.Split(hPath, "/")[1:]
	// The subdoc creation path is unstable when a parent doc with the same name exists https://github.com/siyuan-note/siyuan/issues/9322
	// 存在同名父文档时子文档创建路径不稳定，这里需要按照完整的 hpath 映射，不能在下面的循环中边构建 hpath 边构建 path，否则虽然 hpath 相同，但是会导致 path 组装错位
	for i, part := range parts {
		if i == len(parts)-1 {
			break
		}

		hPathBuilder.WriteString("/")
		hPathBuilder.WriteString(part)
		hp := hPathBuilder.String()
		root := treenode.GetBlockTreeRootByHPath(boxID, hp)
		if nil == root {
			break
		}

		hpathBtMap[hp] = root
	}

	pathBuilder := bytes.Buffer{}
	pathBuilder.WriteString("/")
	hPathBuilder = bytes.Buffer{}
	hPathBuilder.WriteString("/")
	for i, part := range parts {
		hPathBuilder.WriteString(part)
		hp := hPathBuilder.String()
		root := hpathBtMap[hp]
		isNotLast := i < len(parts)-1
		if nil == root {
			rootID := ast.NewNodeID()
			if i == len(parts)-1 {
				rootID = retID
			}

			pathBuilder.WriteString(rootID)
			docP := pathBuilder.String() + ".sy"
			if isNotLast {
				if _, err = createDocFn(boxID, docP, part, "", false); err != nil {
					return
				}
			} else {
				if _, err = createDocFn(boxID, docP, part, content, titleEmpty); err != nil {
					return
				}
			}

			if isNotLast {
				dirPath := filepath.Join(util.DataDir, boxID, pathBuilder.String())
				if err = os.MkdirAll(dirPath, 0755); err != nil {
					logging.LogErrorf("mkdir [%s] failed: %s", dirPath, err)
					return
				}
			}
		} else {
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

func toFlatTree(blocks []*Block, baseDepth int, typ string, tree *parse.Tree) (ret []*Path) {
	var blockRoots []*Block
	for _, block := range blocks {
		root := getBlockIn(blockRoots, block.RootID)
		if nil == root {
			root, _ = getBlock(block.RootID, tree)
			blockRoots = append(blockRoots, root)
		}
		if nil == root {
			return
		}
		block.Depth = baseDepth + 1
		block.Count = len(block.Children)
		root.Children = append(root.Children, block)
	}

	folded := false
	if "outline" == typ {
		folded = true
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
			Folded:   folded,

			Updated: root.IAL["updated"],
			Created: root.ID[:14],
		}
		for _, c := range root.Children {
			treeNode.Blocks = append(treeNode.Blocks, c)
		}
		ret = append(ret, treeNode)

		if "backlink" == typ {
			treeNode.HPath = root.HPath
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
