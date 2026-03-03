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
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RefreshBacklink(id string) {
	FlushTxQueue()
	refreshRefsByDefID(id)
}

func refreshRefsByDefID(defID string) {
	refs := sql.QueryRefsByDefID(defID, true)
	var rootIDs []string
	for _, ref := range refs {
		rootIDs = append(rootIDs, ref.RootID)
		task.AppendAsyncTaskWithDelay(task.SetDefRefCount, util.SQLFlushInterval, refreshRefCount, ref.DefBlockID)
	}
	rootIDs = gulu.Str.RemoveDuplicatedElem(rootIDs)
	trees := filesys.LoadTrees(rootIDs)
	for _, tree := range trees {
		sql.UpdateRefsTreeQueue(tree)
		task.AppendAsyncTaskWithDelay(task.SetDefRefCount, util.SQLFlushInterval, refreshRefCount, tree.ID)
	}
	if bt := treenode.GetBlockTree(defID); nil != bt {
		task.AppendAsyncTaskWithDelay(task.SetDefRefCount, util.SQLFlushInterval, refreshRefCount, defID)
	}
}

type Backlink struct {
	DOM        string       `json:"dom"`
	BlockPaths []*BlockPath `json:"blockPaths"`
	Expand     bool         `json:"expand"`

	node *ast.Node // 仅用于按文档内容顺序排序
}

func GetBackmentionDoc(defID, refTreeID, keyword string, containChildren, highlight bool) (ret []*Backlink, keywords []string) {
	keyword = strings.TrimSpace(keyword)
	if "" != keyword {
		keywords = strings.Split(keyword, " ")
	}
	ret = []*Backlink{}
	beforeLen := 12
	sqlBlock := sql.GetBlock(defID)
	if nil == sqlBlock {
		return
	}
	rootID := sqlBlock.RootID

	refs := sql.QueryRefsByDefID(defID, containChildren)
	refs = removeDuplicatedRefs(refs)

	linkRefs, _, excludeBacklinkIDs, originalRefBlockIDs := buildLinkRefs(rootID, refs, keywords)
	tmpMentions, mentionKeywords := buildTreeBackmention(sqlBlock, linkRefs, keyword, excludeBacklinkIDs, beforeLen)
	luteEngine := util.NewLute()
	var mentions []*Block
	for _, mention := range tmpMentions {
		if mention.RootID == refTreeID {
			mentions = append(mentions, mention)
		}
	}
	var mentionBlockIDs []string
	for _, mention := range mentions {
		mentionBlockIDs = append(mentionBlockIDs, mention.ID)
	}
	mentionBlockIDs = gulu.Str.RemoveDuplicatedElem(mentionBlockIDs)

	if "" != keyword {
		mentionKeywords = append(mentionKeywords, strings.Split(keyword, " ")...)
	}
	mentionKeywords = gulu.Str.RemoveDuplicatedElem(mentionKeywords)
	keywords = append(keywords, mentionKeywords...)
	keywords = gulu.Str.RemoveDuplicatedElem(keywords)
	if 1 > len(keywords) {
		keywords = []string{}
	}

	var refTree *parse.Tree
	trees := filesys.LoadTrees(mentionBlockIDs)
	for id, tree := range trees {
		backlink := buildBacklink(id, tree, originalRefBlockIDs, mentionKeywords, highlight, luteEngine)
		if nil != backlink {
			ret = append(ret, backlink)
		}
		if nil != tree && nil == refTree {
			refTree = tree
		}
	}

	if 0 < len(trees) {
		sortBacklinks(ret, refTree)
		filterBlockPaths(ret)
	}
	return
}

