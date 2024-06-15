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
	"bytes"
	"github.com/88250/lute/editor"
	"regexp"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func renderOutline(heading *ast.Node, luteEngine *lute.Lute) (ret string) {
	if nil == heading {
		return ""
	}

	if ast.NodeDocument == heading.Type {
		return heading.IALAttr("title")
	}

	buf := bytes.Buffer{}
	buf.Grow(4096)
	ast.Walk(heading, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			switch n.Type {
			case ast.NodeHeading:
				// Show heading block appearance style in the Outline Panel https://github.com/siyuan-note/siyuan/issues/7872
				if style := n.IALAttr("style"); "" != style {
					buf.WriteString("</span>")
				}
			}
			return ast.WalkContinue
		}

		if style := n.IALAttr("style"); "" != style {
			if strings.Contains(style, "font-size") { // 大纲字号不应该跟随字体设置 https://github.com/siyuan-note/siyuan/issues/7202
				style = regexp.MustCompile("font-size:.*?;").ReplaceAllString(style, "font-size: inherit;")
				n.SetIALAttr("style", style)
			}
		}

		switch n.Type {
		case ast.NodeHeading:
			// Show heading block appearance style in the Outline Panel https://github.com/siyuan-note/siyuan/issues/7872
			if style := n.IALAttr("style"); "" != style {
				buf.WriteString("<span style=\"")
				buf.WriteString(style)
				buf.WriteString("\">")
			}
		case ast.NodeText, ast.NodeLinkText, ast.NodeCodeBlockCode, ast.NodeMathBlockContent:
			tokens := html.EscapeHTML(n.Tokens)
			tokens = bytes.ReplaceAll(tokens, []byte(" "), []byte("&nbsp;")) // 大纲面板条目中无法显示多个空格 https://github.com/siyuan-note/siyuan/issues/4370
			buf.Write(tokens)
		case ast.NodeBackslashContent:
			buf.Write(n.Tokens)
		case ast.NodeTextMark:
			dom := luteEngine.RenderNodeBlockDOM(n)
			buf.WriteString(dom)
			return ast.WalkSkipChildren
		case ast.NodeImage:
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})

	ret = strings.TrimSpace(buf.String())
	ret = strings.ReplaceAll(ret, "\n", "")
	return
}

func renderBlockText(node *ast.Node, excludeTypes []string) (ret string) {
	if nil == node {
		return
	}

	ret = sql.NodeStaticContent(node, excludeTypes, false, false, false, GetBlockAttrsWithoutWaitWriting)
	ret = strings.TrimSpace(ret)
	ret = strings.ReplaceAll(ret, "\n", "")
	ret = util.EscapeHTML(ret)
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
	blockRenderer := render.NewProtyleRenderer(tree, luteEngine.RenderOptions)
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

func renderBlockContentByNodes(nodes []*ast.Node) string {
	var subNodes []*ast.Node
	for _, n := range nodes {
		if ast.NodeDocument == n.Type {
			for c := n.FirstChild; nil != c; c = c.Next {
				subNodes = append(subNodes, c)
			}
		} else {
			subNodes = append(subNodes, n)
		}
	}

	buf := bytes.Buffer{}
	for _, n := range subNodes {
		buf.WriteString(sql.NodeStaticContent(n, nil, false, false, false, GetBlockAttrsWithoutWaitWriting))
	}
	return buf.String()
}

func resolveEmbedR(n *ast.Node, blockEmbedMode int, luteEngine *lute.Lute, resolved *[]string) {
	var children []*ast.Node
	if ast.NodeHeading == n.Type {
		children = append(children, n)
		children = append(children, treenode.HeadingChildren(n)...)
	} else if ast.NodeDocument == n.Type {
		for c := n.FirstChild; nil != c; c = c.Next {
			children = append(children, c)
		}
	} else {
		children = append(children, n)
	}

	for _, child := range children {
		var unlinks []*ast.Node
		ast.Walk(child, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			if ast.NodeBlockQueryEmbed == n.Type {
				if gulu.Str.Contains(n.ID, *resolved) {
					return ast.WalkContinue
				}
				*resolved = append(*resolved, n.ID)

				stmt := n.ChildByType(ast.NodeBlockQueryEmbedScript).TokensStr()
				stmt = html.UnescapeString(stmt)
				stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")
				sqlBlocks := sql.SelectBlocksRawStmt(stmt, 1, Conf.Search.Limit)
				for _, sqlBlock := range sqlBlocks {
					md := sqlBlock.Markdown

					if "d" == sqlBlock.Type {
						subTree, _ := LoadTreeByBlockID(sqlBlock.ID)
						md, _ = lute.FormatNodeSync(subTree.Root, luteEngine.ParseOptions, luteEngine.RenderOptions)
					} // 标题块不需要再单独解析，直接使用 Markdown，函数开头处会处理

					buf := &bytes.Buffer{}
					lines := strings.Split(md, "\n")
					for i, line := range lines {
						if 0 == blockEmbedMode { // 使用原始文本
							buf.WriteString(line)
						} else { // 使用引述块
							buf.WriteString("> " + line)
						}
						if i < len(lines)-1 {
							buf.WriteString("\n")
						}
					}
					buf.WriteString("\n\n")

					subTree := parse.Parse("", buf.Bytes(), luteEngine.ParseOptions)
					var inserts []*ast.Node
					for subNode := subTree.Root.FirstChild; nil != subNode; subNode = subNode.Next {
						if ast.NodeKramdownBlockIAL != subNode.Type {
							inserts = append(inserts, subNode)
						}
					}
					for _, insert := range inserts {
						n.InsertBefore(insert)
						resolveEmbedR(insert, blockEmbedMode, luteEngine, resolved)
					}
				}
				unlinks = append(unlinks, n)
				return ast.WalkSkipChildren
			}
			return ast.WalkContinue
		})
		for _, unlink := range unlinks {
			unlink.Unlink()
		}
	}
	return
}

func renderBlockMarkdownR(id string, rendered *[]string) (ret []*ast.Node) {
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
	if t, err = LoadTreeByBlockID(b.ID); nil != err {
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
				stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")
				sqlBlocks := sql.SelectBlocksRawStmt(stmt, 1, Conf.Search.Limit)
				for _, sqlBlock := range sqlBlocks {
					subNodes := renderBlockMarkdownR(sqlBlock.ID, rendered)
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
