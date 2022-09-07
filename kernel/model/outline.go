// SiYuan - Build Your Eternal Digital Garden
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
	"time"

	"github.com/88250/lute/ast"
	"github.com/emirpasic/gods/stacks/linkedliststack"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func Outline(rootID string) (ret []*Path, err error) {
	time.Sleep(512 * time.Millisecond /* 前端队列轮询间隔 */)
	WaitForWritingFiles()

	ret = []*Path{}
	tree, _ := loadTreeByBlockID(rootID)
	if nil == tree {
		return
	}

	luteEngine := NewLute()
	var headings []*Block
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeHeading == n.Type && !n.ParentIs(ast.NodeBlockquote) {
			n.Box, n.Path = tree.Box, tree.Path
			block := &Block{
				RootID:  rootID,
				Depth:   n.HeadingLevel,
				Box:     n.Box,
				Path:    n.Path,
				ID:      n.ID,
				Content: renderOutline(n, luteEngine),
				Type:    n.Type.String(),
				SubType: treenode.SubTypeAbbr(n),
			}
			headings = append(headings, block)
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})

	if 1 > len(headings) {
		return
	}

	var blocks []*Block
	stack := linkedliststack.New()
	for _, h := range headings {
	L:
		for ; ; stack.Pop() {
			cur, ok := stack.Peek()
			if !ok {
				blocks = append(blocks, h)
				stack.Push(h)
				break L
			}

			tip := cur.(*Block)
			if tip.Depth < h.Depth {
				tip.Children = append(tip.Children, h)
				stack.Push(h)
				break L
			}
			tip.Count = len(tip.Children)
		}
	}

	ret = toFlatTree(blocks, 0, "outline")
	if 0 < len(ret) {
		children := ret[0].Blocks
		ret = nil
		for _, b := range children {
			resetDepth(b, 0)
			ret = append(ret, &Path{
				ID:       b.ID,
				Box:      b.Box,
				Name:     b.Content,
				NodeType: b.Type,
				Type:     "outline",
				SubType:  b.SubType,
				Blocks:   b.Children,
				Depth:    0,
				Count:    b.Count,
			})
		}
	}
	return
}

func resetDepth(b *Block, depth int) {
	b.Depth = depth
	b.Count = len(b.Children)
	for _, c := range b.Children {
		resetDepth(c, depth+1)
	}
}
