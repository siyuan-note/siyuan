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
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/xrash/smetrics"
)

// TemplateSearchResult 描述了模板搜索结果。
type TemplateSearchResult struct {
	Path         string `json:"path"`
	RelativePath string `json:"relativePath"`
	Content      string `json:"content"`
}

func RenderGoTemplate(templateContent string) (ret string, err error) {
	return RenderGoTemplateAt(templateContent, time.Now())
}

// RenderGoTemplateAt 使用固定时间渲染 Go 模板，保证同一次业务操作中的多个模板结果一致。
func RenderGoTemplateAt(templateContent string, now time.Time) (ret string, err error) {
	tmpl := template.New("")
	tplFuncMap := filesys.BuiltInTemplateFuncs()
	tplFuncMap["now"] = func() time.Time { return now }
	sql.SQLTemplateFuncs(&tplFuncMap)
	tmpl = tmpl.Funcs(tplFuncMap)
	tpl, err := tmpl.Parse(templateContent)
	if err != nil {
		return "", fmt.Errorf(Conf.Language(44), err.Error())
	}

	buf := &bytes.Buffer{}
	buf.Grow(4096)
	err = tpl.Execute(buf, nil)
	if err != nil {
		return "", fmt.Errorf(Conf.Language(44), err.Error())
	}
	ret = buf.String()
	return
}

func RemoveTemplate(p string) (err error) {
	err = filelock.Remove(p)
	if err != nil {
		logging.LogErrorf("remove template failed: %s", err)
	}
	return
}

// getTemplateReadmePaths 返回模板包 README 的相对包根路径集合：恒含 README.md，并合并 template.json 的 readme 字段（大小写敏感）。
func getTemplateReadmePaths(templateDir string) map[string]struct{} {
	paths := map[string]struct{}{"README.md": {}}
	pkg, err := bazaar.ParsePackageJSON(filepath.Join(templateDir, "template.json"))
	if err != nil {
		return paths
	}
	for _, v := range pkg.Readme {
		v = strings.TrimSpace(v)
		if "" != v {
			paths[v] = struct{}{}
		}
	}
	return paths
}

func SearchTemplate(keyword string) (ret []*TemplateSearchResult) {
	ret = []*TemplateSearchResult{}

	templates := filepath.Join(util.DataDir, "templates")
	if !util.IsPathRegularDirOrSymlinkDir(templates) {
		return
	}

	groups, err := os.ReadDir(templates)
	if err != nil {
		logging.LogErrorf("read templates failed: %s", err)
		return
	}

	sort.Slice(ret, func(i, j int) bool {
		return util.PinYinCompare(filepath.Base(groups[i].Name()), filepath.Base(groups[j].Name()))
	})

	keyword = strings.TrimSpace(keyword)
	type result struct {
		item  *TemplateSearchResult
		score float64
	}
	var results []*result
	keywords := strings.Fields(keyword)
	for _, group := range groups {
		if strings.HasPrefix(group.Name(), ".") {
			continue
		}

		if group.IsDir() {
			templateDir := filepath.Join(templates, group.Name())
			readmePaths := getTemplateReadmePaths(templateDir)
			filelock.Walk(templateDir, func(path string, d fs.DirEntry, err error) error {
				name := strings.ToLower(d.Name())
				if strings.HasPrefix(name, ".") {
					if d.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}

				if !strings.HasSuffix(name, ".md") {
					return nil
				}
				rel, relErr := filepath.Rel(templateDir, path)
				if relErr != nil {
					return nil
				}
				if _, skip := readmePaths[filepath.ToSlash(rel)]; skip {
					return nil
				}

				content := strings.TrimPrefix(path, templates)
				content = strings.TrimSuffix(content, ".md")
				p := filepath.Join(group.Name(), content)
				score := 0.0
				hit := true
				for _, k := range keywords {
					if strings.Contains(strings.ToLower(p), strings.ToLower(k)) {
						score += smetrics.JaroWinkler(name, k, 0.7, 4)
					} else {
						hit = false
						break
					}
				}
				if hit {
					content = strings.TrimPrefix(path, templates)
					content = strings.TrimSuffix(content, ".md")
					content = filepath.ToSlash(content)
					_, content = search.MarkText(content, strings.Join(keywords, search.TermSep), 32, Conf.Search.CaseSensitive)
					relativePath, relErr := filepath.Rel(templates, path)
					if nil != relErr {
						return nil
					}
					b := &TemplateSearchResult{Path: path, RelativePath: filepath.ToSlash(relativePath), Content: content}
					results = append(results, &result{item: b, score: score})
				}
				return nil
			})
		} else {
			name := strings.ToLower(group.Name())
			if strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".md") || "README.md" == group.Name() {
				continue
			}

			content := group.Name()
			content = strings.TrimSuffix(content, ".md")
			score := 0.0
			hit := true
			for _, k := range keywords {
				if strings.Contains(strings.ToLower(content), strings.ToLower(k)) {
					score += smetrics.JaroWinkler(name, k, 0.7, 4)
				} else {
					hit = false
					break
				}
			}
			if hit {
				content = filepath.ToSlash(content)
				_, content = search.MarkText(content, strings.Join(keywords, search.TermSep), 32, Conf.Search.CaseSensitive)
				b := &TemplateSearchResult{Path: filepath.Join(templates, group.Name()), RelativePath: group.Name(), Content: content}
				results = append(results, &result{item: b, score: score})
			}
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].score > results[j].score
	})
	for _, r := range results {
		ret = append(ret, r.item)
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

		// Content in templates is not properly escaped
		// https://github.com/siyuan-note/siyuan/issues/9649
		// https://github.com/siyuan-note/siyuan/issues/13701
		switch n.Type {
		case ast.NodeCodeBlockCode:
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("&quot;"), []byte("\""))
		case ast.NodeCodeSpanContent:
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("&quot;"), []byte("\""))
		case ast.NodeBlockQueryEmbedScript:
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("&quot;"), []byte("\""))
		case ast.NodeTextMark:
			if n.IsTextMarkType("code") {
				n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, "&quot;", "\"")
			}
		}
		return ast.WalkContinue
	})

	var unlinks []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeCodeBlockFenceInfoMarker == n.Type {
			if lang := string(n.CodeBlockInfo); "siyuan-template" == lang || "template" == lang {
				// 将模板代码转换为段落文本 https://github.com/siyuan-note/siyuan/pull/15345
				unlinks = append(unlinks, n.Parent)
				p := treenode.NewParagraph(n.Parent.ID)
				// 代码块内可能会有多个空行，但是这里不需要分块处理，后面渲染一个文本节点即可
				p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: n.Next.Tokens})
				n.Parent.InsertBefore(p)
			}
		}
		return ast.WalkContinue
	})
	for _, n := range unlinks {
		n.Unlink()
	}

	luteEngine := NewLute()
	formatRenderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
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

