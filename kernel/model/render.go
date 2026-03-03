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
	"regexp"
	"strconv"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/av"
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
			buf.Write(html.EscapeHTML(n.Tokens))
		case ast.NodeTextMark:
			dom := luteEngine.RenderNodeBlockDOM(n)
			buf.WriteString(dom)
			return ast.WalkSkipChildren
		case ast.NodeEmoji:
			dom := luteEngine.RenderNodeBlockDOM(n)
			buf.WriteString(dom)
			return ast.WalkSkipChildren
		case ast.NodeImage:
			if title := n.ChildByType(ast.NodeLinkTitle); nil != title {
				// 标题后直接跟图片时图片的提示文本不再渲染到大纲中 https://github.com/siyuan-note/siyuan/issues/6278
				title.Unlink()
			}
			dom := luteEngine.RenderNodeBlockDOM(n)
			buf.WriteString(dom)
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})

	ret = strings.TrimSpace(buf.String())
	ret = strings.ReplaceAll(ret, "\n", "")
	return
}

func renderBlockText(node *ast.Node, excludeTypes []string, removeLineBreak bool) (ret string) {
	if nil == node {
		return
	}

	ret = sql.NodeStaticContent(node, excludeTypes, false, false, false)
	ret = strings.TrimSpace(ret)
	if removeLineBreak {
		ret = strings.ReplaceAll(ret, "\n", "")
	}
	ret = util.UnescapeHTML(ret)
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

func fillBlockRefCount(nodes []*ast.Node) {
	var defIDs []string
	for _, n := range nodes {
		ast.Walk(n, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if n.IsBlock() {
				defIDs = append(defIDs, n.ID)
			}
			return ast.WalkContinue
		})
	}
	defIDs = gulu.Str.RemoveDuplicatedElem(defIDs)
	refCount := sql.QueryRefCount(defIDs)
	for _, n := range nodes {
		ast.Walk(n, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			if cnt := refCount[n.ID]; 0 < cnt {
				n.SetIALAttr("refcount", strconv.Itoa(cnt))
			}
			return ast.WalkContinue
		})
	}
}

func renderBlockDOMByNodes(nodes []*ast.Node, luteEngine *lute.Lute) string {
	tree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}, Context: &parse.Context{ParseOption: luteEngine.ParseOptions}}
	blockRenderer := render.NewProtyleRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	for _, node := range nodes {
		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering {
				if n.IsBlock() {
					if avs := n.IALAttr(av.NodeAttrNameAvs); "" != avs {
						// 填充属性视图角标 Display the database title on the block superscript https://github.com/siyuan-note/siyuan/issues/10545
						avNames := getAvNames(n.IALAttr(av.NodeAttrNameAvs))
						if "" != avNames {
							n.SetIALAttr(av.NodeAttrViewNames, avNames)
						}
					}
				}
			}

			rendererFunc := blockRenderer.RendererFuncs[n.Type]
			return rendererFunc(n, entering)
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
		buf.WriteString(sql.NodeStaticContent(n, nil, false, false, false))
	}
	return buf.String()
}

