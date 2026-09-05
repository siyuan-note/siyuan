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
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
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

type TemplateDatabaseMode string

const (
	TemplateDatabaseModeCopy      TemplateDatabaseMode = "copy"
	TemplateDatabaseModeReference TemplateDatabaseMode = "reference"

	templateDatabaseModeAttr = "custom-sy-av-template-mode"
)

func RenderGoTemplate(templateContent string) (ret string, err error) {
	return RenderGoTemplateAtInBox(templateContent, time.Now(), "")
}

// RenderGoTemplateAt 使用固定时间渲染 Go 模板，保证同一次业务操作中的多个模板结果一致。
func RenderGoTemplateAt(templateContent string, now time.Time) (ret string, err error) {
	return RenderGoTemplateAtInBox(templateContent, now, "")
}

func RenderGoTemplateInBox(templateContent, boxID string) (ret string, err error) {
	return RenderGoTemplateAtInBox(templateContent, time.Now(), boxID)
}

func RenderGoTemplateAtInBox(templateContent string, now time.Time, boxID string) (ret string, err error) {
	tmpl := template.New("")
	tplFuncMap := filesys.BuiltInTemplateFuncs()
	tplFuncMap["now"] = func() time.Time { return now }
	sql.SQLTemplateFuncs(&tplFuncMap, boxID)
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

// RemoveTemplate 删除模板文件，路径必须限定在 <data>/templates/ 目录内，防止任意文件被删除
func RemoveTemplate(p string) (err error) {
	abs := p
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(util.DataDir, "templates", p)
	}
	abs = filepath.Clean(abs)
	templatesRoot := filepath.Clean(filepath.Join(util.DataDir, "templates"))
	if !gulu.File.IsSubPath(templatesRoot, abs) {
		return errors.New("template path is outside templates directory")
	}
	err = filelock.Remove(abs)
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
			manifestPath := filepath.Join(templateDir, "template.json")
			if filelock.IsExist(manifestPath) {
				pkg, parseErr := bazaar.ParsePackageJSON(manifestPath)
				if parseErr != nil || !bazaar.IsValidInstalledPackage(pkg, group.Name()) {
					continue
				}
			}
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
	return DocSaveAsTemplateWithDatabaseMode(id, name, overwrite, TemplateDatabaseModeCopy)
}

func DocSaveAsTemplateWithDatabaseMode(id, name string, overwrite bool, databaseMode TemplateDatabaseMode) (code int, err error) {
	if databaseMode == "" {
		databaseMode = TemplateDatabaseModeCopy
	}
	if TemplateDatabaseModeCopy != databaseMode && TemplateDatabaseModeReference != databaseMode {
		return 0, fmt.Errorf("unsupported template database mode [%s]", databaseMode)
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}

	tree := prepareExportTree(bt)
	markTemplateAttributeViewModes(tree.Root, databaseMode)
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

func markTemplateAttributeViewModes(root *ast.Node, databaseMode TemplateDatabaseMode) {
	if nil == root {
		return
	}
	ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeAttributeView != n.Type {
			return ast.WalkContinue
		}
		if TemplateDatabaseModeReference == databaseMode {
			n.SetIALAttr(templateDatabaseModeAttr, string(databaseMode))
		} else {
			n.RemoveIALAttr(templateDatabaseModeAttr)
		}
		return ast.WalkContinue
	})
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
	tplFuncMap := dynamicIconTemplateFuncs()
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

func dynamicIconTemplateFuncs() template.FuncMap {
	return filesys.BuiltInTemplateFuncs()
}

func RenderTemplate(p, id string, preview bool) (tree *parse.Tree, dom string, err error) {
	mode := TemplateRenderModeContent
	if preview {
		mode = TemplateRenderModePreview
	}
	tree, dom, _, err = RenderTemplateWithMode(p, id, mode)
	return
}

type templateAttributeViewPlan struct {
	mode          TemplateDatabaseMode
	source        *av.AttributeView
	target        *av.AttributeView
	selectedView  *av.View
	copiedViewIDs map[string]string
}

type templateAttributeViewCopy struct {
	target        *av.AttributeView
	copiedViewIDs map[string]string
}

