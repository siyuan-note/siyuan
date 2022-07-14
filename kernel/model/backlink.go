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
	"fmt"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RefreshBacklink(id string) {
	WaitForWritingFiles()

	tx, err := sql.BeginTx()
	if nil != err {
		return
	}
	defer sql.CommitTx(tx)

	refs := sql.QueryRefsByDefID(id, false)
	trees := map[string]*parse.Tree{}
	for _, ref := range refs {
		tree := trees[ref.RootID]
		if nil == tree {
			tree, err = loadTreeByBlockID(ref.RootID)
			if nil != err {
				util.LogErrorf("refresh tree refs failed: %s", err)
				continue
			}
			trees[ref.RootID] = tree
			sql.UpsertRefs(tx, tree)
		}
	}
}

func CreateBacklink(defID, refID, refText string, isDynamic bool) (refRootID string, err error) {
	refTree, err := loadTreeByBlockID(refID)
	if nil != err {
		return "", err
	}
	refNode := treenode.GetNodeInTree(refTree, refID)
	if nil == refNode {
		return
	}
	refRootID = refTree.Root.ID

	defBlockTree := treenode.GetBlockTree(defID)
	if nil == defBlockTree {
		return
	}
	defRoot := sql.GetBlock(defBlockTree.RootID)
	if nil == defRoot {
		return
	}

	refTextLower := strings.ToLower(refText)
	defBlock := sql.QueryBlockByNameOrAlias(defRoot.ID, refText)
	if nil == defBlock {
		if strings.ToLower(defRoot.Content) == refTextLower {
			// 如果命名别名没有命中，但文档名和提及关键字匹配，则使用文档作为定义块
			defBlock = defRoot
		}
		if nil == defBlock {
			// 使用锚文本进行搜索，取第一个匹配的定义块
			if defIDs := sql.QueryBlockDefIDsByRefText(refTextLower, nil); 0 < len(defIDs) {
				if defBlock = sql.GetBlock(defIDs[0]); nil != defBlock {
					goto OK
				}
			}
		}
		if nil == defBlock {
			defBlock = sql.GetBlock(defBlockTree.ID)
		}
		if nil == defBlock {
			return
		}
		if strings.ToLower(defBlock.Content) != refTextLower {
			return
		}
	}

OK:
	luteEngine := NewLute()
	found := false
	var toRemove []*ast.Node
	ast.Walk(refNode, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeText != n.Type {
			return ast.WalkContinue
		}

		text := gulu.Str.FromBytes(n.Tokens)
		re := regexp.MustCompile("(?i)" + refText)
		if strings.Contains(strings.ToLower(text), refTextLower) {
			if isDynamic {
				text = re.ReplaceAllString(text, "(("+defBlock.ID+" '"+refText+"'))")
			} else {
				text = re.ReplaceAllString(text, "(("+defBlock.ID+" \""+refText+"\"))")
			}
			found = true
			subTree := parse.Inline("", []byte(text), luteEngine.ParseOptions)
			var toInsert []*ast.Node
			for newNode := subTree.Root.FirstChild.FirstChild; nil != newNode; newNode = newNode.Next {
				toInsert = append(toInsert, newNode)
			}
			for _, insert := range toInsert {
				n.InsertBefore(insert)
			}
			toRemove = append(toRemove, n)
		}
		return ast.WalkContinue
	})

	for _, n := range toRemove {
		n.Unlink()
	}

	if found {
		refTree.Root.SetIALAttr("updated", util.CurrentTimeSecondsStr())
		if err = indexWriteJSONQueue(refTree); nil != err {
			return "", err
		}
		IncSync()
	}
	sql.WaitForWritingDatabase()
	return
}

