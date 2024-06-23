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
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/template"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RenderGoTemplate(templateContent string) (ret string, err error) {
	tmpl := template.New("")
	tplFuncMap := util.BuiltInTemplateFuncs()
	sql.SQLTemplateFuncs(&tplFuncMap)
	tmpl = tmpl.Funcs(tplFuncMap)
	tpl, err := tmpl.Parse(templateContent)
	if nil != err {
		return "", errors.New(fmt.Sprintf(Conf.Language(44), err.Error()))
	}

	buf := &bytes.Buffer{}
	buf.Grow(4096)
	err = tpl.Execute(buf, nil)
	if nil != err {
		return "", errors.New(fmt.Sprintf(Conf.Language(44), err.Error()))
	}
	ret = buf.String()
	return
}

func RemoveTemplate(p string) (err error) {
	err = filelock.Remove(p)
	if nil != err {
		logging.LogErrorf("remove template failed: %s", err)
	}
	return
}

func SearchTemplate(keyword string) (ret []*Block) {
	ret = []*Block{}

	templates := filepath.Join(util.DataDir, "templates")
	if !util.IsPathRegularDirOrSymlinkDir(templates) {
		return
	}

	groups, err := os.ReadDir(templates)
	if nil != err {
		logging.LogErrorf("read templates failed: %s", err)
		return
	}

	sort.Slice(ret, func(i, j int) bool {
		return util.PinYinCompare(filepath.Base(groups[i].Name()), filepath.Base(groups[j].Name()))
	})

	k := strings.ToLower(keyword)
	for _, group := range groups {
		if strings.HasPrefix(group.Name(), ".") {
			continue
		}

		if group.IsDir() {
			var templateBlocks []*Block
			templateDir := filepath.Join(templates, group.Name())
			filelock.Walk(templateDir, func(path string, info fs.FileInfo, err error) error {
				name := strings.ToLower(info.Name())
				if strings.HasPrefix(name, ".") {
					if info.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}

				if !strings.HasSuffix(name, ".md") || strings.HasPrefix(name, "readme") || !strings.Contains(name, k) {
					return nil
				}

				content := strings.TrimPrefix(path, templates)
				content = strings.TrimSuffix(content, ".md")
				content = filepath.ToSlash(content)
				content = strings.TrimPrefix(content, "/")
				_, content = search.MarkText(content, keyword, 32, Conf.Search.CaseSensitive)
				b := &Block{Path: path, Content: content}
				templateBlocks = append(templateBlocks, b)
				return nil
			})
			sort.Slice(templateBlocks, func(i, j int) bool {
				return util.PinYinCompare(filepath.Base(templateBlocks[i].Path), filepath.Base(templateBlocks[j].Path))
			})
			ret = append(ret, templateBlocks...)
		} else {
			name := strings.ToLower(group.Name())
			if strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".md") || "readme.md" == name || !strings.Contains(name, k) {
				continue
			}

			content := group.Name()
			content = strings.TrimSuffix(content, ".md")
			content = filepath.ToSlash(content)
			_, content = search.MarkText(content, keyword, 32, Conf.Search.CaseSensitive)
			b := &Block{Path: filepath.Join(templates, group.Name()), Content: content}
			ret = append(ret, b)
		}
	}
	return
}

func DocSaveAsTemplate(id, name string, overwrite bool) (code int, err error) {
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}

	tree := prepareExportTree(bt)
	addBlockIALNodes(tree, true)

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		// Code content in templates is not properly escaped https://github.com/siyuan-note/siyuan/issues/9649
		switch n.Type {
		case ast.NodeCodeBlockCode:
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("&quot;"), []byte("\""))
		case ast.NodeCodeSpanContent:
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("&quot;"), []byte("\""))
		case ast.NodeTextMark:
			if n.IsTextMarkType("code") {
				n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, "&quot;", "\"")
			}
		}
		return ast.WalkContinue
	})

	luteEngine := NewLute()
	formatRenderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions)
	md := formatRenderer.Render()

	// 单独渲染根节点的 IAL
	if 0 < len(tree.Root.KramdownIAL) {
		// 把 docIAL 中的 id 调整到第一个
		tree.Root.RemoveIALAttr("id")
		tree.Root.KramdownIAL = append([][]string{{"id", tree.Root.ID}}, tree.Root.KramdownIAL...)
		md = append(md, []byte("\n")...)
		md = append(md, parse.IAL2Tokens(tree.Root.KramdownIAL)...)
	}

	name = util.FilterFileName(name) + ".md"
	name = util.TruncateLenFileName(name)
	savePath := filepath.Join(util.DataDir, "templates", name)
	if filelock.IsExist(savePath) {
		if !overwrite {
			code = 1
			return
		}
	}

	err = filelock.WriteFile(savePath, md)
	return
}

