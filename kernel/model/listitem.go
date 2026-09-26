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
	"path"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func ListItem2Doc(srcListItemID, targetBoxID, targetPath, previousPath string, toTop bool) (srcRootBlockID, newTargetPath string, err error) {
	targetPath = normalizeBoxDocTarget(targetBoxID, targetPath)
	FlushTxQueue()

	srcTree, _ := LoadTreeByBlockID(srcListItemID)
	if nil == srcTree {
		err = ErrBlockNotFound
		return
	}
	srcRootBlockID = srcTree.Root.ID

	listItemNode := treenode.GetNodeInTree(srcTree, srcListItemID)
	if nil == listItemNode {
		err = ErrBlockNotFound
		return
	}

	box := Conf.Box(targetBoxID)
	listItemText := sql.GetContainerText(listItemNode)
	listItemText = util.FilterFileName(listItemText)

	moveToRoot := "/" == targetPath
	toHP := path.Join("/", listItemText)
	toFolder := "/"

	if "" != previousPath {
		previousDoc := treenode.GetBlockTreeRootByPath(targetBoxID, previousPath)
		if nil == previousDoc {
			err = ErrBlockNotFound
			return
		}
		parentPath := path.Dir(previousPath)
		if "/" != parentPath {
			parentPath = strings.TrimSuffix(parentPath, "/") + ".sy"
			parentDoc := treenode.GetBlockTreeRootByPath(targetBoxID, parentPath)
			if nil == parentDoc {
				err = ErrBlockNotFound
				return
			}
			toHP = path.Join(parentDoc.HPath, listItemText)
			toFolder = path.Join(path.Dir(parentPath), parentDoc.ID)
		}
	} else {
		if !moveToRoot {
			parentDoc := treenode.GetBlockTreeRootByPath(targetBoxID, targetPath)
			if nil == parentDoc {
				err = ErrBlockNotFound
				return
			}
			toHP = path.Join(parentDoc.HPath, listItemText)
			toFolder = path.Join(path.Dir(targetPath), parentDoc.ID)
		}
	}

	newTargetPath = path.Join(toFolder, srcListItemID+".sy")
	if !box.Exist(toFolder) {
		if err = box.MkdirAll(toFolder); err != nil {
			return
		}
	}

	luteEngine := util.NewLute()
	newTree := &parse.Tree{Root: listItemDocRoot(listItemNode, listItemText), Context: &parse.Context{ParseOption: luteEngine.ParseOptions}}
	newTree.ID = srcListItemID
	newTree.Path = newTargetPath
	newTree.HPath = toHP
	srcTree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	if nil == srcTree.Root.FirstChild {
		srcTree.Root.AppendChild(treenode.NewParagraph(""))
	}
	treenode.RemoveBlockTreesByRootID(srcTree.Box, srcTree.ID)
	if err = indexWriteTreeUpsertQueue(srcTree); err != nil {
		return "", "", err
	}

	newTree.Box, newTree.Path = targetBoxID, newTargetPath
	newTree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	newTree.Root.Spec = treenode.CurrentSpec
	if "" != previousPath {
		box.addSort(previousPath, newTree.ID)
	} else if toTop {
		box.addMinSort(path.Dir(newTargetPath), newTree.ID)
	} else {
		box.setSortByConf(path.Dir(newTargetPath), newTree.ID)
	}
	if err = indexWriteTreeUpsertQueue(newTree); err != nil {
		return "", "", err
	}
	IncSync()
	go func() {
		RefreshBacklink(srcTree.ID)
		RefreshBacklink(newTree.ID)
		ResetVirtualBlockRefCache()
	}()
	return
}

// listItemDocRoot 将完整列表项移入新文档，原列表项 ID 继续作为文档 ID 使用。
func listItemDocRoot(item *ast.Node, title string) *ast.Node {
	root := &ast.Node{Type: ast.NodeDocument, ID: item.ID}
	for _, attr := range item.KramdownIAL {
		root.KramdownIAL = append(root.KramdownIAL, append([]string(nil), attr...))
	}
	root.SetIALAttr("type", "doc")
	root.SetIALAttr("id", root.ID)
	root.SetIALAttr("title", title)
	treenode.SetSelfFolded(root, false)
	root.RemoveIALAttr(DocHiddenAttr)

	parent := item.Parent
	list := &ast.Node{Type: ast.NodeList, ID: ast.NewNodeID(), ListData: &ast.ListData{}}
	if nil != parent && ast.NodeList == parent.Type {
		if nil != parent.ListData {
			*list.ListData = *parent.ListData
		}
		for _, attr := range parent.KramdownIAL {
			list.KramdownIAL = append(list.KramdownIAL, append([]string(nil), attr...))
		}
	} else if nil != item.ListData {
		*list.ListData = *item.ListData
	}
	list.ListData.Marker = append([]byte(nil), list.ListData.Marker...)
	if 1 == list.ListData.Typ && nil != item.ListData {
		list.ListData.Start = item.ListData.Num
	}
	list.SetIALAttr("id", list.ID)
	item.ID = ast.NewNodeID()
	item.SetIALAttr("id", item.ID)
	hasContent := false
	for child := item.FirstChild; nil != child; child = child.Next {
		if child.IsBlock() && ast.NodeKramdownBlockIAL != child.Type {
			hasContent = true
			break
		}
	}
	if !hasContent {
		item.AppendChild(treenode.NewParagraph(""))
	}
	list.AppendChild(item)
	root.AppendChild(list)
	if nil != parent && nil == parent.FirstChild {
		parent.Unlink()
	}
	return root
}
