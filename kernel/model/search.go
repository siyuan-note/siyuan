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
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/jinzhu/copier"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/xrash/smetrics"
)

func SearchEmbedBlock(stmt string, excludeIDs []string, headingMode int) (ret []*Block) {
	WaitForWritingFiles()
	return searchEmbedBlock(stmt, excludeIDs, headingMode)
}

func searchEmbedBlock(stmt string, excludeIDs []string, headingMode int) (ret []*Block) {
	sqlBlocks := sql.SelectBlocksRawStmtNoParse(stmt, Conf.Search.Limit)
	var tmp []*sql.Block
	for _, b := range sqlBlocks {
		if !gulu.Str.Contains(b.ID, excludeIDs) {
			tmp = append(tmp, b)
		}
	}
	sqlBlocks = tmp
	for _, sb := range sqlBlocks {
		block := getBlockRendered(sb.ID, headingMode)
		if nil == block {
			continue
		}
		ret = append(ret, block)
	}

	if 1 > len(ret) {
		ret = []*Block{}
	}
	return
}

func SearchRefBlock(id, rootID, keyword string, beforeLen int) (ret []*Block, newDoc bool) {
	if "" == keyword {
		// 查询为空时默认的块引排序规则按最近使用优先 https://github.com/siyuan-note/siyuan/issues/3218
		refs := sql.QueryRefsRecent()
		for _, ref := range refs {
			sqlBlock := sql.GetBlock(ref.DefBlockID)
			block := fromSQLBlock(sqlBlock, "", beforeLen)
			if nil == block {
				continue
			}
			block.Content = maxContent(block.Content, Conf.Editor.BlockRefDynamicAnchorTextMaxLen)
			block.RefText = block.Content
			if block.IsContainerBlock() {
				block.RefText = block.FContent // `((` 引用列表项时使用第一个子块作为动态锚文本 https://github.com/siyuan-note/siyuan/issues/4536
			}
			ret = append(ret, block)
		}
		if 1 > len(ret) {
			ret = []*Block{}
		}
		return
	}

	ret = fullTextSearchRefBlock(keyword, beforeLen)
	tmp := ret[:0]
	trees := map[string]*parse.Tree{}
	for _, b := range ret {
		hitFirstChildID := false
		b.RefText = b.Content
		if b.IsContainerBlock() {
			b.RefText = b.FContent // `((` 引用列表项时使用第一个子块作为动态锚文本 https://github.com/siyuan-note/siyuan/issues/4536

			// `((` 引用候选中排除当前块的父块 https://github.com/siyuan-note/siyuan/issues/4538
			tree := trees[b.RootID]
			if nil == tree {
				tree, _ = loadTreeByBlockID(b.RootID)
				trees[b.RootID] = tree
			}
			if nil != tree {
				bNode := treenode.GetNodeInTree(tree, b.ID)
				if fc := treenode.FirstLeafBlock(bNode); nil != fc && fc.ID == id {
					hitFirstChildID = true
				}
			}
		}

		if b.ID != id && !hitFirstChildID && b.ID != rootID {
			b.Content = maxContent(b.Content, Conf.Editor.BlockRefDynamicAnchorTextMaxLen)
			tmp = append(tmp, b)
		}
	}
	ret = tmp

	if "" != keyword {
		if block := treenode.GetBlockTree(id); nil != block {
			p := path.Join(block.HPath, keyword)
			newDoc = nil == treenode.GetBlockTreeRootByHPath(block.BoxID, p)
		}
	}
	return
}

func FindReplace(keyword, replacement string, ids []string) (err error) {
	keyword = strings.Trim(keyword, "\"") // FTS 字符串需要去除双引号
	if keyword == replacement {
		return
	}

	ids = gulu.Str.RemoveDuplicatedElem(ids)
	var renameRoots []*ast.Node
	renameRootTitles := map[string]string{}
	for _, id := range ids {
		var tree *parse.Tree
		tree, err = loadTreeByBlockID(id)
		if nil != err {
			return
		}

		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			return
		}

		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			switch n.Type {
			case ast.NodeDocument:
				title := n.IALAttr("title")
				if strings.Contains(title, keyword) {
					renameRootTitles[n.ID] = strings.ReplaceAll(title, keyword, replacement)
					renameRoots = append(renameRoots, n)
				}
			case ast.NodeText, ast.NodeLinkText, ast.NodeLinkTitle, ast.NodeCodeSpanContent, ast.NodeCodeBlockCode, ast.NodeInlineMathContent, ast.NodeMathBlockContent:
				if bytes.Contains(n.Tokens, []byte(keyword)) {
					n.Tokens = bytes.ReplaceAll(n.Tokens, []byte(keyword), []byte(replacement))
				}
			}
			return ast.WalkContinue
		})

		if err = writeJSONQueue(tree); nil != err {
			return
		}
	}

	for _, renameRoot := range renameRoots {
		newTitle := renameRootTitles[renameRoot.ID]
		RenameDoc(renameRoot.Box, renameRoot.Path, newTitle)
	}

	WaitForWritingFiles()
	if 1 < len(ids) {
		go func() {
			time.Sleep(time.Second)
			util.ReloadUI()
		}()
	}
	return
}

