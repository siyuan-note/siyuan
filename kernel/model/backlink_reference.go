// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