func RenderTemplate(p, id string, preview bool) (tree *parse.Tree, dom string, err error) {
	tree, err = LoadTreeByBlockID(id)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		err = ErrBlockNotFound
		return
	}
	block := sql.BuildBlockFromNode(node, tree)
	md, err := os.ReadFile(p)
	if nil != err {
		return
	}

	dataModel := map[string]string{}
	var titleVar string
	if nil != block {
		titleVar = block.Name
		if "d" == block.Type {
			titleVar = block.Content
		}
		dataModel["title"] = titleVar
		dataModel["id"] = block.ID
		dataModel["name"] = block.Name
		dataModel["alias"] = block.Alias
	}

	goTpl := template.New("").Delims(".action{", "}")
	tplFuncMap := util.BuiltInTemplateFuncs()
	sql.SQLTemplateFuncs(&tplFuncMap)
	goTpl = goTpl.Funcs(tplFuncMap)
	tpl, err := goTpl.Funcs(tplFuncMap).Parse(gulu.Str.FromBytes(md))
	if nil != err {
		err = errors.New(fmt.Sprintf(Conf.Language(44), err.Error()))
		return
	}

	buf := &bytes.Buffer{}
	buf.Grow(4096)
	if err = tpl.Execute(buf, dataModel); nil != err {
		err = errors.New(fmt.Sprintf(Conf.Language(44), err.Error()))
		return
	}
	md = buf.Bytes()
	tree = parseKTree(md)
	if nil == tree {
		msg := fmt.Sprintf("parse tree [%s] failed", p)
		logging.LogErrorf(msg)
		err = errors.New(msg)
		return
	}

	var nodesNeedAppendChild, unlinks []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if "" != n.ID {
			// 重新生成 ID
			n.ID = ast.NewNodeID()
			n.SetIALAttr("id", n.ID)
			n.RemoveIALAttr(av.NodeAttrNameAvs)

			// Blocks created via template update time earlier than creation time https://github.com/siyuan-note/siyuan/issues/8607
			refreshUpdated(n)
		}

		if (ast.NodeListItem == n.Type && (nil == n.FirstChild ||
			(3 == n.ListData.Typ && (nil == n.FirstChild.Next || ast.NodeKramdownBlockIAL == n.FirstChild.Next.Type)))) ||
			(ast.NodeBlockquote == n.Type && nil != n.FirstChild && nil != n.FirstChild.Next && ast.NodeKramdownBlockIAL == n.FirstChild.Next.Type) {
			nodesNeedAppendChild = append(nodesNeedAppendChild, n)
		}

		// 块引缺失锚文本情况下自动补全 https://github.com/siyuan-note/siyuan/issues/6087
		if n.IsTextMarkType("block-ref") {
			if refText := n.Text(); "" == refText {
				refText = sql.GetRefText(n.TextMarkBlockRefID)
				if "" != refText {
					treenode.SetDynamicBlockRefText(n, refText)
				} else {
					unlinks = append(unlinks, n)
				}
			}
		} else if n.IsTextMarkType("inline-math") {
			if n.ParentIs(ast.NodeTableCell) {
				// 表格中的公式中带有管道符时使用 HTML 实体替换管道符 Improve the handling of inline-math containing `|` in the table https://github.com/siyuan-note/siyuan/issues/9227
				n.TextMarkInlineMathContent = strings.ReplaceAll(n.TextMarkInlineMathContent, "|", "&#124;")
			}
		}

		if ast.NodeAttributeView == n.Type {
			// 重新生成数据库视图
			attrView, parseErr := av.ParseAttributeView(n.AttributeViewID)
			if nil != parseErr {
				logging.LogErrorf("parse attribute view [%s] failed: %s", n.AttributeViewID, parseErr)
			} else {
				cloned := attrView.ShallowClone()
				if nil == cloned {
					logging.LogErrorf("clone attribute view [%s] failed", n.AttributeViewID)
					return ast.WalkContinue
				}

				n.AttributeViewID = cloned.ID
				if !preview {
					// 非预览时持久化数据库
					if saveErr := av.SaveAttributeView(cloned); nil != saveErr {
						logging.LogErrorf("save attribute view [%s] failed: %s", cloned.ID, saveErr)
					}
				} else {
					// 预览时使用简单表格渲染
					viewID := n.IALAttr(av.NodeAttrView)
					view, getErr := attrView.GetCurrentView(viewID)
					if nil != getErr {
						logging.LogErrorf("get attribute view [%s] failed: %s", n.AttributeViewID, getErr)
						return ast.WalkContinue
					}

					table := sql.RenderAttributeViewTable(attrView, view, "", GetBlockAttrsWithoutWaitWriting)

					var aligns []int
					for range table.Columns {
						aligns = append(aligns, 0)
					}
					mdTable := &ast.Node{Type: ast.NodeTable, TableAligns: aligns}
					mdTableHead := &ast.Node{Type: ast.NodeTableHead}
					mdTable.AppendChild(mdTableHead)
					mdTableHeadRow := &ast.Node{Type: ast.NodeTableRow, TableAligns: aligns}
					mdTableHead.AppendChild(mdTableHeadRow)
					for _, col := range table.Columns {
						cell := &ast.Node{Type: ast.NodeTableCell}
						cell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(col.Name)})
						mdTableHeadRow.AppendChild(cell)
					}

					n.InsertBefore(mdTable)
					unlinks = append(unlinks, n)
				}
			}
		}

		return ast.WalkContinue
	})
	for _, n := range nodesNeedAppendChild {
		if ast.NodeBlockquote == n.Type {
			n.FirstChild.InsertAfter(treenode.NewParagraph())
		} else {
			n.AppendChild(treenode.NewParagraph())
		}
	}
	for _, n := range unlinks {
		n.Unlink()
	}

	// 折叠标题导出为模板后使用会出现内容重复 https://github.com/siyuan-note/siyuan/issues/4488
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if "1" == n.IALAttr("heading-fold") { // 为标题折叠下方块添加属性，前端渲染以后会统一做移除处理
			n.SetIALAttr("status", "temp")
		}
		return ast.WalkContinue
	})

	luteEngine := NewLute()
	dom = luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions)
	return
}