func templateAttributeViewBoxID(tree *parse.Tree) string {
	if nil != tree && IsEncryptedBox(tree.Box) {
		return tree.Box
	}
	return ""
}

func templateAttributeViewMode(node *ast.Node) (ret TemplateDatabaseMode, err error) {
	value := strings.TrimSpace(node.IALAttr(templateDatabaseModeAttr))
	if "" == value {
		return TemplateDatabaseModeCopy, nil
	}
	ret = TemplateDatabaseMode(value)
	if TemplateDatabaseModeCopy != ret && TemplateDatabaseModeReference != ret {
		return "", fmt.Errorf("unsupported template database mode [%s]", value)
	}
	return
}

func validateTemplateAttributeViewNode(node *ast.Node, attrView *av.AttributeView) (selectedView *av.View, err error) {
	viewID := strings.TrimSpace(node.IALAttr(av.NodeAttrView))
	if "" != viewID {
		selectedView = attrView.GetView(viewID)
		if nil == selectedView {
			return nil, fmt.Errorf("attribute view [%s] view [%s] not found", attrView.ID, viewID)
		}
	} else if selectedView, err = attrView.GetFirstView(); nil != err {
		return nil, fmt.Errorf("attribute view [%s] has no available view: %w", attrView.ID, err)
	}

	visibleViewIDs := strings.TrimSpace(node.IALAttr(av.NodeAttrVisibleViewIDs))
	if "" == visibleViewIDs {
		return
	}
	visibleViewCount := 0
	for _, visibleViewID := range strings.Split(visibleViewIDs, ",") {
		visibleViewID = strings.TrimSpace(visibleViewID)
		if "" == visibleViewID {
			continue
		}
		visibleViewCount++
		if nil == attrView.GetView(visibleViewID) {
			return nil, fmt.Errorf("attribute view [%s] visible view [%s] not found", attrView.ID, visibleViewID)
		}
	}
	if 1 > visibleViewCount {
		return nil, fmt.Errorf("attribute view [%s] has no available visible view", attrView.ID)
	}
	return
}

func resolveCopyTemplateAttributeView(node *ast.Node, attrView *av.AttributeView) *av.View {
	if viewID := strings.TrimSpace(node.IALAttr(av.NodeAttrView)); "" != viewID {
		if view := attrView.GetView(viewID); nil != view {
			return view
		}
	}
	view, _ := attrView.GetFirstView()
	return view
}

func copyTemplateAttributeView(source *av.AttributeView) (ret *templateAttributeViewCopy, err error) {
	target := source.Clone()
	if nil == target {
		return nil, fmt.Errorf("clone attribute view [%s] failed", source.ID)
	}
	if len(source.Views) != len(target.Views) {
		return nil, fmt.Errorf("clone attribute view [%s] views failed", source.ID)
	}
	copiedViewIDs := map[string]string{}
	for i, sourceView := range source.Views {
		if nil == sourceView || nil == target.Views[i] {
			return nil, fmt.Errorf("clone attribute view [%s] view failed", source.ID)
		}
		copiedViewIDs[sourceView.ID] = target.Views[i].ID
	}
	return &templateAttributeViewCopy{target: target, copiedViewIDs: copiedViewIDs}, nil
}