func GetBacklinkDoc(defID, refTreeID, keyword string, containChildren, highlight bool) (ret []*Backlink, keywords []string) {
	keyword = strings.TrimSpace(keyword)
	if "" != keyword {
		keywords = strings.Split(keyword, " ")
	}
	keywords = gulu.Str.RemoveDuplicatedElem(keywords)
	if 1 > len(keywords) {
		keywords = []string{}
	}

	ret = []*Backlink{}
	sqlBlock := sql.GetBlock(defID)
	if nil == sqlBlock {
		return
	}
	rootID := sqlBlock.RootID

	tmpRefs := sql.QueryRefsByDefID(defID, containChildren)
	var refs []*sql.Ref
	for _, ref := range tmpRefs {
		if ref.RootID == refTreeID {
			refs = append(refs, ref)
		}
	}
	refs = removeDuplicatedRefs(refs)

	linkRefs, _, _, originalRefBlockIDs := buildLinkRefs(rootID, refs, keywords)
	refTree, err := LoadTreeByBlockID(refTreeID)
	if err != nil {
		logging.LogWarnf("load ref tree [%s] failed: %s", refTreeID, err)
		return
	}

	luteEngine := util.NewLute()
	for _, linkRef := range linkRefs {
		backlink := buildBacklink(linkRef.ID, refTree, originalRefBlockIDs, keywords, highlight, luteEngine)
		if nil != backlink {
			ret = append(ret, backlink)
		}
	}

	sortBacklinks(ret, refTree)
	filterBlockPaths(ret)
	return
}

func filterBlockPaths(blockLinks []*Backlink) {
	for _, b := range blockLinks {
		if 2 == len(b.BlockPaths) {
			// 根下只有一层则不显示
			b.BlockPaths = []*BlockPath{}
		}
	}
	return
}

func sortBacklinks(backlinks []*Backlink, tree *parse.Tree) {
	contentSorts := map[string]int{}
	sortVal := 0
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() {
			return ast.WalkContinue
		}

		contentSorts[n.ID] = sortVal
		sortVal++
		return ast.WalkContinue
	})

	sort.Slice(backlinks, func(i, j int) bool {
		s1 := contentSorts[backlinks[i].node.ID]
		s2 := contentSorts[backlinks[j].node.ID]
		return s1 < s2
	})
}

