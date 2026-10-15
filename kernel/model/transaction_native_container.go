package model

import (
	"fmt"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// unwrapNativeContainerInsert 将同类型页签或脑图片段的直属项目插入目标容器，保留项目的 ID 和属性。
func unwrapNativeContainerInsert(root, parent *ast.Node) (changed bool, err error) {
	if root == nil || parent == nil || (parent.Type != ast.NodeTabs && parent.Type != ast.NodeMindmap) {
		return false, nil
	}
	for node := root.FirstChild; node != nil; {
		next := node.Next
		if node.Type == parent.Type && node.FirstChild != nil {
			for child := node.FirstChild; child != nil; {
				childNext := child.Next
				child.Unlink()
				node.InsertBefore(child)
				child = childNext
			}
			if next != nil && next.Type == ast.NodeKramdownBlockIAL {
				ial := next
				next = next.Next
				ial.Unlink()
			}
			node.Unlink()
			changed = true
		}
		node = next
	}
	for node := root.FirstChild; node != nil; node = node.Next {
		if node.IsBlock() && node.Type != ast.NodeKramdownBlockIAL && !treenode.CanContainBlock(parent.Type, node.Type) {
			return false, fmt.Errorf("%s cannot directly contain %s", parent.Type, node.Type)
		}
	}
	return
}
