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
	"fmt"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/facette/natsort"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RefreshBacklink(id string) {
	WaitForWritingFiles()

	refs := sql.QueryRefsByDefID(id, false)
	trees := map[string]*parse.Tree{}
	for _, ref := range refs {
		tree := trees[ref.RootID]
		if nil == tree {
			var loadErr error
			tree, loadErr = loadTreeByBlockID(ref.RootID)
			if nil != loadErr {
				logging.LogErrorf("refresh tree refs failed: %s", loadErr)
				continue
			}
			trees[ref.RootID] = tree
			sql.UpdateRefsTreeQueue(tree)
		}
	}
}

type Backlink struct {
	DOM        string       `json:"dom"`
	BlockPaths []*BlockPath `json:"blockPaths"`
	Expand     bool         `json:"expand"`
}

func GetBackmentionDoc(defID, refTreeID, keyword string) (ret []*Backlink) {
	keyword = strings.TrimSpace(keyword)
	ret = []*Backlink{}
	beforeLen := 12
	sqlBlock := sql.GetBlock(defID)
	if nil == sqlBlock {
		return
	}
	rootID := sqlBlock.RootID

	refs := sql.QueryRefsByDefID(defID, true)
	refs = removeDuplicatedRefs(refs) // 同一个块中引用多个相同块时反链去重 https://github.com/siyuan-note/siyuan/issues/3317

	linkRefs, _, excludeBacklinkIDs := buildLinkRefs(rootID, refs, keyword)
	tmpMentions, mentionKeywords := buildTreeBackmention(sqlBlock, linkRefs, keyword, excludeBacklinkIDs, beforeLen)
	luteEngine := NewLute()
	treeCache := map[string]*parse.Tree{}
	var mentions []*Block
	for _, mention := range tmpMentions {
		if mention.RootID == refTreeID {
			mentions = append(mentions, mention)
		}
	}

	if "" != keyword {
		mentionKeywords = append(mentionKeywords, keyword)
	}
	mentionKeywords = gulu.Str.RemoveDuplicatedElem(mentionKeywords)
	for _, mention := range mentions {
		refTree := treeCache[mention.RootID]
		if nil == refTree {
			var loadErr error
			refTree, loadErr = loadTreeByBlockID(mention.ID)
			if nil != loadErr {
				logging.LogWarnf("load ref tree [%s] failed: %s", mention.ID, loadErr)
				continue
			}
			treeCache[mention.RootID] = refTree
		}

		backlink := buildBacklink(mention.ID, refTree, mentionKeywords, luteEngine)
		ret = append(ret, backlink)
	}
	return
}

func GetBacklinkDoc(defID, refTreeID, keyword string) (ret []*Backlink) {
	keyword = strings.TrimSpace(keyword)
	ret = []*Backlink{}
	sqlBlock := sql.GetBlock(defID)
	if nil == sqlBlock {
		return
	}
	rootID := sqlBlock.RootID

	tmpRefs := sql.QueryRefsByDefID(defID, true)
	var refs []*sql.Ref
	for _, ref := range tmpRefs {
		if ref.RootID == refTreeID {
			refs = append(refs, ref)
		}
	}
	refs = removeDuplicatedRefs(refs) // 同一个块中引用多个相同块时反链去重 https://github.com/siyuan-note/siyuan/issues/3317

	linkRefs, _, _ := buildLinkRefs(rootID, refs, keyword)
	refTree, err := loadTreeByBlockID(refTreeID)
	if nil != err {
		logging.LogWarnf("load ref tree [%s] failed: %s", refTreeID, err)
		return
	}

	luteEngine := NewLute()
	for _, linkRef := range linkRefs {
		var keywords []string
		if "" != keyword {
			keywords = append(keywords, keyword)
		}
		backlink := buildBacklink(linkRef.ID, refTree, keywords, luteEngine)
		ret = append(ret, backlink)
	}
	return
}

func buildBacklink(refID string, refTree *parse.Tree, keywords []string, luteEngine *lute.Lute) (ret *Backlink) {
	n := treenode.GetNodeInTree(refTree, refID)
	if nil == n {
		return
	}

	renderNodes, expand := getBacklinkRenderNodes(n)

	if 0 < len(keywords) {
		for _, renderNode := range renderNodes {
			var unlinks []*ast.Node

			ast.Walk(renderNode, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}

				if n.IsBlock() {
					return ast.WalkContinue
				}

				markReplaceSpan(n, &unlinks, keywords, search.MarkDataType, luteEngine)
				return ast.WalkContinue
			})

			for _, unlink := range unlinks {
				unlink.Unlink()
			}
		}
	}

	dom := renderBlockDOMByNodes(renderNodes, luteEngine)
	ret = &Backlink{
		DOM:        dom,
		BlockPaths: buildBlockBreadcrumb(n, nil),
		Expand:     expand,
	}
	return
}