func prepareTemplateAttributeViews(tree *parse.Tree, preview bool) (plans map[*ast.Node]*templateAttributeViewPlan,
	copies []*templateAttributeViewCopy, err error) {
	plans = map[*ast.Node]*templateAttributeViewPlan{}
	referenceSources := map[string]*av.AttributeView{}
	copySources := map[string]*av.AttributeView{}
	copyBySourceID := map[string]*templateAttributeViewCopy{}
	boxID := templateAttributeViewBoxID(tree)
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeAttributeView != n.Type {
			return ast.WalkContinue
		}

		mode, modeErr := templateAttributeViewMode(n)
		if nil != modeErr {
			err = modeErr
			return ast.WalkStop
		}
		if TemplateDatabaseModeReference == mode {
			source := referenceSources[n.AttributeViewID]
			if nil == source {
				source, modeErr = av.ParseAttributeViewInBox(n.AttributeViewID, boxID)
				if nil != modeErr {
					err = fmt.Errorf("parse attribute view [%s] in box [%s] failed: %w", n.AttributeViewID, boxID, modeErr)
					return ast.WalkStop
				}
				if nil == source || source.ID != n.AttributeViewID {
					err = fmt.Errorf("attribute view [%s] not found in box [%s]", n.AttributeViewID, boxID)
					return ast.WalkStop
				}
				referenceSources[n.AttributeViewID] = source
			}
			selectedView, validateErr := validateTemplateAttributeViewNode(n, source)
			if nil != validateErr {
				err = validateErr
				return ast.WalkStop
			}
			plans[n] = &templateAttributeViewPlan{
				mode: mode, source: source, target: source, selectedView: selectedView,
			}
			return ast.WalkContinue
		}

		source := copySources[n.AttributeViewID]
		if nil == source {
			source, modeErr = av.ParseAttributeView(n.AttributeViewID)
			if nil != modeErr || nil == source {
				if nil == modeErr {
					modeErr = av.ErrViewNotFound
				}
				logging.LogErrorf("parse attribute view [%s] failed: %s", n.AttributeViewID, modeErr)
				plans[n] = &templateAttributeViewPlan{mode: mode}
				return ast.WalkContinue
			}
			copySources[n.AttributeViewID] = source
		}
		selectedView := resolveCopyTemplateAttributeView(n, source)
		plan := &templateAttributeViewPlan{mode: mode, source: source, target: source, selectedView: selectedView}
		if !preview {
			copied := copyBySourceID[source.ID]
			if nil == copied {
				copied, err = copyTemplateAttributeView(source)
				if nil != err {
					logging.LogErrorf("%s", err)
					err = nil
					plans[n] = &templateAttributeViewPlan{mode: mode}
					return ast.WalkContinue
				}
				copyBySourceID[source.ID] = copied
				copies = append(copies, copied)
			}
			plan.target = copied.target
			plan.copiedViewIDs = copied.copiedViewIDs
		}
		plans[n] = plan
		return ast.WalkContinue
	})
	return
}

func saveTemplateAttributeViewCopies(copies []*templateAttributeViewCopy, boxID string) {
	for _, copied := range copies {
		if "" != boxID {
			av.SetAVBoxID(copied.target.ID, boxID)
		}
		err := av.SaveAttributeView(copied.target)
		if "" != boxID {
			av.SetAVBoxID(copied.target.ID, "")
		}
		if nil != err {
			logging.LogErrorf("save attribute view [%s] failed: %s", copied.target.ID, err)
		}
	}
}

func applyTemplateAttributeViewPlan(node *ast.Node, plan *templateAttributeViewPlan) (*av.View, error) {
	node.RemoveIALAttr(templateDatabaseModeAttr)
	if TemplateDatabaseModeCopy == plan.mode {
		// 完整复制会断开关联字段，实例上下文筛选不再有有效的目标数据库。
		node.RemoveIALAttr(av.NodeAttrContextFilter)
	}
	if nil == plan.source || nil == plan.target || nil == plan.selectedView {
		return nil, nil
	}
	node.AttributeViewID = plan.target.ID
	viewID := plan.selectedView.ID
	if TemplateDatabaseModeCopy == plan.mode && nil != plan.copiedViewIDs {
		viewID = plan.copiedViewIDs[viewID]
		if "" == viewID {
			return nil, fmt.Errorf("copied attribute view [%s] view mapping not found", plan.source.ID)
		}
		if sourceViewID := strings.TrimSpace(node.IALAttr(av.NodeAttrView)); "" != sourceViewID {
			if copiedViewID := plan.copiedViewIDs[sourceViewID]; "" != copiedViewID {
				node.SetIALAttr(av.NodeAttrView, copiedViewID)
			} else {
				node.RemoveIALAttr(av.NodeAttrView)
			}
		}
		if visibleViewIDs := strings.TrimSpace(node.IALAttr(av.NodeAttrVisibleViewIDs)); "" != visibleViewIDs {
			var copiedVisibleViewIDs []string
			for _, sourceViewID := range strings.Split(visibleViewIDs, ",") {
				sourceViewID = strings.TrimSpace(sourceViewID)
				if copiedViewID := plan.copiedViewIDs[sourceViewID]; "" != copiedViewID {
					copiedVisibleViewIDs = append(copiedVisibleViewIDs, copiedViewID)
				}
			}
			if 0 < len(copiedVisibleViewIDs) {
				node.SetIALAttr(av.NodeAttrVisibleViewIDs, strings.Join(copiedVisibleViewIDs, ","))
			} else {
				node.RemoveIALAttr(av.NodeAttrVisibleViewIDs)
			}
		}
	}
	view := plan.target.GetView(viewID)
	if nil == view {
		return nil, fmt.Errorf("attribute view [%s] view [%s] not found", plan.target.ID, viewID)
	}
	node.AttributeViewType = string(view.LayoutType)
	return view, nil
}

