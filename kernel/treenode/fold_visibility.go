// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import "github.com/88250/lute/ast"

// IsHiddenByFold 判断正常文档中目标是否被折叠遮挡。高度裁剪容器内不能由 AST 确定可见性的目标按隐藏处理。
func IsHiddenByFold(node *ast.Node) bool {
	if node == nil || node.Type == ast.NodeDocument {
		return false
	}
	if IsInFoldedHeading(node, nil) {
		return true
	}
	for child, parent := node, node.Parent; parent != nil && parent.Type != ast.NodeDocument; child, parent = parent, parent.Parent {
		if !IsSelfFolded(parent) {
			continue
		}
		if parent.Type == ast.NodeListItem || parent.Type == ast.NodeBlockquote {
			var first *ast.Node
			for first = parent.FirstChild; first != nil; first = first.Next {
				if first.IsBlock() && first.Type != ast.NodeKramdownBlockIAL {
					break
				}
			}
			// 列表项和引述保留首块；首块内部容器的裁剪内容不能据此认定可见。
			if child == first && node == child {
				continue
			}
		}
		return true
	}
	return false
}