func BuildTreeBacklink(id, keyword, mentionKeyword string, beforeLen int) (boxID string, linkPaths, mentionPaths []*Path, linkRefsCount, mentionsCount int) {
	linkPaths = []*Path{}
	mentionPaths = []*Path{}

	sqlBlock := sql.GetBlock(id)
	if nil == sqlBlock {
		return
	}
	rootID := sqlBlock.RootID
	boxID = sqlBlock.Box

	var links []*Block
	refs := sql.QueryRefsByDefID(id, true)

	// 为了减少查询，组装好 IDs 后一次查出
	defSQLBlockIDs, refSQLBlockIDs := map[string]bool{}, map[string]bool{}
	var queryBlockIDs []string
	for _, ref := range refs {
		defSQLBlockIDs[ref.DefBlockID] = true
		refSQLBlockIDs[ref.BlockID] = true
		queryBlockIDs = append(queryBlockIDs, ref.DefBlockID)
		queryBlockIDs = append(queryBlockIDs, ref.BlockID)
	}
	querySQLBlocks := sql.GetBlocks(queryBlockIDs)
	defSQLBlocksCache := map[string]*sql.Block{}
	for _, defSQLBlock := range querySQLBlocks {
		if nil != defSQLBlock && defSQLBlockIDs[defSQLBlock.ID] {
			defSQLBlocksCache[defSQLBlock.ID] = defSQLBlock
		}
	}
	refSQLBlocksCache := map[string]*sql.Block{}
	for _, refSQLBlock := range querySQLBlocks {
		if nil != refSQLBlock && refSQLBlockIDs[refSQLBlock.ID] {
			refSQLBlocksCache[refSQLBlock.ID] = refSQLBlock
		}
	}

	excludeBacklinkIDs := hashset.New()
	for _, ref := range refs {
		defSQLBlock := defSQLBlocksCache[(ref.DefBlockID)]
		if nil == defSQLBlock {
			continue
		}

		refSQLBlock := refSQLBlocksCache[ref.BlockID]
		if nil == refSQLBlock {
			continue
		}
		refBlock := fromSQLBlock(refSQLBlock, "", beforeLen)
		if rootID == refBlock.RootID { // 排除当前文档内引用提及
			excludeBacklinkIDs.Add(refBlock.RootID, refBlock.ID)
		}
		defBlock := fromSQLBlock(defSQLBlock, "", beforeLen)
		if defBlock.RootID == rootID { // 当前文档的定义块
			links = append(links, defBlock)
			if ref.DefBlockID == defBlock.ID {
				defBlock.Refs = append(defBlock.Refs, refBlock)
			}
		}
	}

	for _, link := range links {
		for _, ref := range link.Refs {
			excludeBacklinkIDs.Add(ref.RootID, ref.ID)
		}
		linkRefsCount += len(link.Refs)
	}

	var linkRefs []*Block
	processedParagraphs := hashset.New()
	var paragraphParentIDs []string
	for _, link := range links {
		for _, ref := range link.Refs {
			if "NodeParagraph" == ref.Type {
				paragraphParentIDs = append(paragraphParentIDs, ref.ParentID)
			}
		}
	}
	paragraphParents := sql.GetBlocks(paragraphParentIDs)
	for _, p := range paragraphParents {
		if "i" == p.Type {
			linkRefs = append(linkRefs, fromSQLBlock(p, keyword, beforeLen))
			processedParagraphs.Add(p.ID)
		}
	}
	for _, link := range links {
		for _, ref := range link.Refs {
			if "NodeParagraph" == ref.Type {
				if processedParagraphs.Contains(ref.ParentID) {
					continue
				}
			}

			ref.DefID = link.ID
			ref.DefPath = link.Path

			content := ref.Content
			if "" != keyword {
				_, content = search.MarkText(content, keyword, beforeLen, Conf.Search.CaseSensitive)
				ref.Content = content
			}
			linkRefs = append(linkRefs, ref)
		}
	}
	linkPaths = toSubTree(linkRefs, keyword)

	mentions := buildTreeBackmention(sqlBlock, linkRefs, mentionKeyword, excludeBacklinkIDs, beforeLen)
	mentionsCount = len(mentions)
	mentionPaths = toFlatTree(mentions, 0, "backlink")
	return
}