func templateAttributeViewPreviewTable(node *ast.Node, plan *templateAttributeViewPlan) *ast.Node {
	view := *plan.selectedView
	if nil != plan.selectedView.Table {
		table := *plan.selectedView.Table
		table.Columns = append([]*av.ViewTableColumn(nil), plan.selectedView.Table.Columns...)
		view.Table = &table
	}
	var table *av.Table
	if TemplateDatabaseModeReference == plan.mode {
		// 引用数据库模板的预览只显示结构和表头，避免在预览中暴露被引用数据库的数据。
		switch view.LayoutType {
		case av.LayoutTypeGallery:
			view.Table = av.NewLayoutTable()
			for _, field := range view.Gallery.CardFields {
				view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: field.ID}})
			}
		case av.LayoutTypeKanban:
			view.Table = av.NewLayoutTable()
			for _, field := range view.Kanban.Fields {
				view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: field.ID}})
			}
		}
		depth := 1
		table = sql.RenderAttributeViewTable(plan.source, &view, "", &depth, map[string]*av.AttributeView{}, true)
		table.Rows = nil
		table.RowCount = 0
	} else {
		table = getAttrViewTable(plan.source, &view, "")
	}

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
	node.InsertBefore(mdTable)
	return mdTable
}

func RenderTemplateWithMode(p, id string, mode TemplateRenderMode) (tree *parse.Tree, dom string,
	summary *TemplateDocTreePlanSummary, err error) {
	if TemplateRenderModeContent != mode && TemplateRenderModePreview != mode && TemplateRenderModeEditorInsert != mode {
		err = fmt.Errorf("unsupported template render mode [%s]", mode)
		return
	}
	preview := TemplateRenderModePreview == mode
	tree, err = LoadTreeByBlockID(id)
	if err != nil {
		return
	}
	sourceTree := tree

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
		dataModel["rootID"] = sourceTree.Root.ID
		dataModel["hPath"] = sourceTree.HPath
		if parentDir := path.Dir(sourceTree.Path); "/" != parentDir && "." != parentDir {
			dataModel["parentID"] = path.Base(parentDir)
		} else {
			dataModel["parentID"] = ""
		}
	}
	collector := &templateDocTreeCollector{
		rootID:        sourceTree.Root.ID,
		boxID:         sourceTree.Box,
		rootPath:      sourceTree.Path,
		rootHPath:     sourceTree.HPath,
		templatePath:  p,
		enabled:       TemplateRenderModePreview == mode || TemplateRenderModeEditorInsert == mode,
		allowCreation: TemplateRenderModePreview == mode || TemplateRenderModeEditorInsert == mode,
	}

	goTpl := template.New("").Delims(".action{", "}")
	tplFuncMap := filesys.BuiltInTemplateFuncs()
	tplFuncMap["createDocTree"] = collector.create
	tplFuncMap["renderDocRef"] = collector.renderDocRef
	sql.SQLTemplateFuncs(&tplFuncMap, sourceTree.Box)
	goTpl = goTpl.Funcs(tplFuncMap)
	tpl, err := goTpl.Funcs(tplFuncMap).Parse(gulu.Str.FromBytes(md))
	if err != nil {
		err = fmt.Errorf(Conf.Language(44), err.Error())
		return
	}
	if collector.enabled && templateUsesFunction(tpl, "createDocTree") {
		if err = validateTemplateCallGraph(tpl, tpl.Name()); nil != err {
			return
		}
	}

	buf := &bytes.Buffer{}
	buf.Grow(4096)
	if err = tpl.Execute(buf, dataModel); err != nil {
		err = fmt.Errorf(Conf.Language(44), err.Error())
		return
	}
	if 0 < len(collector.nodes) && maxTemplateDocTreeOutputSize < buf.Len() {
		err = fmt.Errorf("template output exceeds %d bytes", maxTemplateDocTreeOutputSize)
		return
	}
	collector.totalOutput = buf.Len()
	md = buf.Bytes()
	tree = parseKTree(md)
	if nil == tree {
		msg := fmt.Sprintf("parse tree [%s] failed", p)
		logging.LogError(msg)
		err = errors.New(msg)
		return
	}
	tree.Box = sourceTree.Box
	if 0 < len(collector.nodes) {
		if err = collector.validateLocations(); nil != err {
			return
		}
		if templateTreeContainsAttributeView(tree) {
			err = errors.New("database blocks are not supported by createDocTree templates")
			return
		}
		if err = renderTemplateDocTreeNodes(collector, tpl, tplFuncMap); nil != err {
			return
		}
	}
	attributeViewPlans, attributeViewCopies, prepareErr := prepareTemplateAttributeViews(tree, preview)
	if nil != prepareErr {
		err = prepareErr
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
			// 根文档映射到目标文档，其他内容块生成新 ID，并记录映射用于改写模板内部引用
			oldID := n.ID
			if ast.NodeDocument == n.Type {
				n.ID = sourceTree.Root.ID
			} else {
				n.ID = ast.NewNodeID()
			}
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
			plan := attributeViewPlans[n]
			if nil == plan {
				err = fmt.Errorf("attribute view [%s] template plan not found", n.AttributeViewID)
				return ast.WalkStop
			}
			appliedView, applyErr := applyTemplateAttributeViewPlan(n, plan)
			if nil != applyErr {
				err = applyErr
				return ast.WalkStop
			}
			if preview && nil != appliedView {
				templateAttributeViewPreviewTable(n, plan)
				unlinks = append(unlinks, n)
			}
		}

		return ast.WalkContinue
	})
	if nil != err {
		return
	}
	if !preview {
		saveTemplateAttributeViewCopies(attributeViewCopies, templateAttributeViewBoxID(tree))
	}

	// 用映射成套改写模板内部的自引用，并补全指向外部块的引用锚文本
	// 仅命中 blockIDs 的引用（模板内部块）才会改写 ID；未命中的（外部块）保持不变
	treenode.RemapTabsActiveIDs(tree.Root, blockIDs)
	treenode.WalkWithTabTitles(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
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
					if IsEncryptedBox(tree.Box) {
						refText = strings.TrimSpace(GetBlockRefTextInBox(defID, tree.Box))
					} else {
						refText = strings.TrimSpace(sql.GetRefText(defID))
					}
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
						if IsEncryptedBox(tree.Box) {
							refText = strings.TrimSpace(GetBlockRefTextInBox(defID, tree.Box))
						} else {
							refText = strings.TrimSpace(sql.GetRefText(defID))
						}
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
	if 0 < len(collector.nodes) && nil == tree.Root.FirstChild {
		tree.Root.AppendChild(treenode.NewParagraph(""))
	}

	// 折叠标题下方块需要在模板插入后从当前 DOM 中移除，展开标题时再由内核加载，避免内容重复。
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.IsBlock() {
			treenode.ClearLegacyHeadingFold(n)
		}
		return ast.WalkContinue
	})
	for _, n := range treenode.CollectFoldHiddenNodes(tree.Root) {
		n.SetIALAttr("status", "temp")
	}

	icon := tree.Root.IALAttr("icon")
	if "" != icon {
		// 动态图标需要反转义 https://github.com/siyuan-note/siyuan/issues/13211
		icon = util.UnescapeHTML(icon)
		tree.Root.SetIALAttr("icon", icon)
	}

	luteEngine := NewLute()
	dom = luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	if 0 < len(collector.nodes) {
		if TemplateRenderModeEditorInsert == mode {
			summary = collector.storePlan()
		} else {
			summary = collector.summary("")
		}
	}
	return
}

