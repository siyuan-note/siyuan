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
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/html/atom"
	"github.com/88250/lute/parse"
	luteutil "github.com/88250/lute/util"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// normalizeImportedHTMLTextStyles 将含文本样式的 Markdown HTML 块转换为可编辑的原生块。
func normalizeImportedHTMLTextStyles(tree *parse.Tree) {
	var blocks []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.Type == ast.NodeHTMLBlock {
			blocks = append(blocks, n)
		}
		return ast.WalkContinue
	})
	engine := util.NewLute()
	engine.SetHTMLTag2TextMark(true)
	for _, block := range blocks {
		dom := luteutil.ParseHTML(block.TokensStr())
		var styled func(*html.Node) bool
		styled = func(n *html.Node) bool {
			if n == nil || n.DataAtom == atom.Pre || n.DataAtom == atom.Script || n.DataAtom == atom.Style {
				return false
			}
			if parse.ResolveHTMLTextStyle(n, parse.HTMLTextStyle{}).CSS() != "" {
				return true
			}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				if styled(c) {
					return true
				}
			}
			return false
		}
		if !styled(dom) {
			continue
		}
		converted := engine.HTMLNode2Tree(dom)
		if converted == nil || converted.Root.FirstChild == nil {
			continue
		}
		for c := converted.Root.FirstChild; c != nil; {
			next := c.Next
			block.InsertBefore(c)
			c = next
		}
		block.Unlink()
	}
}
