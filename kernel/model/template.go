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
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"text/template"
	"time"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/88250/protyle"
	"github.com/araddon/dateparse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/88250/gulu"
	sprig "github.com/Masterminds/sprig/v3"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func RenderCreateDocNameTemplate(nameTemplate string) (ret string, err error) {
	tpl, err := template.New("").Funcs(sprig.TxtFuncMap()).Parse(nameTemplate)
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

func SearchTemplate(keyword string) (ret []*Block) {
	templates := filepath.Join(util.DataDir, "templates")
	k := strings.ToLower(keyword)
	filepath.Walk(templates, func(path string, info fs.FileInfo, err error) error {
		name := strings.ToLower(info.Name())
		if !strings.HasSuffix(name, ".md") {
			return nil
		}

		if strings.HasPrefix(name, ".") || "readme.md" == name {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if strings.Contains(name, k) {
			content := strings.TrimPrefix(path, templates)
			content = strings.ReplaceAll(content, "templates"+string(os.PathSeparator), "")
			content = strings.TrimSuffix(content, ".md")
			content = filepath.ToSlash(content)
			content = content[1:]
			_, content = search.MarkText(content, keyword, 32, Conf.Search.CaseSensitive)
			b := &Block{Path: path, Content: content}
			ret = append(ret, b)
		}
		return nil
	})
	return
}

func DocSaveAsTemplate(id string, overwrite bool) (code int, err error) {
	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return
	}

	addBlockIALNodes(tree, true)

	luteEngine := NewLute()
	formatRenderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions)
	md := formatRenderer.Render()
	title := tree.Root.IALAttr("title")
	title = util.FilterFileName(title)
	title += ".md"
	savePath := filepath.Join(util.DataDir, "templates", title)
	if gulu.File.IsExist(savePath) {
		if !overwrite {
			code = 1
			return
		}
	}

	err = os.WriteFile(savePath, md, 0644)
	return
}

func RenderTemplate(p, id string) (string, error) {
	return renderTemplate(p, id)
}

func renderTemplate(p, id string) (string, error) {
	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return "", err
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return "", ErrBlockNotFound
	}
	block := sql.BuildBlockFromNode(node, tree)
	md, err := os.ReadFile(p)
	if nil != err {
		return "", err
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

	funcMap := sprig.TxtFuncMap()
	funcMap["queryBlocks"] = func(stmt string, args ...string) (ret []*sql.Block) {
		for _, arg := range args {
			stmt = strings.Replace(stmt, "?", arg, 1)
		}
		ret = sql.SelectBlocksRawStmt(stmt, Conf.Search.Limit)
		return
	}
	funcMap["querySpans"] = func(stmt string, args ...string) (ret []*sql.Span) {
		for _, arg := range args {
			stmt = strings.Replace(stmt, "?", arg, 1)
		}
		ret = sql.SelectSpansRawStmt(stmt, Conf.Search.Limit)
		return
	}
	funcMap["parseTime"] = func(dateStr string) time.Time {
		now := time.Now()
		ret, err := dateparse.ParseIn(dateStr, now.Location())
		if nil != err {
			util.LogWarnf("parse date [%s] failed [%s], return current time instead", dateStr, err)
			return now
		}
		return ret
	}

	goTpl := template.New("").Delims(".action{", "}")
	tpl, err := goTpl.Funcs(funcMap).Parse(gulu.Str.FromBytes(md))
	if nil != err {
		return "", errors.New(fmt.Sprintf(Conf.Language(44), err.Error()))
	}

	buf := &bytes.Buffer{}
	buf.Grow(4096)
	if err = tpl.Execute(buf, dataModel); nil != err {
		return "", errors.New(fmt.Sprintf(Conf.Language(44), err.Error()))
	}
	md = buf.Bytes()
	tree = parseKTree(md)
	if nil == tree {
		msg := fmt.Sprintf("parse tree [%s] failed", p)
		util.LogErrorf(msg)
		return "", errors.New(msg)
	}

	var nodesNeedAppendChild []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if "" != n.ID {
			// 重新生成 ID
			n.ID = ast.NewNodeID()
			n.SetIALAttr("id", n.ID)
		}

		if (ast.NodeListItem == n.Type && (nil == n.FirstChild ||
			(3 == n.ListData.Typ && (nil == n.FirstChild.Next || ast.NodeKramdownBlockIAL == n.FirstChild.Next.Type)))) ||
			(ast.NodeBlockquote == n.Type && nil != n.FirstChild && nil != n.FirstChild.Next && ast.NodeKramdownBlockIAL == n.FirstChild.Next.Type) {
			nodesNeedAppendChild = append(nodesNeedAppendChild, n)
		}

		appendRefTextRenderResultForBlockRef(n)
		return ast.WalkContinue
	})
	for _, n := range nodesNeedAppendChild {
		n.AppendChild(protyle.NewParagraph())
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
	dom := luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions)
	return dom, nil
}

func appendRefTextRenderResultForBlockRef(blockRef *ast.Node) {
	if ast.NodeBlockRef != blockRef.Type {
		return
	}

	refText := blockRef.ChildByType(ast.NodeBlockRefText)
	if nil != refText {
		return
	}
	refText = blockRef.ChildByType(ast.NodeBlockRefDynamicText)
	if nil != refText {
		return
	}

	// 动态解析渲染 ((id)) 的锚文本
	// 现行版本已经不存在该语法情况，这里保留是为了迁移历史数据
	refID := blockRef.ChildByType(ast.NodeBlockRefID)
	text := sql.GetRefText(refID.TokensStr())
	if Conf.Editor.BlockRefDynamicAnchorTextMaxLen < utf8.RuneCountInString(text) {
		text = gulu.Str.SubStr(text, Conf.Editor.BlockRefDynamicAnchorTextMaxLen) + "..."
	}
	blockRef.AppendChild(&ast.Node{Type: ast.NodeBlockRefDynamicText, Tokens: gulu.Str.ToBytes(text)})
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