func resolveEmbedR(n *ast.Node, blockEmbedMode int, luteEngine *lute.Lute, resolved *[]string, depth *int) {
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

	*depth++
	if 7 < *depth {
		return
	}

	for _, child := range children {
		var unlinks []*ast.Node

		parentHeadingLevel := 0
		for prev := child; nil != prev; prev = prev.Previous {
			if ast.NodeHeading == prev.Type {
				parentHeadingLevel = prev.HeadingLevel
				break
			}
		}

		ast.Walk(child, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			if ast.NodeBlockQueryEmbed != n.Type {
				return ast.WalkContinue
			}

			if gulu.Str.Contains(n.ID, *resolved) {
				return ast.WalkContinue
			}
			*resolved = append(*resolved, n.ID)

			stmt := n.ChildByType(ast.NodeBlockQueryEmbedScript).TokensStr()
			stmt = html.UnescapeString(stmt)
			stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")
			sqlBlocks := sql.SelectBlocksRawStmt(stmt, 1, Conf.Search.Limit)
			for _, sqlBlock := range sqlBlocks {
				if "query_embed" == sqlBlock.Type {
					continue
				}

				subTree, _ := LoadTreeByBlockID(sqlBlock.ID)
				if nil == subTree {
					continue
				}

				var md string
				if "d" == sqlBlock.Type {
					if 0 == blockEmbedMode {
						// 嵌入块中出现了大于等于上方非嵌入块的标题时需要降低嵌入块中的标题级别
						// Improve export of heading levels in embedded blocks https://github.com/siyuan-note/siyuan/issues/12233 https://github.com/siyuan-note/siyuan/issues/12741
						embedTopLevel := 0
						ast.Walk(subTree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
							if !entering || ast.NodeHeading != n.Type {
								return ast.WalkContinue
							}

							embedTopLevel = n.HeadingLevel
							if parentHeadingLevel >= embedTopLevel {
								n.HeadingLevel += parentHeadingLevel - embedTopLevel + 1
								if 6 < n.HeadingLevel {
									n.HeadingLevel = 6
								}
							}
							return ast.WalkContinue
						})
					}

					md, _ = lute.FormatNodeSync(subTree.Root, luteEngine.ParseOptions, luteEngine.RenderOptions)
				} else if "h" == sqlBlock.Type {
					h := treenode.GetNodeInTree(subTree, sqlBlock.ID)
					var hChildren []*ast.Node

					// 从嵌入块的 IAL 属性中解析 custom-heading-mode，使用全局配置作为默认值
					blockHeadingMode := Conf.Editor.HeadingEmbedMode
					if customHeadingMode := n.IALAttr("custom-heading-mode"); "" != customHeadingMode {
						if mode, err := strconv.Atoi(customHeadingMode); nil == err && (mode == 0 || mode == 1 || mode == 2) {
							blockHeadingMode = mode
						}
					}

					// 根据 blockHeadingMode 处理标题块的显示
					// blockHeadingMode: 0=显示标题与下方的块，1=仅显示标题，2=仅显示标题下方的块
					if 1 == blockHeadingMode {
						// 仅显示标题
						hChildren = append(hChildren, h)
					} else if 2 == blockHeadingMode {
						// 仅显示标题下方的块（默认行为）
						if "1" != h.IALAttr("fold") {
							children := treenode.HeadingChildren(h)
							for _, c := range children {
								if "1" == c.IALAttr("heading-fold") {
									// 嵌入块包含折叠标题时不应该显示其下方块 https://github.com/siyuan-note/siyuan/issues/4765
									continue
								}
								hChildren = append(hChildren, c)
							}
						}
					} else {
						// 0: 显示标题与下方的块
						hChildren = append(hChildren, h)
						hChildren = append(hChildren, treenode.HeadingChildren(h)...)
					}
					if 0 == blockEmbedMode {
						embedTopLevel := 0
						for _, hChild := range hChildren {
							if ast.NodeHeading == hChild.Type {
								embedTopLevel = hChild.HeadingLevel
								break
							}
						}
						if parentHeadingLevel >= embedTopLevel {
							for _, hChild := range hChildren {
								if ast.NodeHeading == hChild.Type {
									hChild.HeadingLevel += parentHeadingLevel - embedTopLevel + 1
									if 6 < hChild.HeadingLevel {
										hChild.HeadingLevel = 6
									}
								}
							}
						}
					}

					mdBuf := &bytes.Buffer{}
					for _, hChild := range hChildren {
						md, _ = lute.FormatNodeSync(hChild, luteEngine.ParseOptions, luteEngine.RenderOptions)
						mdBuf.WriteString(md)
						mdBuf.WriteString("\n\n")
					}
					md = mdBuf.String()
				} else {
					node := treenode.GetNodeInTree(subTree, sqlBlock.ID)
					md, _ = lute.FormatNodeSync(node, luteEngine.ParseOptions, luteEngine.RenderOptions)
				}

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

				subTree = parse.Parse("", buf.Bytes(), luteEngine.ParseOptions)
				var inserts []*ast.Node
				for subNode := subTree.Root.FirstChild; nil != subNode; subNode = subNode.Next {
					if ast.NodeKramdownBlockIAL != subNode.Type {
						inserts = append(inserts, subNode)
					}
				}
				if 2 < len(n.KramdownIAL) && 0 < len(inserts) {
					if bookmark := n.IALAttr("bookmark"); "" != bookmark {
						inserts[0].SetIALAttr("bookmark", bookmark)
					}
					if name := n.IALAttr("name"); "" != name {
						inserts[0].SetIALAttr("name", name)
					}
					if alias := n.IALAttr("alias"); "" != alias {
						inserts[0].SetIALAttr("alias", alias)
					}
					if memo := n.IALAttr("memo"); "" != memo {
						inserts[0].SetIALAttr("memo", memo)
					}
				}
				for _, insert := range inserts {
					n.InsertBefore(insert)

					if gulu.Str.Contains(sqlBlock.ID, *resolved) {
						return ast.WalkContinue
					}

					resolveEmbedR(insert, blockEmbedMode, luteEngine, resolved, depth)
					*depth--
				}
			}
			unlinks = append(unlinks, n)
			return ast.WalkSkipChildren
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
	if t, err = LoadTreeByBlockID(b.ID); err != nil {
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