func FullTextSearchBlock(query, box, path string, types map[string]bool, querySyntax bool) (ret []*Block) {
	query = strings.TrimSpace(query)
	if queryStrLower := strings.ToLower(query); strings.Contains(queryStrLower, "select ") && strings.Contains(queryStrLower, " * ") && strings.Contains(queryStrLower, " from ") {
		ret = searchBySQL(query, 36)
	} else {
		filter := searchFilter(types)
		ret = fullTextSearch(query, box, path, filter, 36, querySyntax)
	}
	return
}

func searchFilter(types map[string]bool) string {
	s := conf.NewSearch()
	if err := copier.Copy(s, Conf.Search); nil != err {
		util.LogErrorf("copy search conf failed: %s", err)
	}
	if nil != types {
		s.Document = types["document"]
		s.Heading = types["heading"]
		s.List = types["list"]
		s.ListItem = types["listItem"]
		s.CodeBlock = types["codeBlock"]
		s.MathBlock = types["mathBlock"]
		s.Table = types["table"]
		s.Blockquote = types["blockquote"]
		s.SuperBlock = types["superBlock"]
		s.Paragraph = types["paragraph"]
		s.HTMLBlock = types["htmlBlock"]
	} else {
		s.Document = Conf.Search.Document
		s.Heading = Conf.Search.Heading
		s.List = Conf.Search.List
		s.ListItem = Conf.Search.ListItem
		s.CodeBlock = Conf.Search.CodeBlock
		s.MathBlock = Conf.Search.MathBlock
		s.Table = Conf.Search.Table
		s.Blockquote = Conf.Search.Blockquote
		s.SuperBlock = Conf.Search.SuperBlock
		s.Paragraph = Conf.Search.Paragraph
		s.HTMLBlock = Conf.Search.HTMLBlock
	}
	return s.TypeFilter()
}

func searchBySQL(stmt string, beforeLen int) (ret []*Block) {
	stmt = gulu.Str.RemoveInvisible(stmt)
	blocks := sql.SelectBlocksRawStmt(stmt, Conf.Search.Limit)
	ret = fromSQLBlocks(&blocks, "", beforeLen)
	if 1 > len(ret) {
		ret = []*Block{}
	}
	return
}

func fullTextSearchRefBlock(keyword string, beforeLen int) (ret []*Block) {
	keyword = gulu.Str.RemoveInvisible(keyword)

	if util.IsIDPattern(keyword) {
		ret = searchBySQL("SELECT * FROM `blocks` WHERE `id` = '"+keyword+"'", 36)
		return
	}

	quotedKeyword := stringQuery(keyword)
	table := "blocks_fts" // 大小写敏感
	if !Conf.Search.CaseSensitive {
		table = "blocks_fts_case_insensitive"
	}

	projections := "id, parent_id, root_id, hash, box, path, " +
		"snippet(" + table + ", 6, '<mark>__r', '</mark>', '...', 64) AS hpath, " +
		"snippet(" + table + ", 7, '<mark>__r', '</mark>', '...', 64) AS name, " +
		"snippet(" + table + ", 8, '<mark>__r', '</mark>', '...', 64) AS alias, " +
		"snippet(" + table + ", 9, '<mark>__r', '</mark>', '...', 64) AS memo, " +
		"tag, " +
		"snippet(" + table + ", 11, '<mark>__r', '</mark>', '...', 64) AS content, " +
		"fcontent, markdown, length, type, subtype, ial, sort, created, updated"
	stmt := "SELECT " + projections + " FROM " + table + " WHERE " + table + " MATCH '" + columnFilter() + ":(" + quotedKeyword + ")' AND type IN " + Conf.Search.TypeFilter()
	orderBy := ` order by case
             when name = '${keyword}' then 10
             when alias = '${keyword}' then 20
             when memo = '${keyword}' then 30
             when content = '${keyword}' and type = 'd' then 40
             when content LIKE '%${keyword}%' and type = 'd' then 41
             when name LIKE '%${keyword}%' then 50
             when alias LIKE '%${keyword}%' then 60
             when content = '${keyword}' and type = 'h' then 70
             when content LIKE '%${keyword}%' and type = 'h' then 71
             when fcontent = '${keyword}' and type = 'i' then 80
             when fcontent LIKE '%${keyword}%' and type = 'i' then 81
             when memo LIKE '%${keyword}%' then 90
             when content LIKE '%${keyword}%' and type != 'i' and type != 'l' then 100
             else 65535 end ASC, sort ASC, length ASC`
	orderBy = strings.ReplaceAll(orderBy, "${keyword}", keyword)
	stmt += orderBy + " LIMIT " + strconv.Itoa(Conf.Search.Limit)
	blocks := sql.SelectBlocksRawStmt(stmt, Conf.Search.Limit)
	ret = fromSQLBlocks(&blocks, "", beforeLen)
	if 1 > len(ret) {
		ret = []*Block{}
	}
	return
}