func getBacklinkRenderNodes(n *ast.Node) (ret []*ast.Node, expand bool) {
	expand = true
	if ast.NodeListItem == n.Type {
		if nil == n.FirstChild {
			return
		}

		c := n.FirstChild
		if 3 == n.ListData.Typ {
			c = n.FirstChild.Next
		}

		if c != n.LastChild { // 存在子列表
			for liFirstBlockSpan := c.FirstChild; nil != liFirstBlockSpan; liFirstBlockSpan = liFirstBlockSpan.Next {
				if treenode.IsBlockRef(liFirstBlockSpan) {
					continue
				}
				if "" != strings.TrimSpace(liFirstBlockSpan.Text()) {
					expand = false
					break
				}
			}
		}

		ret = append(ret, n)
	} else if ast.NodeHeading == n.Type {
		c := n.FirstChild
		if nil == c {
			return
		}

		for headingFirstSpan := c; nil != headingFirstSpan; headingFirstSpan = headingFirstSpan.Next {
			if treenode.IsBlockRef(headingFirstSpan) {
				continue
			}
			if "" != strings.TrimSpace(headingFirstSpan.Text()) {
				expand = false
				break
			}
		}

		ret = append(ret, n)
		cc := treenode.HeadingChildren(n)
		ret = append(ret, cc...)
	} else {
		ret = append(ret, n)
	}
	return
}

func GetBacklink2(id, keyword, mentionKeyword string, sortMode, mentionSortMode int) (boxID string, backlinks, backmentions []*Path, linkRefsCount, mentionsCount int) {
	keyword = strings.TrimSpace(keyword)
	mentionKeyword = strings.TrimSpace(mentionKeyword)
	backlinks, backmentions = []*Path{}, []*Path{}

	sqlBlock := sql.GetBlock(id)
	if nil == sqlBlock {
		return
	}
	rootID := sqlBlock.RootID
	boxID = sqlBlock.Box

	refs := sql.QueryRefsByDefID(id, true)
	refs = removeDuplicatedRefs(refs) // 同一个块中引用多个相同块时反链去重 https://github.com/siyuan-note/siyuan/issues/3317

	linkRefs, linkRefsCount, excludeBacklinkIDs := buildLinkRefs(rootID, refs, keyword)
	tmpBacklinks := toFlatTree(linkRefs, 0, "backlink", nil)

	for _, l := range tmpBacklinks {
		l.Blocks = nil
		backlinks = append(backlinks, l)
	}

	sort.Slice(backlinks, func(i, j int) bool {
		switch sortMode {
		case util.SortModeUpdatedDESC:
			return backlinks[i].Updated > backlinks[j].Updated
		case util.SortModeUpdatedASC:
			return backlinks[i].Updated < backlinks[j].Updated
		case util.SortModeCreatedDESC:
			return backlinks[i].Created > backlinks[j].Created
		case util.SortModeCreatedASC:
			return backlinks[i].Created < backlinks[j].Created
		case util.SortModeNameDESC:
			return util.PinYinCompare(util.RemoveEmoji(backlinks[j].Name), util.RemoveEmoji(backlinks[i].Name))
		case util.SortModeNameASC:
			return util.PinYinCompare(util.RemoveEmoji(backlinks[i].Name), util.RemoveEmoji(backlinks[j].Name))
		case util.SortModeAlphanumDESC:
			return natsort.Compare(util.RemoveEmoji(backlinks[j].Name), util.RemoveEmoji(backlinks[i].Name))
		case util.SortModeAlphanumASC:
			return natsort.Compare(util.RemoveEmoji(backlinks[i].Name), util.RemoveEmoji(backlinks[j].Name))
		}
		return backlinks[i].ID > backlinks[j].ID
	})

	mentionRefs, _ := buildTreeBackmention(sqlBlock, linkRefs, mentionKeyword, excludeBacklinkIDs, 12)
	tmpBackmentions := toFlatTree(mentionRefs, 0, "backlink", nil)
	for _, l := range tmpBackmentions {
		l.Blocks = nil
		backmentions = append(backmentions, l)
	}

	sort.Slice(backmentions, func(i, j int) bool {
		switch mentionSortMode {
		case util.SortModeUpdatedDESC:
			return backmentions[i].Updated > backmentions[j].Updated
		case util.SortModeUpdatedASC:
			return backmentions[i].Updated < backmentions[j].Updated
		case util.SortModeCreatedDESC:
			return backmentions[i].Created > backmentions[j].Created
		case util.SortModeCreatedASC:
			return backmentions[i].Created < backmentions[j].Created
		case util.SortModeNameDESC:
			return util.PinYinCompare(util.RemoveEmoji(backmentions[j].Name), util.RemoveEmoji(backmentions[i].Name))
		case util.SortModeNameASC:
			return util.PinYinCompare(util.RemoveEmoji(backmentions[i].Name), util.RemoveEmoji(backmentions[j].Name))
		case util.SortModeAlphanumDESC:
			return natsort.Compare(util.RemoveEmoji(backmentions[j].Name), util.RemoveEmoji(backmentions[i].Name))
		case util.SortModeAlphanumASC:
			return natsort.Compare(util.RemoveEmoji(backmentions[i].Name), util.RemoveEmoji(backmentions[j].Name))
		}
		return backmentions[i].ID > backmentions[j].ID
	})

	mentionsCount = len(backmentions)

	// 添加笔记本名称
	var boxIDs []string
	for _, l := range backlinks {
		boxIDs = append(boxIDs, l.Box)
	}
	for _, l := range backmentions {
		boxIDs = append(boxIDs, l.Box)
	}
	boxIDs = gulu.Str.RemoveDuplicatedElem(boxIDs)
	boxNames := Conf.BoxNames(boxIDs)
	for _, l := range backlinks {
		name := boxNames[l.Box]
		l.HPath = name + l.HPath
	}
	for _, l := range backmentions {
		name := boxNames[l.Box]
		l.HPath = name + l.HPath
	}
	return
}