func addBlockIALNodes(tree *parse.Tree, removeUpdated bool) {
	var blocks []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() {
			return ast.WalkContinue
		}

		if ast.NodeBlockQueryEmbed == n.Type {
			if script := n.ChildByType(ast.NodeBlockQueryEmbedScript); nil != script {
				script.Tokens = bytes.ReplaceAll(script.Tokens, []byte("\n"), []byte(" "))
			}
		} else if ast.NodeHTMLBlock == n.Type {
			n.Tokens = bytes.TrimSpace(n.Tokens)
			// 使用 <div> 包裹，否则后续解析时会识别为行级 HTML https://github.com/siyuan-note/siyuan/issues/4244
			if !bytes.HasPrefix(n.Tokens, []byte("<div>")) {
				n.Tokens = append([]byte("<div>\n"), n.Tokens...)
			}
			if !bytes.HasSuffix(n.Tokens, []byte("</div>")) {
				n.Tokens = append(n.Tokens, []byte("\n</div>")...)
			}
		}

		if removeUpdated {
			n.RemoveIALAttr("updated")
		}
		if 0 < len(n.KramdownIAL) {
			blocks = append(blocks, n)
		}
		return ast.WalkContinue
	})
	for _, block := range blocks {
		block.InsertAfter(&ast.Node{Type: ast.NodeKramdownBlockIAL, Tokens: parse.IAL2Tokens(block.KramdownIAL)})
	}
}
