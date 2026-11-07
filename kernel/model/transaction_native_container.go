// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func newListEdgeItem(typ int) *ast.Node {
	item := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeListItem, ListData: &ast.ListData{Typ: typ}}
	item.SetIALAttr("id", item.ID)
	// 包装项使用 DOM 渲染的默认标记，保证持久化和重放的列表数据一致。
	if typ == 1 {
		item.ListData.Delimiter = '.'
		item.ListData.Marker = []byte("0.")
	} else {
		item.ListData.BulletChar = '*'
		item.ListData.Marker = []byte("*")
	}
	if typ == 3 {
		marker := &ast.Node{Type: ast.NodeTaskListItemMarker}
		marker.ReviveFromMarker(' ')
		item.AppendChild(marker)
	}
	return item
}

// unwrapNativeContainerInsert 将同类型容器片段的直属项目插入目标容器，保留项目的 ID 和属性。
func unwrapNativeContainerInsert(root, parent *ast.Node, unwrapList bool) (changed bool, err error) {
	if root == nil || parent == nil || (parent.Type != ast.NodeList && parent.Type != ast.NodeTabs && parent.Type != ast.NodeMindmap) {
		return false, nil
	}
	if parent.Type == ast.NodeList && !unwrapList {
		// 首尾插入由调用方展开列表片段，并将普通块包装成列表项。
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
