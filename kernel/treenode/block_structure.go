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

package treenode

import (
	"fmt"
	"strconv"

	"github.com/88250/lute/ast"
)

// CanContainBlock 判断指定类型的容器块是否可以容纳指定类型的内容块。
func CanContainBlock(parentType, childType ast.NodeType) bool {
	parent := &ast.Node{Type: parentType}
	return parent.IsContainerBlock() && parent.CanContain(childType)
}

// ValidateBlockSubtree 校验根块内部所有内容块的容纳关系。
func ValidateBlockSubtree(root *ast.Node) error {
	if nil == root || !isContentBlock(root) {
		return invalidBlockNodeError(root)
	}

	var ret error
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || n == root || !isContentBlock(n) {
			return ast.WalkContinue
		}

		parent := n.Parent
		for nil != parent && !isContentBlock(parent) {
			parent = parent.Parent
		}
		if nil == parent {
			return ast.WalkContinue
		}
		if !CanContainBlock(parent.Type, n.Type) {
			ret = invalidBlockContainmentError(parent, n)
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return ret
}

// ValidateBlockPlacement 校验内容块在当前父节点中的位置，并校验其内部结构。
func ValidateBlockPlacement(node *ast.Node) error {
	if nil == node || !isContentBlock(node) {
		return invalidBlockNodeError(node)
	}

	parent := node.Parent
	for nil != parent && !isContentBlock(parent) {
		parent = parent.Parent
	}
	if nil != parent && !CanContainBlock(parent.Type, node.Type) {
		return invalidBlockContainmentError(parent, node)
	}
	return ValidateBlockSubtree(node)
}

// ValidateBlockReplacement 校验新块能否替换旧块，并校验新块内部的容纳关系。
func ValidateBlockReplacement(oldNode, newNode *ast.Node) error {
	if nil == oldNode || !isContentBlock(oldNode) {
		return invalidBlockNodeError(oldNode)
	}
	if nil == newNode || !isContentBlock(newNode) {
		return invalidBlockNodeError(newNode)
	}

	parent := oldNode.Parent
	for nil != parent && !isContentBlock(parent) {
		parent = parent.Parent
	}
	if nil != parent && !CanContainBlock(parent.Type, newNode.Type) {
		return invalidBlockContainmentError(parent, newNode)
	}
	return ValidateBlockSubtree(newNode)
}

// FixInvalidListChildren 将列表下直属的非列表项内容块包装为列表项。
func FixInvalidListChildren(root *ast.Node) (fixed bool) {
	if nil == root {
		return
	}

	var invalidChildren []*ast.Node
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && nil != n.Parent && ast.NodeList == n.Parent.Type &&
			ast.NodeListItem != n.Type && isContentBlock(n) {
			invalidChildren = append(invalidChildren, n)
		}
		return ast.WalkContinue
	})

	fixedLists := map[*ast.Node]struct{}{}
	for _, child := range invalidChildren {
		list := child.Parent
		itemID := ast.NewNodeID()
		item := &ast.Node{
			Type:     ast.NodeListItem,
			ID:       itemID,
			ListData: newListItemData(list, child),
		}
		item.SetIALAttr("id", itemID)
		item.SetIALAttr("updated", itemID[:14])
		var taskMarker *ast.Node
		if 3 == item.ListData.Typ {
			taskMarker = takeTaskListItemMarker(child)
		}
		child.InsertBefore(item)
		child.Unlink()
		if nil != taskMarker {
			item.AppendChild(taskMarker)
		}
		item.AppendChild(child)
		fixedLists[list] = struct{}{}
		fixed = true
	}
	for list := range fixedLists {
		normalizeOrderedListItems(list)
	}
	return
}

func newListItemData(list, child *ast.Node) (ret *ast.ListData) {
	listType := 0
	if nil != list.ListData {
		listType = list.ListData.Typ
	}

	for sibling := child.Previous; nil != sibling; sibling = sibling.Previous {
		if ast.NodeListItem == sibling.Type && nil != sibling.ListData {
			ret = cloneListData(sibling.ListData)
			ret.Typ = listType
			ret.Checked = false
			return
		}
	}
	for sibling := child.Next; nil != sibling; sibling = sibling.Next {
		if ast.NodeListItem == sibling.Type && nil != sibling.ListData {
			ret = cloneListData(sibling.ListData)
			ret.Typ = listType
			ret.Checked = false
			return
		}
	}

	ret = &ast.ListData{Typ: listType}
	if 0 == listType || 3 == listType {
		ret.BulletChar = '*'
		ret.Marker = []byte{'*'}
	}
	return
}

func cloneListData(data *ast.ListData) (ret *ast.ListData) {
	ret = &ast.ListData{}
	*ret = *data
	ret.Marker = append([]byte(nil), data.Marker...)
	return
}

func takeTaskListItemMarker(child *ast.Node) *ast.Node {
	for marker := child.FirstChild; nil != marker; marker = marker.Next {
		if ast.NodeTaskListItemMarker == marker.Type {
			marker.Unlink()
			return marker
		}
	}
	if nil != child.Previous && ast.NodeTaskListItemMarker == child.Previous.Type {
		marker := child.Previous
		marker.Unlink()
		return marker
	}
	return &ast.Node{Type: ast.NodeTaskListItemMarker}
}

func normalizeOrderedListItems(list *ast.Node) {
	if nil == list.ListData || 1 != list.ListData.Typ {
		return
	}

	start, delimiter, position := 1, byte('.'), 0
	for item := list.FirstChild; nil != item; item = item.Next {
		if ast.NodeListItem != item.Type {
			continue
		}
		if nil != item.ListData {
			if 0 != item.ListData.Delimiter {
				delimiter = item.ListData.Delimiter
			}
			if 0 < item.ListData.Num || 0 != item.ListData.Delimiter || 0 < len(item.ListData.Marker) {
				start = max(0, item.ListData.Num-position)
				break
			}
		}
		position++
	}

	num := start
	for item := list.FirstChild; nil != item; item = item.Next {
		if ast.NodeListItem != item.Type {
			continue
		}
		if nil == item.ListData {
			item.ListData = &ast.ListData{}
		}
		item.ListData.Typ = 1
		item.ListData.Num = num
		item.ListData.Delimiter = delimiter
		item.ListData.Marker = []byte(strconv.Itoa(num) + string(delimiter))
		num++
	}
}

func isContentBlock(node *ast.Node) bool {
	return nil != node && node.IsBlock() && ast.NodeKramdownBlockIAL != node.Type
}

func invalidBlockContainmentError(parent, child *ast.Node) error {
	return fmt.Errorf("invalid block structure: %s [%s] cannot contain %s [%s]",
		parent.Type.String(), parent.ID, child.Type.String(), child.ID)
}

func invalidBlockNodeError(node *ast.Node) error {
	if nil == node {
		return fmt.Errorf("invalid block structure: block node is nil")
	}
	return fmt.Errorf("invalid block structure: %s [%s] is not a content block", node.Type.String(), node.ID)
}