func buildTreeBackmention(defSQLBlock *sql.Block, refBlocks []*Block, keyword string, excludeBacklinkIDs *hashset.Set, beforeLen int) (ret []*Block) {
	ret = []*Block{}

	var names, aliases []string
	var fName, rootID string
	if "d" == defSQLBlock.Type {
		if Conf.Search.BacklinkMentionName {
			names = sql.QueryBlockNamesByRootID(defSQLBlock.ID)
		}
		if Conf.Search.BacklinkMentionAlias {
			aliases = sql.QueryBlockAliases(defSQLBlock.ID)
		}
		if Conf.Search.BacklinkMentionDoc {
			fName = path.Base(defSQLBlock.HPath)
		}
		rootID = defSQLBlock.ID
	} else {
		if Conf.Search.BacklinkMentionName {
			if "" != defSQLBlock.Name {
				names = append(names, defSQLBlock.Name)
			}
		}
		if Conf.Search.BacklinkMentionAlias {
			if "" != defSQLBlock.Alias {
				aliases = strings.Split(defSQLBlock.Alias, ",")
			}
		}
		root := treenode.GetBlockTree(defSQLBlock.RootID)
		rootID = root.ID
	}

	set := hashset.New()
	for _, name := range names {
		set.Add(name)
	}
	for _, alias := range aliases {
		set.Add(alias)
	}
	if "" != fName {
		set.Add(fName)
	}

	if Conf.Search.BacklinkMentionAnchor {
		for _, refBlock := range refBlocks {
			refs := sql.QueryRefsByDefIDRefID(refBlock.DefID, refBlock.ID)
			for _, ref := range refs {
				set.Add(ref.Content)
			}
		}
	}

	var mentionKeywords []string
	for _, v := range set.Values() {
		mentionKeywords = append(mentionKeywords, v.(string))
	}
	ret = searchBackmention(mentionKeywords, keyword, excludeBacklinkIDs, rootID, beforeLen)
	return
}

func searchBackmention(mentionKeywords []string, keyword string, excludeBacklinkIDs *hashset.Set, rootID string, beforeLen int) (ret []*Block) {
	ret = []*Block{}

	if 1 > len(mentionKeywords) {
		return
	}
	sort.SliceStable(mentionKeywords, func(i, j int) bool {
		return len(mentionKeywords[i]) < len(mentionKeywords[j])
	})

	table := "blocks_fts" // 大小写敏感
	if !Conf.Search.CaseSensitive {
		table = "blocks_fts_case_insensitive"
	}

	buf := bytes.Buffer{}
	buf.WriteString("SELECT * FROM " + table + " WHERE " + table + " MATCH '{content}:(")
	for i, mentionKeyword := range mentionKeywords {
		if 511 < i { // 提及搜索最大限制 https://github.com/siyuan-note/siyuan/issues/3715
			util.PushMsg(fmt.Sprintf(Conf.Language(38), len(mentionKeywords)), 5000)
			mentionKeyword = strings.ReplaceAll(mentionKeyword, "\"", "\"\"")
			buf.WriteString("\"" + mentionKeyword + "\"")
			break
		}

		mentionKeyword = strings.ReplaceAll(mentionKeyword, "\"", "\"\"")
		buf.WriteString("\"" + mentionKeyword + "\"")
		if i < len(mentionKeywords)-1 {
			buf.WriteString(" OR ")
		}
	}
	buf.WriteString(")")
	if "" != keyword {
		keyword = strings.ReplaceAll(keyword, "\"", "\"\"")
		buf.WriteString(" AND (\"" + keyword + "\")")
	}
	buf.WriteString("'")
	buf.WriteString(" AND root_id != '" + rootID + "'") // 不在定义块所在文档中搜索
	buf.WriteString(" AND type IN ('d', 'h', 'p', 't')")
	buf.WriteString(" ORDER BY id DESC LIMIT " + strconv.Itoa(Conf.Search.Limit))
	query := buf.String()

	sqlBlocks := sql.SelectBlocksRawStmt(query, Conf.Search.Limit)
	terms := mentionKeywords
	if "" != keyword {
		terms = append(terms, keyword)
	}
	blocks := fromSQLBlocks(&sqlBlocks, strings.Join(terms, search.TermSep), beforeLen)

	// 排除链接文本 https://github.com/siyuan-note/siyuan/issues/1542
	luteEngine := NewLute()
	var tmp []*Block
	for _, b := range blocks {
		tree := parse.Parse("", gulu.Str.ToBytes(b.Markdown), luteEngine.ParseOptions)
		if nil == tree {
			continue
		}

		textBuf := &bytes.Buffer{}
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || n.IsBlock() {
				return ast.WalkContinue
			}
			if ast.NodeText == n.Type || ast.NodeLinkText == n.Type {
				textBuf.Write(n.Tokens)
			}
			return ast.WalkContinue
		})

		text := textBuf.String()
		text = strings.ToLower(text)
		var contain bool
		for _, mentionKeyword := range mentionKeywords {
			if strings.Contains(text, strings.ToLower(mentionKeyword)) {
				contain = true
				break
			}
		}
		if contain {
			tmp = append(tmp, b)
		}
	}
	blocks = tmp

	mentionBlockMap := map[string]*Block{}
	for _, block := range blocks {
		mentionBlockMap[block.ID] = block

		refText := getContainStr(block.Content, mentionKeywords)
		block.RefText = refText
	}

	for _, mentionBlock := range mentionBlockMap {
		if !excludeBacklinkIDs.Contains(mentionBlock.ID) {
			ret = append(ret, mentionBlock)
		}
	}

	sort.SliceStable(ret, func(i, j int) bool {
		return ret[i].ID > ret[j].ID
	})
	return
}

