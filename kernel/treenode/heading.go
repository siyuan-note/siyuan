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
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

// IsSelfFolded 判断块是否处于自身折叠状态。heading-fold 是旧版标题折叠向后代注入的临时标记，
// 同时存在时 fold 不代表块自身状态。
func IsSelfFolded(node *ast.Node) bool {
	return nil != node && "1" == node.IALAttr("fold") && "1" != node.IALAttr("heading-fold")
}

// SetSelfFolded 设置块自身的折叠状态。显式设置后需要移除旧版 heading-fold 标记，
// 以便后续能够区分用户状态和旧版标题折叠的派生状态。
func SetSelfFolded(node *ast.Node, folded bool) {
	if nil == node {
		return
	}

	node.RemoveIALAttr("heading-fold")
	if folded {
		node.SetIALAttr("fold", "1")
	} else {
		node.RemoveIALAttr("fold")
	}
}

// ClearLegacyHeadingFold 清理旧版标题折叠向块注入的派生状态。
func ClearLegacyHeadingFold(node *ast.Node) bool {
	if nil == node || "1" != node.IALAttr("heading-fold") {
		return false
	}

	node.RemoveIALAttr("heading-fold")
	node.RemoveIALAttr("fold")
	return true
}

func MoveFoldHeading(updateNode, oldNode *ast.Node) {
	foldHeadings := map[string][]*ast.Node{}
	// 找到原有节点中所有折叠标题节点的下方节点
	ast.Walk(oldNode, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeHeading == n.Type && IsSelfFolded(n) {
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

		if ast.NodeHeading == n.Type && IsSelfFolded(n) {
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
}

// FoldHeadingStack 用于正向扫描文档同级子块序列时维护「当前生效的折叠标题」层级栈。
// 语义：某个块被隐藏 = 其上方存在更高级（层级数更小）且 fold=1 的标题盖住它；
// 折叠标题自身仍然渲染（保留 fold=1），只是其后更深层级的块被省略。
// 批量路径（加载等）用它做一次 O(N) 扫描，避免逐块回溯 IsInFoldedHeading 造成的 O(N²)。
type FoldHeadingStack struct {
	levels []int     // 当前生效的折叠标题层级栈，栈顶层级最深（数值最大）
	last   *ast.Node // 最近一次 Enter 的节点，供 Hidden 判断折叠标题自身是否可见
}

// Enter 在正向遍历到节点 n 时调用，维护折叠标题层级栈。
// 必须按文档顺序对同一层级的兄弟节点序列依次调用（通常是文档根或容器块的直接子节点）。
func (s *FoldHeadingStack) Enter(n *ast.Node) {
	s.last = n
	if ast.NodeHeading != n.Type {
		return
	}

	// 遇到同级或更高级标题：这些更深的折叠范围到此结束，先出栈
	for 0 < len(s.levels) && s.levels[len(s.levels)-1] >= n.HeadingLevel {
		s.levels = s.levels[:len(s.levels)-1]
	}

	// 当前标题自身折叠时入栈，其后更深层级的兄弟块都被它盖住
	if IsSelfFolded(n) {
		s.levels = append(s.levels, n.HeadingLevel)
	}
}

// Hidden 返回最近一次 Enter 的块是否应被隐藏（被祖先折叠标题盖住）。
// 折叠标题节点自身仍可见（除非它又被更浅的折叠标题盖住），其余落在折叠范围内的块返回 true。
func (s *FoldHeadingStack) Hidden() bool {
	depth := len(s.levels)
	if 0 == depth {
		return false
	}

	if n := s.last; nil != n && ast.NodeHeading == n.Type && IsSelfFolded(n) && s.levels[depth-1] == n.HeadingLevel {
		// 折叠标题自身刚入栈：仅当它还被更浅的折叠标题盖住时才隐藏
		return 1 < depth
	}
	return true
}

// CollectFoldHiddenNodes 按容器层级用折叠层级栈标记被折叠标题盖住的块，返回应被剔除的节点列表。
// 被隐藏的整棵子树只收集其顶端一次（无需再递归其内部）；折叠标题节点自身不会被收集（仍可见）。
func CollectFoldHiddenNodes(parent *ast.Node) (unlinks []*ast.Node) {
	if nil == parent {
		return
	}

	collectFoldHiddenNodes(parent, &unlinks)
	return
}

func collectFoldHiddenNodes(parent *ast.Node, unlinks *[]*ast.Node) {
	var stack FoldHeadingStack
	for n := parent.FirstChild; nil != n; n = n.Next {
		stack.Enter(n)
		if stack.Hidden() {
			*unlinks = append(*unlinks, n)
			continue
		}

		if ast.NodeDocument == n.Type || n.IsContainerBlock() {
			collectFoldHiddenNodes(n, unlinks)
		}
	}
}

// IsInFoldedHeading 单点查询块是否位于折叠标题下方。禁止在批量热路径对每个块反复调用，改用 FoldHeadingStack。
func IsInFoldedHeading(node, currentHeading *ast.Node) bool {
	if nil == node {
		return false
	}

	heading := HeadingParent(node)
	if nil == heading {
		return false
	}
	if ast.NodeHeading == heading.Type {
		if IsSelfFolded(heading) {
			return true
		}
		if heading == currentHeading {
			// node 就在当前标题层级下的话不递归继续查询，直接返回不折叠
			return false
		}
	}
	return IsInFoldedHeading(heading, currentHeading)
}

func GetParentFoldedHeading(node *ast.Node) (parentFoldedHeading *ast.Node) {
	if nil == node {
		return
	}

	currentLevel := 7
	if ast.NodeHeading == node.Type {
		currentLevel = node.HeadingLevel
	}
	for n := node.Previous; nil != n; n = n.Previous {
		if ast.NodeHeading != n.Type {
			continue
		}

		if n.HeadingLevel >= currentLevel {
			continue
		}
		currentLevel = n.HeadingLevel

		if IsSelfFolded(n) {
			if ast.NodeHeading != node.Type {
				parentFoldedHeading = n
			}
			if n.HeadingLevel < node.HeadingLevel {
				parentFoldedHeading = n
			}
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
		if ast.NodeSuperBlockCloseMarker == n.Type {
			break
		}
		if ast.NodeHeading == n.Type {
			if currentLevel >= n.HeadingLevel {
				break
			}
		}
		ret = append(ret, n)
	}
	return
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

// HeadingDirectChildren 返回语义父标题为 heading 的直接子标题。
func HeadingDirectChildren(heading *ast.Node) (ret []*ast.Node) {
	if nil == heading || ast.NodeHeading != heading.Type || nil == heading.Parent {
		return
	}

	parents := headingParents(heading.Parent)
	for n := heading.Parent.FirstChild; nil != n; n = n.Next {
		if ast.NodeHeading == n.Type && parents[n] == heading {
			ret = append(ret, n)
		}
	}
	return
}

// HeadingSiblings 返回与 heading 位于同一容器、语义父级和标题级别的标题。
func HeadingSiblings(heading *ast.Node) (ret []*ast.Node) {
	if nil == heading || ast.NodeHeading != heading.Type || nil == heading.Parent {
		return
	}

	parents := headingParents(heading.Parent)
	parent := parents[heading]
	for n := heading.Parent.FirstChild; nil != n; n = n.Next {
		if ast.NodeHeading == n.Type && n.HeadingLevel == heading.HeadingLevel && parents[n] == parent {
			ret = append(ret, n)
		}
	}
	return
}

// headingParents 一次扫描同一容器中的标题，计算每个标题的语义父级。
func headingParents(parent *ast.Node) (ret map[*ast.Node]*ast.Node) {
	ret = map[*ast.Node]*ast.Node{}
	if nil == parent {
		return
	}

	var levels [7]*ast.Node
	for n := parent.FirstChild; nil != n; n = n.Next {
		if ast.NodeHeading != n.Type {
			continue
		}
		if n.HeadingLevel < 1 || 6 < n.HeadingLevel {
			ret[n] = parent
			continue
		}

		semanticParent := parent
		for level := n.HeadingLevel - 1; 1 <= level; level-- {
			if nil != levels[level] {
				semanticParent = levels[level]
				break
			}
		}
		ret[n] = semanticParent
		for level := n.HeadingLevel; level <= 6; level++ {
			levels[level] = nil
		}
		levels[n.HeadingLevel] = n
	}
	return
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