func addBlockIALNodes(tree *parse.Tree, removeUpdated bool) {
	addBlockIALNodes0(tree, removeUpdated, false)
}

func addCanonicalBlockIALNodes(tree *parse.Tree, removeUpdated bool) {
	addBlockIALNodes0(tree, removeUpdated, true)
}

func addBlockIALNodes0(tree *parse.Tree, removeUpdated, canonical bool) {
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
		ial := block.KramdownIAL
		if canonical {
			ial = canonicalBlockKramdownIAL(ial)
		}
		block.InsertAfter(&ast.Node{Type: ast.NodeKramdownBlockIAL, Tokens: parse.IAL2Tokens(ial)})
	}
}

func applyDocContentTemplateAfterIndex(templatePath, docID string) error {
	sql.FlushQueue()
	if err := applyDocContentTemplate(templatePath, docID); nil != err {
		return err
	}
	sql.FlushQueue()
	return nil
}

func applyDocContentTemplate(templatePath, docID string) error {
	absPath, err := resolveDocContentTemplatePath(templatePath)
	if nil != err {
		return err
	}
	templateTree, templateDOM, err := RenderTemplate(absPath, docID, false)
	if nil != err {
		return err
	}
	if "" == templateDOM {
		return nil
	}
	tree, err := LoadTreeByBlockID(docID)
	if nil != err {
		return err
	}
	if nil != tree.Root.FirstChild {
		tree.Root.FirstChild.Unlink()
	}
	newTree := util.NewLute().BlockDOM2Tree(templateDOM)
	var children []*ast.Node
	for child := newTree.Root.FirstChild; nil != child; child = child.Next {
		children = append(children, child)
	}
	for _, child := range children {
		tree.Root.AppendChild(child)
	}
	templateIALs := parse.IAL2Map(templateTree.Root.KramdownIAL)
	for key, value := range templateIALs {
		if "name" == key || "alias" == key || "bookmark" == key || "memo" == key || "icon" == key ||
			strings.HasPrefix(key, "custom-") {
			tree.Root.SetIALAttr(key, value)
		}
	}
	tree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
	if err = indexWriteTreeUpsertQueue(tree); nil != err {
		return err
	}
	av.BatchUpsertBlockRel(tree.Root.ChildrenByType(ast.NodeAttributeView))
	return nil
}

