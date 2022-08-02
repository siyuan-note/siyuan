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
	"bytes"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func renderOutline(node *ast.Node, luteEngine *lute.Lute) (ret string) {
	if nil == node {
		return ""
	}

	if ast.NodeDocument == node.Type {
		return node.IALAttr("title")
	}

	buf := bytes.Buffer{}
	buf.Grow(4096)
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		switch n.Type {
		case ast.NodeTagOpenMarker, ast.NodeTagCloseMarker:
			buf.WriteByte('#')
		case ast.NodeBlockRef:
			buf.WriteString(html.EscapeString(treenode.GetDynamicBlockRefText(n)))
			return ast.WalkSkipChildren
		case ast.NodeText, ast.NodeLinkText, ast.NodeFileAnnotationRefText, ast.NodeFootnotesRef, ast.NodeCodeBlockCode, ast.NodeMathBlockContent:
			tokens := html.EscapeHTML(n.Tokens)
			tokens = bytes.ReplaceAll(tokens, []byte(" "), []byte("&nbsp;")) // 大纲面板条目中无法显示多个空格 https://github.com/siyuan-note/siyuan/issues/4370
			buf.Write(tokens)
		case ast.NodeInlineMath, ast.NodeStrong, ast.NodeEmphasis, ast.NodeCodeSpan:
			dom := lute.RenderNodeBlockDOM(n, luteEngine.ParseOptions, luteEngine.RenderOptions)
			buf.WriteString(dom)
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})

	ret = strings.TrimSpace(buf.String())
	ret = strings.ReplaceAll(ret, "\n", "")
	return
}

func renderBlockText(node *ast.Node) (ret string) {
	ret = treenode.NodeStaticContent(node)
	ret = strings.TrimSpace(ret)
	ret = strings.ReplaceAll(ret, "\n", "")
	ret = html.EscapeString(ret)
	ret = strings.TrimSpace(ret)
	if "" == ret {
		// 复制内容为空的块作为块引用时粘贴无效 https://github.com/siyuan-note/siyuan/issues/4962
		buf := bytes.Buffer{}
		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if ast.NodeImage == n.Type {
				title := n.ChildByType(ast.NodeLinkTitle)
				if nil == title {
					alt := n.ChildByType(ast.NodeLinkText)
					if nil != alt && 0 < len(alt.Tokens) {
						buf.Write(alt.Tokens)
					} else {
						buf.WriteString("image")
					}
				} else {
					buf.Write(title.Tokens)
				}
			}
			return ast.WalkContinue
		})
		ret = buf.String()
	}
	return
}

func renderBlockDOMByNodes(nodes []*ast.Node, luteEngine *lute.Lute) string {
	tree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}, Context: &parse.Context{ParseOption: luteEngine.ParseOptions}}
	blockRenderer := render.NewBlockRenderer(tree, luteEngine.RenderOptions)
	for _, n := range nodes {
		ast.Walk(n, func(node *ast.Node, entering bool) ast.WalkStatus {
			rendererFunc := blockRenderer.RendererFuncs[node.Type]
			return rendererFunc(node, entering)
		})
	}
	h := strings.TrimSpace(blockRenderer.Writer.String())
	if strings.HasPrefix(h, "<li") {
		h = "<ul>" + h + "</ul>"
	}
	return h
}

func renderBlockMarkdownR(id string) string {
	var rendered []string
	nodes := renderBlockMarkdownR0(id, &rendered)
	buf := bytes.Buffer{}
	buf.Grow(4096)
	luteEngine := NewLute()
	for _, n := range nodes {
		md := treenode.FormatNode(n, luteEngine)
		buf.WriteString(md)
		buf.WriteString("\n\n")
	}
	return buf.String()
}

func renderBlockMarkdownR0(id string, rendered *[]string) (ret []*ast.Node) {
	if gulu.Str.Contains(id, *rendered) {
		return
	}
	*rendered = append(*rendered, id)

	b := treenode.GetBlockTree(id)
	if nil == b {
		return
	}

	var err error
	var t *parse.Tree
	if t, err = loadTreeByBlockID(b.ID); nil != err {
		return
	}
	node := treenode.GetNodeInTree(t, b.ID)
	if nil == node {
		return
	}

	var children []*ast.Node
	if ast.NodeHeading == node.Type {
		children = append(children, node)
		children = append(children, treenode.HeadingChildren(node)...)
	} else if ast.NodeDocument == node.Type {
		for c := node.FirstChild; nil != c; c = c.Next {
			children = append(children, c)
		}
	} else {
		children = append(children, node)
	}

	for _, child := range children {
		var unlinks, inserts []*ast.Node
		ast.Walk(child, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			if ast.NodeBlockQueryEmbed == n.Type {
				stmt := n.ChildByType(ast.NodeBlockQueryEmbedScript).TokensStr()
				stmt = html.UnescapeString(stmt)
				sqlBlocks := sql.SelectBlocksRawStmt(stmt, Conf.Search.Limit)
				for _, sqlBlock := range sqlBlocks {
					subNodes := renderBlockMarkdownR0(sqlBlock.ID, rendered)
					for _, subNode := range subNodes {
						inserts = append(inserts, subNode)
					}
				}
				unlinks = append(unlinks, n)
				return ast.WalkSkipChildren
			}
			return ast.WalkContinue
		})
		for _, n := range unlinks {
			n.Unlink()
		}

		if ast.NodeBlockQueryEmbed != child.Type {
			ret = append(ret, child)
		} else {
			for _, n := range inserts {
				ret = append(ret, n)
			}
		}

	}
	return
}

func renderBlockMarkdown(node *ast.Node) string {
	var nodes []*ast.Node
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			nodes = append(nodes, n)
			if ast.NodeHeading == node.Type {
				// 支持“标题块”引用
				children := treenode.HeadingChildren(n)
				nodes = append(nodes, children...)
			}
		}
		return ast.WalkSkipChildren
	})

	root := &ast.Node{Type: ast.NodeDocument}
	luteEngine := NewLute()
	luteEngine.SetKramdownIAL(false)
	luteEngine.SetSuperBlock(false)
	tree := &parse.Tree{Root: root, Context: &parse.Context{ParseOption: luteEngine.ParseOptions}}
	renderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions)
	renderer.Writer = &bytes.Buffer{}
	renderer.Writer.Grow(4096)
	renderer.NodeWriterStack = append(renderer.NodeWriterStack, renderer.Writer) // 因为有可能不是从 root 开始渲染，所以需要初始化
	for _, node := range nodes {
		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			rendererFunc := renderer.RendererFuncs[n.Type]
			return rendererFunc(n, entering)
		})
	}
	return strings.TrimSpace(renderer.Writer.String())
}
