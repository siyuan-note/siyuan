// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