func fullTextSearch(query, box, path, filter string, beforeLen int, querySyntax bool) (ret []*Block) {
	query = gulu.Str.RemoveInvisible(query)
	if util.IsIDPattern(query) {
		ret = searchBySQL("SELECT * FROM `blocks` WHERE `id` = '"+query+"'", beforeLen)
		return
	}

	if !querySyntax {
		query = stringQuery(query)
	}

	table := "blocks_fts" // 大小写敏感
	if !Conf.Search.CaseSensitive {
		table = "blocks_fts_case_insensitive"
	}
	projections := "id, parent_id, root_id, hash, box, path, " +
		"highlight(" + table + ", 6, '__@mark__', '__mark@__') AS hpath, " +
		"highlight(" + table + ", 7, '__@mark__', '__mark@__') AS name, " +
		"highlight(" + table + ", 8, '__@mark__', '__mark@__') AS alias, " +
		"highlight(" + table + ", 9, '__@mark__', '__mark@__') AS memo, " +
		"tag, " +
		"highlight(" + table + ", 11, '__@mark__', '__mark@__') AS content, " +
		"fcontent, markdown, length, type, subtype, ial, sort, created, updated"
	stmt := "SELECT " + projections + " FROM " + table + " WHERE " + table + " MATCH '" + columnFilter() + ":(" + query + ")' AND type IN " + filter
	if "" != box {
		stmt += " AND box = '" + box + "'"
	}
	if "" != path {
		stmt += " AND path LIKE '" + path + "%'"
	}
	stmt += " ORDER BY sort ASC, rank ASC LIMIT " + strconv.Itoa(Conf.Search.Limit)
	blocks := sql.SelectBlocksRawStmt(stmt, Conf.Search.Limit)
	ret = fromSQLBlocks(&blocks, "", beforeLen)
	if 1 > len(ret) {
		ret = []*Block{}
	}
	return
}

func query2Stmt(queryStr string) (ret string) {
	buf := bytes.Buffer{}
	if util.IsIDPattern(queryStr) {
		buf.WriteString("id = '" + queryStr + "'")
	} else {
		var tags []string
		luteEngine := NewLute()
		t := parse.Inline("", []byte(queryStr), luteEngine.ParseOptions)
		ast.Walk(t.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			if ast.NodeTag == n.Type {
				tags = append(tags, n.Text())
			}
			return ast.WalkContinue
		})

		for _, tag := range tags {
			queryStr = strings.ReplaceAll(queryStr, "#"+tag+"#", "")
		}
		parts := strings.Split(queryStr, " ")

		for i, part := range parts {
			if "" == part {
				continue
			}
			part = strings.ReplaceAll(part, "'", "''")
			buf.WriteString("(content LIKE '%" + part + "%'")
			buf.WriteString(Conf.Search.NAMFilter(part))
			buf.WriteString(")")
			if i < len(parts)-1 {
				buf.WriteString(" AND ")
			}
		}

		if 0 < len(tags) {
			if 0 < buf.Len() {
				buf.WriteString(" OR ")
			}
			for i, tag := range tags {
				buf.WriteString("(content LIKE '%#" + tag + "#%')")
				if i < len(tags)-1 {
					buf.WriteString(" AND ")
				}
			}
			buf.WriteString(" OR ")
			for i, tag := range tags {
				buf.WriteString("ial LIKE '%tags=\"%" + tag + "%\"%'")
				if i < len(tags)-1 {
					buf.WriteString(" AND ")
				}
			}
		}
	}
	if 1 > buf.Len() {
		buf.WriteString("1=1")
	}
	ret = buf.String()
	return
}

