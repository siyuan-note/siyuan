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
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func MoveFoldHeading(updateNode, oldNode *ast.Node) {
	foldHeadings := map[string][]*ast.Node{}
	// 找到原有节点中所有折叠标题节点的下方节点
	ast.Walk(oldNode, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeHeading == n.Type && "1" == n.IALAttr("fold") {
			children := HeadingChildren(n)
			foldHeadings[n.ID] = children
		}
		return ast.WalkContinue
	})

	// 将原来所有折叠标题对应的下方节点移动到新节点下
	var updateFoldHeadings []*ast.Node
	ast.Walk(updateNode, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeHeading == n.Type && "1" == n.IALAttr("fold") {
			updateFoldHeadings = append(updateFoldHeadings, n)
		}
		return ast.WalkContinue
	})
	for _, h := range updateFoldHeadings {
		children := foldHeadings[h.ID]
		for i := len(children) - 1; 0 <= i; i-- {
			h.Next.InsertAfter(children[i]) // Next 是 Block IAL
		}
	}
	return
}

func IsInFoldedHeading(node, currentHeading *ast.Node) bool {
	if nil == node {
		return false
	}

	if ast.NodeSuperBlock == node.Type {
		// The super block below the folded heading contains headings of the same level and cannot be loaded https://github.com/siyuan-note/siyuan/issues/9162
		if nil == currentHeading {
			return false
		}

		sbChildHeading := SuperBlockHeading(node)
		if nil != sbChildHeading {
			if sbChildHeading.HeadingLevel <= currentHeading.HeadingLevel {
				return false
			}
		}
	}

	heading := HeadingParent(node)
	if nil == heading {
		return false
	}
	if "1" == heading.IALAttr("heading-fold") || "1" == heading.IALAttr("fold") {
		return true
	}
	if heading == currentHeading {
		// node 就在当前标题层级下的话不递归继续查询，直接返回不折叠
		return false
	}
	return IsInFoldedHeading(heading, currentHeading)
}

func GetHeadingFold(nodes []*ast.Node) (ret []*ast.Node) {
	for _, n := range nodes {
		if "1" == n.IALAttr("heading-fold") {
			ret = append(ret, n)
		}
	}
	return
}

func HeadingChildren(heading *ast.Node) (ret []*ast.Node) {
	start := heading.Next
	if nil == start {
		return
	}
	if ast.NodeKramdownBlockIAL == start.Type {
		start = start.Next // 跳过 heading 的 IAL
	}

	currentLevel := heading.HeadingLevel
	for n := start; nil != n; n = n.Next {
		if ast.NodeHeading == n.Type {
			if currentLevel >= n.HeadingLevel {
				break
			}
		} else if ast.NodeSuperBlock == n.Type {
			if h := SuperBlockHeading(n); nil != h {
				if currentLevel >= h.HeadingLevel {
					break
				}
			}
		} else if ast.NodeSuperBlockCloseMarker == n.Type {
			continue
		}
		ret = append(ret, n)
	}
	return
}

func SuperBlockHeading(sb *ast.Node) *ast.Node {
	c := sb.FirstChild.Next.Next
	if nil == c {
		return nil
	}

	if ast.NodeHeading == c.Type {
		return c
	}

	if ast.NodeSuperBlock == c.Type {
		return SuperBlockHeading(c)
	}
	return nil
}

func SuperBlockLastHeading(sb *ast.Node) *ast.Node {
	headings := sb.ChildrenByType(ast.NodeHeading)
	if 0 < len(headings) {
		return headings[len(headings)-1]
	}
	return nil
}

func HeadingParent(node *ast.Node) *ast.Node {
	if nil == node {
		return nil
	}

	currentLevel := 16
	if ast.NodeHeading == node.Type {
		currentLevel = node.HeadingLevel
	}

	for n := node.Previous; nil != n; n = n.Previous {
		if ast.NodeHeading == n.Type && n.HeadingLevel < currentLevel {
			return n
		}
	}
	return node.Parent
}

func HeadingLevel(node *ast.Node) int {
	if nil == node {
		return 0
	}

	for n := node; nil != n; n = n.Previous {
		if ast.NodeHeading == n.Type {
			return n.HeadingLevel
		}
	}
	return 0
}

func TopHeadingLevel(tree *parse.Tree) (ret int) {
	ret = 7
	for n := tree.Root.FirstChild; nil != n; n = n.Next {
		if ast.NodeHeading == n.Type {
			if ret > n.HeadingLevel {
				ret = n.HeadingLevel
			}
		}
	}
	if 7 == ret { // 没有出现过标题时
		ret = 0
	}
	return
}