func resolveDocContentTemplatePath(templatePath string) (string, error) {
	templatePath = strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(templatePath)), "/")
	cleanPath := filepath.Clean(filepath.FromSlash(templatePath))
	if "" == cleanPath || "." == cleanPath || filepath.IsAbs(cleanPath) || ".." == cleanPath ||
		strings.HasPrefix(cleanPath, ".."+string(os.PathSeparator)) {
		return "", errors.New("invalid content template path")
	}
	templateRoot := filepath.Join(util.DataDir, "templates")
	absPath := filepath.Join(templateRoot, cleanPath)
	if !gulu.File.IsSubPath(templateRoot, absPath) {
		return "", errors.New("content template path is outside templates directory")
	}
	if !filelock.IsExist(absPath) {
		return "", fmt.Errorf("content template [%s] not found", templatePath)
	}
	realRoot, err := filepath.EvalSymlinks(templateRoot)
	if nil != err {
		return "", err
	}
	realPath, err := filepath.EvalSymlinks(absPath)
	if nil != err {
		return "", err
	}
	info, err := os.Stat(realPath)
	if nil != err || !info.Mode().IsRegular() {
		return "", fmt.Errorf("content template [%s] is not a regular file", templatePath)
	}
	if !gulu.File.IsSubPath(realRoot, realPath) {
		return "", errors.New("content template path is outside templates directory")
	}
	return realPath, nil
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
