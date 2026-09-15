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

const embedHeadingLevelAttr = "custom-heading-level"

func explicitEmbedHeadingLevel(embed *ast.Node, targetID string) int {
	if targetID == "" || treenode.GetEmbedBlockRef(embed) != targetID {
		return 0
	}
	value := embed.IALAttr(embedHeadingLevelAttr)
	if len(value) != 1 || value[0] < '1' || value[0] > '6' {
		return 0
	}
	return int(value[0] - '0')
}

// adjustEmbedHeadingLevels 以可见标题的最高层级为基准，仅调整渲染副本。
func adjustEmbedHeadingLevels(nodes []*ast.Node, level int) {
	if level < 1 || level > 6 {
		return
	}
	var headings []*ast.Node
	topLevel := 7
	for _, node := range nodes {
		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && n.Type == ast.NodeHeading {
				headings = append(headings, n)
				if n.HeadingLevel < topLevel {
					topLevel = n.HeadingLevel
				}
			}
			return ast.WalkContinue
		})
	}
	for _, heading := range headings {
		heading.HeadingLevel += level - topLevel
		heading.HeadingSetext = false
		if heading.HeadingLevel <= 6 {
			if marker := heading.ChildByType(ast.NodeHeadingC8hMarker); marker != nil {
				marker.Tokens = []byte(strings.Repeat("#", heading.HeadingLevel))
			}
			continue
		}
		heading.Type = ast.NodeParagraph
		heading.HeadingLevel = 0
		strong := &ast.Node{Type: ast.NodeStrong}
		strong.AppendChild(&ast.Node{Type: ast.NodeStrongA6kOpenMarker, Tokens: []byte("**")})
		for child := heading.FirstChild; child != nil; {
			next := child.Next
			if child.Type == ast.NodeHeadingC8hMarker || child.Type == ast.NodeHeadingID {
				child.Unlink()
			} else {
				strong.AppendChild(child)
			}
			child = next
		}
		strong.AppendChild(&ast.Node{Type: ast.NodeStrongA6kCloseMarker, Tokens: []byte("**")})
		heading.AppendChild(strong)
	}
}