func buildBacklink(refID string, refTree *parse.Tree, originalRefBlockIDs map[string]string, keywords []string, highlight bool, luteEngine *lute.Lute) (ret *Backlink) {
	node := treenode.GetNodeInTree(refTree, refID)
	if nil == node {
		return
	}

	renderNodes, expand := getBacklinkRenderNodes(node, originalRefBlockIDs)

	if highlight && 0 < len(keywords) {
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

	// 反链面板中显示块引用计数 Display reference counts in the backlink panel https://github.com/siyuan-note/siyuan/issues/13618
	fillBlockRefCount(renderNodes)

	dom := renderBlockDOMByNodes(renderNodes, luteEngine)
	var blockPaths []*BlockPath
	if (nil != node.Parent && ast.NodeDocument != node.Parent.Type) || (ast.NodeHeading != node.Type && 0 < treenode.HeadingLevel(node)) {
		blockPaths = buildBlockBreadcrumb(node, nil, false)
	}
	if 1 > len(blockPaths) {
		blockPaths = []*BlockPath{}
	}
	ret = &Backlink{DOM: dom, BlockPaths: blockPaths, Expand: expand, node: node}
	return
}

func getBacklinkRenderNodes(n *ast.Node, originalRefBlockIDs map[string]string) (ret []*ast.Node, expand bool) {
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
			for ; nil != c; c = c.Next {
				if originalRefBlockIDs[n.ID] != c.ID {
					continue
				}

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

func GetBacklink2(id, keyword, mentionKeyword string, sortMode, mentionSortMode int, containChildren bool) (boxID string, backlinks, backmentions []*Path, linkRefsCount, mentionsCount int) {
	keyword = strings.TrimSpace(keyword)
	var keywords []string
	if "" != keyword {
		keywords = strings.Split(keyword, " ")
	}
	mentionKeyword = strings.TrimSpace(mentionKeyword)
	backlinks, backmentions = []*Path{}, []*Path{}

	sqlBlock := sql.GetBlock(id)
	if nil == sqlBlock {
		return
	}
	rootID := sqlBlock.RootID
	boxID = sqlBlock.Box

	refs := sql.QueryRefsByDefID(id, containChildren)
	refs = removeDuplicatedRefs(refs)

	linkRefs, linkRefsCount, excludeBacklinkIDs, _ := buildLinkRefs(rootID, refs, keywords)
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
			return util.PinYinCompare(backlinks[j].Name, backlinks[i].Name)
		case util.SortModeNameASC:
			return util.PinYinCompare(backlinks[i].Name, backlinks[j].Name)
		case util.SortModeAlphanumDESC:
			return util.NaturalCompare(backlinks[j].Name, backlinks[i].Name)
		case util.SortModeAlphanumASC:
			return util.NaturalCompare(backlinks[i].Name, backlinks[j].Name)
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
			return util.PinYinCompare(backmentions[j].Name, backmentions[i].Name)
		case util.SortModeNameASC:
			return util.PinYinCompare(backmentions[i].Name, backmentions[j].Name)
		case util.SortModeAlphanumDESC:
			return util.NaturalCompare(backmentions[j].Name, backmentions[i].Name)
		case util.SortModeAlphanumASC:
			return util.NaturalCompare(backmentions[i].Name, backmentions[j].Name)
		}
		return backmentions[i].ID > backmentions[j].ID
	})

	for _, backmention := range backmentions {
		mentionsCount += backmention.Count
	}

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

func GetBacklink(id, keyword, mentionKeyword string, beforeLen int, containChildren bool) (boxID string, linkPaths, mentionPaths []*Path, linkRefsCount, mentionsCount int) {
	linkPaths = []*Path{}
	mentionPaths = []*Path{}

	sqlBlock := sql.GetBlock(id)
	if nil == sqlBlock {
		return
	}
	rootID := sqlBlock.RootID
	boxID = sqlBlock.Box

	var links []*Block
	refs := sql.QueryRefsByDefID(id, containChildren)
	refs = removeDuplicatedRefs(refs)

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
		if nil == p {
			continue
		}

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

func buildLinkRefs(defRootID string, refs []*sql.Ref, keywords []string) (ret []*Block, refsCount int, excludeBacklinkIDs *hashset.Set, originalRefBlockIDs map[string]string) {
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
	var paragraphParentIDs []string
	for _, link := range links {
		for _, ref := range link.Refs {
			if "NodeParagraph" == ref.Type {
				parentRefParagraphs[ref.ParentID] = ref
				paragraphParentIDs = append(paragraphParentIDs, ref.ParentID)
			}
		}
	}
	refsCountDelta := len(paragraphParentIDs)
	paragraphParentIDs = gulu.Str.RemoveDuplicatedElem(paragraphParentIDs)
	refsCountDelta -= len(paragraphParentIDs)
	refsCount -= refsCountDelta
	sqlParagraphParents := sql.GetBlocks(paragraphParentIDs)
	paragraphParents := fromSQLBlocks(&sqlParagraphParents, "", 12)

	luteEngine := util.NewLute()
	originalRefBlockIDs = map[string]string{}
	processedParagraphs := hashset.New()
	for _, parent := range paragraphParents {
		if nil == parent {
			continue
		}

		if "NodeListItem" == parent.Type || "NodeBlockquote" == parent.Type || "NodeSuperBlock" == parent.Type || "NodeCallout" == parent.Type {
			refBlock := parentRefParagraphs[parent.ID]
			if nil == refBlock {
				continue
			}

			paragraphUseParentLi := true
			if "NodeListItem" == parent.Type && parent.FContent != refBlock.Content {
				if inlineTree := parse.Inline("", []byte(refBlock.Markdown), luteEngine.ParseOptions); nil != inlineTree {
					for c := inlineTree.Root.FirstChild.FirstChild; c != nil; c = c.Next {
						if treenode.IsBlockRef(c) {
							continue
						}

						if "" != strings.TrimSpace(c.Text()) {
							paragraphUseParentLi = false
							break
						}
					}
				}
			}

			if paragraphUseParentLi {
				processedParagraphs.Add(parent.ID)
			}

			originalRefBlockIDs[parent.ID] = refBlock.ID
			if !matchBacklinkKeyword(parent, keywords) {
				refsCount--
				continue
			}

			if paragraphUseParentLi {
				ret = append(ret, parent)
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

			if !matchBacklinkKeyword(ref, keywords) {
				refsCount--
				continue
			}

			ref.DefID = link.ID
			ref.DefPath = link.Path
			ret = append(ret, ref)
		}
	}

	if 0 < len(keywords) {
		// 过滤场景处理标题下方块 Improve backlink filtering below the heading https://github.com/siyuan-note/siyuan/issues/14929
		headingRefChildren := map[string]*Block{}
		var headingIDs []string
		for _, link := range links {
			for _, ref := range link.Refs {
				if "NodeHeading" == ref.Type {
					headingRefChildren[ref.ID] = ref
					headingIDs = append(headingIDs, ref.ID)
				}
			}
		}
		var headingChildren []*Block
		for _, headingID := range headingIDs {
			sqlChildren := sql.GetChildBlocks(headingID, "", -1)
			children := fromSQLBlocks(&sqlChildren, "", 12)
			headingChildren = append(headingChildren, children...)
		}
		for _, child := range headingChildren {
			if nil == child {
				continue
			}

			if matchBacklinkKeyword(child, keywords) {
				heading := headingRefChildren[child.ParentID]
				if nil != heading && !existBlock(heading, ret) {
					ret = append(ret, heading)
				}
			}
		}
	}
	return
}

func existBlock(block *Block, blocks []*Block) bool {
	for _, b := range blocks {
		if block.ID == b.ID {
			return true
		}
	}
	return false
}

func matchBacklinkKeyword(block *Block, keywords []string) bool {
	if 1 > len(keywords) {
		return true
	}

	for _, k := range keywords {
		k = strings.ToLower(k)
		if strings.Contains(strings.ToLower(block.Content), k) ||
			strings.Contains(strings.ToLower(path.Base(block.HPath)), k) ||
			strings.Contains(strings.ToLower(block.Name), k) ||
			strings.Contains(strings.ToLower(block.Alias), k) ||
			strings.Contains(strings.ToLower(block.Memo), k) ||
			strings.Contains(strings.ToLower(block.Tag), k) {
			return true
		}
	}
	return false
}

func removeDuplicatedRefs(refs []*sql.Ref) (ret []*sql.Ref) {
	// 同一个块中引用多个块后反链去重
	// De-duplication of backlinks after referencing multiple blocks in the same block https://github.com/siyuan-note/siyuan/issues/12147

	for _, ref := range refs {
		contain := false
		for _, r := range ret {
			if ref.BlockID == r.BlockID {
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
	mentionKeywords, ret = searchBackmention(mentionKeywords, keyword, excludeBacklinkIDs, rootID, beforeLen)
	return
}

func searchBackmention(mentionKeywords []string, keyword string, excludeBacklinkIDs *hashset.Set, rootID string, beforeLen int) (retMentionKeywords []string, ret []*Block) {
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
			if ast.NodeText == n.Type /* NodeText 包含了标签命中的情况 */ || ast.NodeLinkText == n.Type {
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

			k := gulu.Str.SubstringsBetween(newText, search.GetMarkSpanStart(search.MarkDataType), search.GetMarkSpanEnd())
			retMentionKeywords = append(retMentionKeywords, k...)
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
	retMentionKeywords = gulu.Str.RemoveDuplicatedElem(retMentionKeywords)
	mentionKeywords = retMentionKeywords

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
	defRefs := sql.DefRefs(condition, Conf.Graph.MaxBlocks)

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
