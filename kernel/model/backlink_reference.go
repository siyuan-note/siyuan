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
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// 只标记承担传递作用且仍有其他内容可展示的纯引用块，不修改源节点。
func getBacklinkReferenceBlockID(node *ast.Node, renderNodes []*ast.Node, originalRefID string) string {
	var reference *ast.Node
	if "" == originalRefID {
		if ast.NodeHeading != node.Type {
			return ""
		}
		reference = node
	} else {
		for _, root := range renderNodes {
			ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.ID == originalRefID {
					reference = n
					return ast.WalkStop
				}
				return ast.WalkContinue
			})
			if nil != reference {
				break
			}
		}
	}
	if nil == reference || !isPureBacklinkReferenceNode(reference) {
		return ""
	}

	for _, root := range renderNodes {
		hasContent := false
		ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			if n == reference {
				return ast.WalkSkipChildren
			}
			if n != node && n.IsBlock() && !n.IsContainerBlock() && ast.NodeDocument != n.Type {
				if ast.NodeParagraph != n.Type || hasBacklinkParagraphContent(n) {
					hasContent = true
					return ast.WalkStop
				}
			}
			return ast.WalkContinue
		})
		if hasContent {
			return reference.ID
		}
	}
	return ""
}

func isPureBacklinkReferenceNode(node *ast.Node) bool {
	if ast.NodeParagraph != node.Type && ast.NodeHeading != node.Type {
		return false
	}
	hasReference := false
	for child := node.FirstChild; nil != child; child = child.Next {
		if treenode.IsBlockRef(child) {
			hasReference = true
			continue
		}
		if ast.NodeHeadingC8hMarker == child.Type || ast.NodeText == child.Type && "" == strings.TrimSpace(child.Text()) {
			continue
		}
		return false
	}
	return hasReference
}

func hasBacklinkParagraphContent(node *ast.Node) bool {
	for child := node.FirstChild; nil != child; child = child.Next {
		if ast.NodeText != child.Type || "" != strings.TrimSpace(child.Text()) {
			return true
		}
	}
	return false
}
