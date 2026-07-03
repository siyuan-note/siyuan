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

package model

import (
	"strconv"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

// HeadingNumbers 返回编辑器内使用的标题编号，键为块 ID。
// 文档中实际出现的最小标题级别作为第一层编号。
// 缺失的上级标题层级使用 0 占位，例如最小级别是 H2 时，出现在任何 H2/H3 前的 H4 编号为 0.0.1。
func HeadingNumbers(tree *parse.Tree) map[string]string {
	ret := map[string]string{}
	if nil == tree || nil == tree.Root {
		return ret
	}

	headings := []*ast.Node{}
	minLevel := 7
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if ast.NodeBlockquote == n.Type || ast.NodeCallout == n.Type || ast.NodeBlockQueryEmbed == n.Type {
			return ast.WalkSkipChildren
		}
		if ast.NodeHeading != n.Type {
			return ast.WalkContinue
		}

		level := n.HeadingLevel
		if level < 1 || 6 < level {
			return ast.WalkSkipChildren
		}

		headings = append(headings, n)
		if level < minLevel {
			minLevel = level
		}
		return ast.WalkSkipChildren
	})
	if 0 == len(headings) {
		return ret
	}

	counters := []int{0, 0, 0, 0, 0, 0}
	for _, heading := range headings {
		level := heading.HeadingLevel - minLevel + 1
		counters[level-1]++
		for i := level; i < len(counters); i++ {
			counters[i] = 0
		}

		parts := make([]string, level)
		for i := 0; i < level; i++ {
			parts[i] = strconv.Itoa(counters[i])
		}
		ret[heading.ID] = strings.Join(parts, ".")
	}

	return ret
}