func markSearch(text string, keyword string, beforeLen int) (marked string, score float64) {
	if 0 == len(keyword) {
		marked = text
		if maxLen := 5120; maxLen < utf8.RuneCountInString(marked) {
			marked = gulu.Str.SubStr(marked, maxLen) + "..."
		}

		if strings.Contains(marked, "<mark>__r") { // 使用 FTS snippet() 处理过高亮片段，这里简单替换后就返回
			marked = strings.ReplaceAll(marked, "<mark>__r", "<mark>")
			return
		}

		keywords := gulu.Str.SubstringsBetween(marked, "__@mark__", "__mark@__")
		keywords = gulu.Str.RemoveDuplicatedElem(keywords)
		keyword = strings.Join(keywords, search.TermSep)
		marked = strings.ReplaceAll(marked, "__@mark__", "")
		marked = strings.ReplaceAll(marked, "__mark@__", "")
		_, marked = search.MarkText(marked, keyword, beforeLen, Conf.Search.CaseSensitive)
		return
	}

	pos, marked := search.MarkText(text, keyword, beforeLen, Conf.Search.CaseSensitive)
	if -1 < pos {
		if 0 == pos {
			score = 1
		}
		score += float64(strings.Count(marked, "<mark>"))
		winkler := smetrics.JaroWinkler(text, keyword, 0.7, 4)
		score += winkler
	}
	score = -score // 分越小排序越靠前
	return
}

func fromSQLBlocks(sqlBlocks *[]*sql.Block, terms string, beforeLen int) (ret []*Block) {
	for _, sqlBlock := range *sqlBlocks {
		ret = append(ret, fromSQLBlock(sqlBlock, terms, beforeLen))
	}
	return
}

func fromSQLBlock(sqlBlock *sql.Block, terms string, beforeLen int) (block *Block) {
	if nil == sqlBlock {
		return
	}

	id := sqlBlock.ID
	content := sqlBlock.Content
	p := sqlBlock.Path

	content, _ = markSearch(content, terms, beforeLen)
	markdown := maxContent(sqlBlock.Markdown, 5120)
	content = maxContent(content, 5120)

	block = &Block{
		Box:      sqlBlock.Box,
		Path:     p,
		ID:       id,
		RootID:   sqlBlock.RootID,
		ParentID: sqlBlock.ParentID,
		Alias:    sqlBlock.Alias,
		Name:     sqlBlock.Name,
		Memo:     sqlBlock.Memo,
		Tag:      sqlBlock.Tag,
		Content:  content,
		FContent: sqlBlock.FContent,
		Markdown: markdown,
		Type:     treenode.FromAbbrType(sqlBlock.Type),
		SubType:  sqlBlock.SubType,
	}
	if "" != sqlBlock.IAL {
		block.IAL = map[string]string{}
		ialStr := strings.TrimPrefix(sqlBlock.IAL, "{:")
		ialStr = strings.TrimSuffix(ialStr, "}")
		ial := parse.Tokens2IAL([]byte(ialStr))
		for _, kv := range ial {
			block.IAL[kv[0]] = kv[1]
		}
	}

	hPath, _ := markSearch(sqlBlock.HPath, terms, 18)
	if !strings.HasPrefix(hPath, "/") {
		hPath = "/" + hPath
	}
	block.HPath = hPath

	if "" != block.Name {
		block.Name, _ = markSearch(block.Name, terms, 256)
	}
	if "" != block.Alias {
		block.Alias, _ = markSearch(block.Alias, terms, 256)
	}
	if "" != block.Memo {
		block.Memo, _ = markSearch(block.Memo, terms, 256)
	}
	return
}

func maxContent(content string, maxLen int) string {
	if maxLen < utf8.RuneCountInString(content) {
		return gulu.Str.SubStr(content, maxLen) + "..."
	}
	return content
}

func columnFilter() string {
	buf := bytes.Buffer{}
	buf.WriteString("{content")
	if Conf.Search.Name {
		buf.WriteString(" name")
	}
	if Conf.Search.Alias {
		buf.WriteString(" alias")
	}
	if Conf.Search.Memo {
		buf.WriteString(" memo")
	}
	if Conf.Search.Custom {
		buf.WriteString(" ial")
	}
	buf.WriteString(" tag}")
	return buf.String()
}

func stringQuery(query string) string {
	query = strings.ReplaceAll(query, "\"", "\"\"")
	query = strings.ReplaceAll(query, "'", "''")

	buf := bytes.Buffer{}
	parts := strings.Split(query, " ")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		part = "\"" + part + "\""
		buf.WriteString(part)
		buf.WriteString(" ")
	}
	return strings.TrimSpace(buf.String())
}