func getContainStr(str string, strs []string) string {
	str = strings.ToLower(str)
	for _, s := range strs {
		if strings.Contains(str, strings.ToLower(s)) {
			return s
		}
	}
	return ""
}

// buildFullLinks 构建正向和反向链接列表。
// forwardlinks：正向链接关系 refs
// backlinks：反向链接关系 defs
func buildFullLinks(condition string) (forwardlinks, backlinks []*Block) {
	forwardlinks, backlinks = []*Block{}, []*Block{}
	defs := buildDefsAndRefs(condition)
	backlinks = append(backlinks, defs...)
	for _, def := range defs {
		for _, ref := range def.Refs {
			forwardlinks = append(forwardlinks, ref)
		}
	}
	return
}

func buildDefsAndRefs(condition string) (defBlocks []*Block) {
	defBlockMap := map[string]*Block{}
	refBlockMap := map[string]*Block{}
	defRefs := sql.DefRefs(condition)

	// 将 sql block 转为 block
	for _, row := range defRefs {
		for def, ref := range row {
			if nil == ref {
				continue
			}

			refBlock := refBlockMap[ref.ID]
			if nil == refBlock {
				refBlock = fromSQLBlock(ref, "", 0)
				refBlockMap[ref.ID] = refBlock
			}

			// ref 块自己也需要作为定义块，否则图上没有节点
			if defBlock := defBlockMap[ref.ID]; nil == defBlock {
				defBlockMap[ref.ID] = refBlock
			}

			if defBlock := defBlockMap[def.ID]; nil == defBlock {
				defBlock = fromSQLBlock(def, "", 0)
				defBlockMap[def.ID] = defBlock
			}
		}
	}

	// 组装 block.Defs 和 block.Refs 字段
	for _, row := range defRefs {
		for def, ref := range row {
			if nil == ref {
				defBlock := fromSQLBlock(def, "", 0)
				defBlockMap[def.ID] = defBlock
				continue
			}

			refBlock := refBlockMap[ref.ID]
			defBlock := defBlockMap[def.ID]
			if refBlock.ID == defBlock.ID { // 自引用
				continue
			}

			refBlock.Defs = append(refBlock.Defs, defBlock)
			defBlock.Refs = append(defBlock.Refs, refBlock)
		}
	}

	for _, def := range defBlockMap {
		defBlocks = append(defBlocks, def)
	}
	return
}