func GetBacklink(id, keyword, mentionKeyword string, beforeLen int) (boxID string, linkPaths, mentionPaths []*Path, linkRefsCount, mentionsCount int) {
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
	refs = removeDuplicatedRefs(refs) // 同一个块中引用多个相同块时反链去重 https://github.com/siyuan-note/siyuan/issues/3317

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
		if "i" == p.Type || "h" == p.Type {
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

	mentions, _ := buildTreeBackmention(sqlBlock, linkRefs, mentionKeyword, excludeBacklinkIDs, beforeLen)
	mentionsCount = len(mentions)
	mentionPaths = toFlatTree(mentions, 0, "backlink", nil)
	return
}

func buildLinkRefs(defRootID string, refs []*sql.Ref, keyword string) (ret []*Block, refsCount int, excludeBacklinkIDs *hashset.Set) {
	// 为了减少查询，组装好 IDs 后一次查出
	defSQLBlockIDs, refSQLBlockIDs := map[string]bool{}, map[string]bool{}
	var queryBlockIDs []string
	for _, ref := range refs {
		defSQLBlockIDs[ref.DefBlockID] = true
		refSQLBlockIDs[ref.BlockID] = true
		queryBlockIDs = append(queryBlockIDs, ref.DefBlockID)
		queryBlockIDs = append(queryBlockIDs, ref.BlockID)
	}
	queryBlockIDs = gulu.Str.RemoveDuplicatedElem(queryBlockIDs)
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

	var links []*Block
	excludeBacklinkIDs = hashset.New()
	for _, ref := range refs {
		defSQLBlock := defSQLBlocksCache[(ref.DefBlockID)]
		if nil == defSQLBlock {
			continue
		}

		refSQLBlock := refSQLBlocksCache[ref.BlockID]
		if nil == refSQLBlock {
			continue
		}
		refBlock := fromSQLBlock(refSQLBlock, "", 12)
		if defRootID == refBlock.RootID { // 排除当前文档内引用提及
			excludeBacklinkIDs.Add(refBlock.RootID, refBlock.ID)
		}
		defBlock := fromSQLBlock(defSQLBlock, "", 12)
		if defBlock.RootID == defRootID { // 当前文档的定义块
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
		refsCount += len(link.Refs)
	}

	parentRefParagraphs := map[string]*Block{}
	for _, link := range links {
		for _, ref := range link.Refs {
			if "NodeParagraph" == ref.Type {
				parentRefParagraphs[ref.ParentID] = ref
			}
		}
	}

	var paragraphParentIDs []string
	for parentID, _ := range parentRefParagraphs {
		paragraphParentIDs = append(paragraphParentIDs, parentID)
	}
	paragraphParents := sql.GetBlocks(paragraphParentIDs)

	processedParagraphs := hashset.New()
	for _, p := range paragraphParents {
		// 改进标题下方块和列表项子块引用时的反链定位 https://github.com/siyuan-note/siyuan/issues/7484
		if "i" == p.Type {
			refBlock := parentRefParagraphs[p.ID]
			if nil != refBlock && p.FContent == refBlock.Content { // 使用内容判断是否是列表项下第一个子块
				// 如果是列表项下第一个子块，则后续会通过列表项传递或关联处理，所以这里就不处理这个段落了
				processedParagraphs.Add(p.ID)
				if !strings.Contains(p.Content, keyword) {
					refsCount--
					continue
				}
				ret = append(ret, fromSQLBlock(p, "", 12))
			}
		}
	}
	for _, link := range links {
		for _, ref := range link.Refs {
			if "NodeParagraph" == ref.Type {
				if processedParagraphs.Contains(ref.ParentID) {
					continue
				}
			}

			if !strings.Contains(ref.Content, keyword) {
				refsCount--
				continue
			}

			ref.DefID = link.ID
			ref.DefPath = link.Path
			ret = append(ret, ref)
		}
	}
	return
}

func removeDuplicatedRefs(refs []*sql.Ref) (ret []*sql.Ref) {
	for _, ref := range refs {
		contain := false
		for _, r := range ret {
			if ref.DefBlockID == r.DefBlockID && ref.BlockID == r.BlockID {
				contain = true
				break
			}
		}
		if !contain {
			ret = append(ret, ref)
		}
	}
	return
}

func buildTreeBackmention(defSQLBlock *sql.Block, refBlocks []*Block, keyword string, excludeBacklinkIDs *hashset.Set, beforeLen int) (ret []*Block, mentionKeywords []string) {
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

	for _, v := range set.Values() {
		mentionKeywords = append(mentionKeywords, v.(string))
	}
	mentionKeywords = prepareMarkKeywords(mentionKeywords)
	ret = searchBackmention(mentionKeywords, keyword, excludeBacklinkIDs, rootID, beforeLen)
	return
}

func searchBackmention(mentionKeywords []string, keyword string, excludeBacklinkIDs *hashset.Set, rootID string, beforeLen int) (ret []*Block) {
	ret = []*Block{}
	if 1 > len(mentionKeywords) {
		return
	}

	table := "blocks_fts" // 大小写敏感
	if !Conf.Search.CaseSensitive {
		table = "blocks_fts_case_insensitive"
	}

	buf := bytes.Buffer{}
	buf.WriteString("SELECT * FROM " + table + " WHERE " + table + " MATCH '" + columnFilter() + ":(")
	for i, mentionKeyword := range mentionKeywords {
		if Conf.Search.BacklinkMentionKeywordsLimit < i {
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

	sqlBlocks := sql.SelectBlocksRawStmt(query, 1, Conf.Search.Limit)
	terms := mentionKeywords
	if "" != keyword {
		terms = append(terms, keyword)
	}
	blocks := fromSQLBlocks(&sqlBlocks, strings.Join(terms, search.TermSep), beforeLen)

	luteEngine := util.NewLute()
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
			if ast.NodeText == n.Type { // 这里包含了标签命中的情况，因为 Lute 没有启用 TextMark
				textBuf.Write(n.Tokens)
			}
			return ast.WalkContinue
		})

		text := textBuf.String()
		text = strings.TrimSpace(text)
		if "" == text {
			continue
		}

		newText := markReplaceSpanWithSplit(text, mentionKeywords, search.GetMarkSpanStart(search.MarkDataType), search.GetMarkSpanEnd())
		if text != newText {
			tmp = append(tmp, b)
		} else {
			// columnFilter 中的命名、别名和备注命中的情况
			// 反链提及搜索范围增加命名、别名和备注 https://github.com/siyuan-note/siyuan/issues/7639
			if gulu.Str.Contains(trimMarkTags(b.Name), mentionKeywords) ||
				gulu.Str.Contains(trimMarkTags(b.Alias), mentionKeywords) ||
				gulu.Str.Contains(trimMarkTags(b.Memo), mentionKeywords) {
				tmp = append(tmp, b)
			}
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

func trimMarkTags(str string) string {
	return strings.TrimSuffix(strings.TrimPrefix(str, "<mark>"), "</mark>")
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
