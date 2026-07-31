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
	"fmt"

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