func RenderDynamicIconContentTemplate(content, id string) (ret string) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}
	block := sql.BuildBlockFromNode(node, tree)
	if nil == block {
		return
	}

	dataModel := map[string]string{}
	title := block.Name
	if "d" == block.Type {
		title = block.Content
	}
	dataModel["title"] = title
	dataModel["id"] = block.ID
	dataModel["name"] = block.Name
	dataModel["alias"] = block.Alias

	goTpl := template.New("").Delims(".action{", "}")
	tplFuncMap := filesys.BuiltInTemplateFuncs()
	sql.SQLTemplateFuncs(&tplFuncMap)
	goTpl = goTpl.Funcs(tplFuncMap)
	tpl, err := goTpl.Funcs(tplFuncMap).Parse(content)
	if err != nil {
		err = fmt.Errorf(Conf.Language(44), err.Error())
		return
	}

	buf := &bytes.Buffer{}
	buf.Grow(4096)
	if err = tpl.Execute(buf, dataModel); err != nil {
		err = fmt.Errorf(Conf.Language(44), err.Error())
		return
	}
	ret = buf.String()
	return
}

func RenderTemplate(p, id string, preview bool) (tree *parse.Tree, dom string, err error) {
	tree, err = LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		err = ErrBlockNotFound
		return
	}
	block := sql.BuildBlockFromNode(node, tree)
	md, err := os.ReadFile(p)
	if err != nil {
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
	tplFuncMap := filesys.BuiltInTemplateFuncs()
	sql.SQLTemplateFuncs(&tplFuncMap)
	goTpl = goTpl.Funcs(tplFuncMap)
	tpl, err := goTpl.Funcs(tplFuncMap).Parse(gulu.Str.FromBytes(md))
	if err != nil {
		err = fmt.Errorf(Conf.Language(44), err.Error())
		return
	}

	buf := &bytes.Buffer{}
	buf.Grow(4096)
	if err = tpl.Execute(buf, dataModel); err != nil {
		err = fmt.Errorf(Conf.Language(44), err.Error())
		return
	}
	md = buf.Bytes()
	tree = parseKTree(md)
	if nil == tree {
		msg := fmt.Sprintf("parse tree [%s] failed", p)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}

	var nodesNeedAppendChild, unlinks []*ast.Node
	// 模板内部块旧 ID 到新 ID 的映射，用于成套改写模板内部的自引用
	blockIDs := map[string]string{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if "" != n.ID {
			// 重新生成 ID，并记录旧 ID 到新 ID 的映射，用于后续成套改写模板内部的自引用
			oldID := n.ID
			n.ID = ast.NewNodeID()
			blockIDs[oldID] = n.ID
			n.SetIALAttr("id", n.ID)
			n.RemoveIALAttr(av.NodeAttrNameAvs)

			// Blocks created via template update time earlier than creation time https://github.com/siyuan-note/siyuan/issues/8607
			treenode.RefreshUpdated(n)
		}

		if (ast.NodeListItem == n.Type && (nil == n.FirstChild ||
			(3 == n.ListData.Typ && (nil == n.FirstChild.Next || ast.NodeKramdownBlockIAL == n.FirstChild.Next.Type)))) ||
			(ast.NodeBlockquote == n.Type && nil != n.FirstChild && nil != n.FirstChild.Next && ast.NodeKramdownBlockIAL == n.FirstChild.Next.Type) ||
			(ast.NodeCallout == n.Type && nil != n.FirstChild && ast.NodeKramdownBlockIAL == n.FirstChild.Type) {
			nodesNeedAppendChild = append(nodesNeedAppendChild, n)
		}

		if n.IsTextMarkType("inline-math") {
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
				cloned := attrView.Clone()
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

					table := getAttrViewTable(attrView, view, "")

					aligns := getAttrViewTableAligns(table, false)
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

	// 用映射成套改写模板内部的自引用，并补全指向外部块的引用锚文本
	// 仅命中 blockIDs 的引用（模板内部块）才会改写 ID；未命中的（外部块）保持不变
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if n.IsTextMarkType("block-ref") {
			defID := n.TextMarkBlockRefID
			if newDefID, internal := blockIDs[defID]; internal {
				// 模板内部自引用：成套改写为新 ID
				n.TextMarkBlockRefID = newDefID
			} else {
				// 外部引用：保持 ID 不变，补全空锚文本
				if refText := n.Text(); "" == refText {
					refText = strings.TrimSpace(sql.GetRefText(defID))
					if "" != refText {
						treenode.SetDynamicBlockRefText(n, refText)
					} else {
						unlinks = append(unlinks, n)
					}
				}
			}
		} else if ast.NodeBlockRef == n.Type {
			// 兼容遗留块引用节点
			if refID := n.ChildByType(ast.NodeBlockRefID); nil != refID {
				defID := refID.TokensStr()
				if newDefID, internal := blockIDs[defID]; internal {
					// 模板内部自引用：成套改写为新 ID
					refID.Tokens = []byte(newDefID)
				} else {
					// 外部引用：保持 ID 不变，补全空锚文本
					if refText := n.Text(); "" == refText {
						refText = strings.TrimSpace(sql.GetRefText(defID))
						if "" != refText {
							treenode.SetDynamicBlockRefText(n, refText)
						} else {
							unlinks = append(unlinks, n)
						}
					}
				}
			}
		} else if treenode.IsBlockLink(n) {
			// 块超链接指向模板内部块时成套改写
			defID := strings.TrimPrefix(n.TextMarkAHref, "siyuan://blocks/")
			if newDefID, internal := blockIDs[defID]; internal {
				n.TextMarkAHref = "siyuan://blocks/" + newDefID
			}
		} else if ast.NodeBlockQueryEmbedScript == n.Type {
			// 嵌入块查询脚本中引用模板内部块时成套改写
			for oldID, newID := range blockIDs {
				n.Tokens = bytes.ReplaceAll(n.Tokens, []byte(oldID), []byte(newID))
			}
		}
		return ast.WalkContinue
	})
	for _, n := range nodesNeedAppendChild {
		if ast.NodeBlockquote == n.Type {
			n.FirstChild.InsertAfter(treenode.NewParagraph(""))
		} else {
			n.AppendChild(treenode.NewParagraph(""))
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

	icon := tree.Root.IALAttr("icon")
	if "" != icon {
		// 动态图标需要反转义 https://github.com/siyuan-note/siyuan/issues/13211
		icon = util.UnescapeHTML(icon)
		tree.Root.SetIALAttr("icon", icon)
	}

	luteEngine := NewLute()
	dom = luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
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

// CreateTemplate 在 <data>/templates/ 下创建模板文件。name 不含扩展名，content 为 markdown 文本。
// overwrite=false 且文件已存在时返回 code=1（与 DocSaveAsTemplate 一致）。
func CreateTemplate(name, content string, overwrite bool) (code int, err error) {
	name = util.FilterFileName(name) + ".md"
	name = util.TruncateLenFileName(name)
	savePath := filepath.Join(util.DataDir, "templates", name)
	if filelock.IsExist(savePath) {
		if !overwrite {
			code = 1
			return
		}
	}

	err = filelock.WriteFile(savePath, []byte(content))
	return
}
