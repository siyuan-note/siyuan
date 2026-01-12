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
	"math"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/lex"
	"github.com/88250/lute/parse"
	"github.com/88250/vitess-sqlparser/sqlparser"
	"github.com/jinzhu/copier"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/xrash/smetrics"
)

func ListInvalidBlockRefs(page, pageSize int) (ret []*Block, matchedBlockCount, matchedRootCount, pageCount int) {
	refBlockMap := map[string][]string{}
	blockMap := map[string]bool{}
	var invalidBlockIDs []string
	notebooks, err := ListNotebooks()
	if err != nil {
		return
	}
	luteEngine := util.NewLute()
	for _, notebook := range notebooks {
		pages := pagedPaths(filepath.Join(util.DataDir, notebook.ID), 32)
		for _, paths := range pages {
			var trees []*parse.Tree
			for _, localPath := range paths {
				tree, loadTreeErr := loadTree(localPath, luteEngine)
				if nil != loadTreeErr {
					continue
				}
				trees = append(trees, tree)
			}
			for _, tree := range trees {
				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if entering {
						if n.IsBlock() {
							blockMap[n.ID] = true
							return ast.WalkContinue
						}

						if ast.NodeTextMark == n.Type {
							if n.IsTextMarkType("a") {
								if strings.HasPrefix(n.TextMarkAHref, "siyuan://blocks/") {
									defID := strings.TrimPrefix(n.TextMarkAHref, "siyuan://blocks/")
									if strings.Contains(defID, "?") {
										defID = strings.Split(defID, "?")[0]
									}
									refID := treenode.ParentBlock(n).ID
									if defIDs := refBlockMap[refID]; 1 > len(defIDs) {
										refBlockMap[refID] = []string{defID}
									} else {
										refBlockMap[refID] = append(defIDs, defID)
									}
								}
							} else if n.IsTextMarkType("block-ref") {
								defID := n.TextMarkBlockRefID
								refID := treenode.ParentBlock(n).ID
								if defIDs := refBlockMap[refID]; 1 > len(defIDs) {
									refBlockMap[refID] = []string{defID}
								} else {
									refBlockMap[refID] = append(defIDs, defID)
								}
							}
						}
					}
					return ast.WalkContinue
				})
			}
		}
	}

	invalidDefIDs := map[string]bool{}
	for _, refDefIDs := range refBlockMap {
		for _, defID := range refDefIDs {
			invalidDefIDs[defID] = true
		}
	}

	var toRemoves []string
	for defID := range invalidDefIDs {
		if _, ok := blockMap[defID]; ok {
			toRemoves = append(toRemoves, defID)
		}
	}
	for _, toRemove := range toRemoves {
		delete(invalidDefIDs, toRemove)
	}

	toRemoves = nil
	for refID, defIDs := range refBlockMap {
		var tmp []string
		for _, defID := range defIDs {
			if _, ok := invalidDefIDs[defID]; !ok {
				tmp = append(tmp, defID)
			}
		}

		for _, toRemove := range tmp {
			defIDs = gulu.Str.RemoveElem(defIDs, toRemove)
		}

		if 1 > len(defIDs) {
			toRemoves = append(toRemoves, refID)
		}
	}
	for _, toRemove := range toRemoves {
		delete(refBlockMap, toRemove)
	}

	for refID := range refBlockMap {
		invalidBlockIDs = append(invalidBlockIDs, refID)
	}
	invalidBlockIDs = gulu.Str.RemoveDuplicatedElem(invalidBlockIDs)

	sort.Strings(invalidBlockIDs)
	allInvalidBlockIDs := invalidBlockIDs

	start := (page - 1) * pageSize
	end := page * pageSize
	if end > len(invalidBlockIDs) {
		end = len(invalidBlockIDs)
	}
	invalidBlockIDs = invalidBlockIDs[start:end]

	sqlBlocks := sql.GetBlocks(invalidBlockIDs)
	var tmp []*sql.Block
	for _, sqlBlock := range sqlBlocks {
		if nil != sqlBlock {
			tmp = append(tmp, sqlBlock)
		}
	}
	sqlBlocks = tmp

	ret = fromSQLBlocks(&sqlBlocks, "", 36)
	if 1 > len(ret) {
		ret = []*Block{}
	}
	matchedBlockCount = len(allInvalidBlockIDs)
	rootCount := map[string]bool{}
	for _, id := range allInvalidBlockIDs {
		bt := treenode.GetBlockTree(id)
		if nil == bt {
			continue
		}
		rootCount[bt.RootID] = true
	}
	matchedRootCount = len(rootCount)
	pageCount = (matchedBlockCount + pageSize - 1) / pageSize
	return
}

type EmbedBlock struct {
	Block      *Block       `json:"block"`
	BlockPaths []*BlockPath `json:"blockPaths"`
}

func UpdateEmbedBlock(id, content string) (err error) {
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		err = ErrBlockNotFound
		return
	}

	if treenode.TypeAbbr(ast.NodeBlockQueryEmbed.String()) != bt.Type {
		err = errors.New("not query embed block")
		return
	}

	embedBlock := &EmbedBlock{
		Block: &Block{
			Markdown: content,
		},
	}

	updateEmbedBlockContent(id, []*EmbedBlock{embedBlock})
	return
}

func GetEmbedBlock(embedBlockID string, includeIDs []string, headingMode int, breadcrumb bool) (ret []*EmbedBlock) {
	return getEmbedBlock(embedBlockID, includeIDs, headingMode, breadcrumb)
}

func getEmbedBlock(embedBlockID string, includeIDs []string, headingMode int, breadcrumb bool) (ret []*EmbedBlock) {
	stmt := "SELECT * FROM `blocks` WHERE `id` IN ('" + strings.Join(includeIDs, "','") + "')"
	sqlBlocks := sql.SelectBlocksRawStmtNoParse(stmt, 1024)

	// 根据 includeIDs 的顺序排序 Improve `//!js` query embed block result sorting https://github.com/siyuan-note/siyuan/issues/9977
	m := map[string]int{}
	for i, id := range includeIDs {
		m[id] = i
	}
	sort.Slice(sqlBlocks, func(i, j int) bool {
		return m[sqlBlocks[i].ID] < m[sqlBlocks[j].ID]
	})

	ret = buildEmbedBlock(embedBlockID, []string{}, headingMode, breadcrumb, sqlBlocks)
	return
}

func SearchEmbedBlock(embedBlockID, stmt string, excludeIDs []string, headingMode int, breadcrumb bool) (ret []*EmbedBlock) {
	return searchEmbedBlock(embedBlockID, stmt, excludeIDs, headingMode, breadcrumb)
}

func searchEmbedBlock(embedBlockID, stmt string, excludeIDs []string, headingMode int, breadcrumb bool) (ret []*EmbedBlock) {
	sqlBlocks := sql.SelectBlocksRawStmtNoParse(stmt, Conf.Search.Limit)
	ret = buildEmbedBlock(embedBlockID, excludeIDs, headingMode, breadcrumb, sqlBlocks)
	return
}

func buildEmbedBlock(embedBlockID string, excludeIDs []string, headingMode int, breadcrumb bool, sqlBlocks []*sql.Block) (ret []*EmbedBlock) {
	var tmp []*sql.Block
	for _, b := range sqlBlocks {
		if "query_embed" == b.Type { // 嵌入块不再嵌入
			// 嵌入块支持搜索 https://github.com/siyuan-note/siyuan/issues/7112
			// 这里会导致上面的 limit 限制不准确，导致结果变少，暂时没有解决方案，只能靠用户自己调整 SQL，加上 type != 'query_embed' 的条件
			continue
		}
		if !gulu.Str.Contains(b.ID, excludeIDs) {
			tmp = append(tmp, b)
		}
	}
	sqlBlocks = tmp

	// 缓存最多 128 棵语法树
	trees := map[string]*parse.Tree{}
	count := 0
	for _, sb := range sqlBlocks {
		if nil == trees[sb.RootID] {
			tree, _ := LoadTreeByBlockID(sb.RootID)
			if nil == tree {
				continue
			}
			trees[sb.RootID] = tree
			count++
		}
		if 127 < count {
			break
		}
	}

	for _, sb := range sqlBlocks {
		block, blockPaths := getEmbeddedBlock(trees, sb, headingMode, breadcrumb)
		if nil == block {
			continue
		}
		ret = append(ret, &EmbedBlock{
			Block:      block,
			BlockPaths: blockPaths,
		})
	}

	// 嵌入块支持搜索 https://github.com/siyuan-note/siyuan/issues/7112
	task.AppendTaskWithTimeout(task.DatabaseIndexEmbedBlock, 30*time.Second, updateEmbedBlockContent, embedBlockID, ret)

	// 添加笔记本名称
	var boxIDs []string
	for _, embedBlock := range ret {
		boxIDs = append(boxIDs, embedBlock.Block.Box)
	}
	boxIDs = gulu.Str.RemoveDuplicatedElem(boxIDs)
	boxNames := Conf.BoxNames(boxIDs)
	for _, embedBlock := range ret {
		name := boxNames[embedBlock.Block.Box]
		embedBlock.Block.HPath = name + embedBlock.Block.HPath
	}

	if 1 > len(ret) {
		ret = []*EmbedBlock{}
	}
	return
}

func SearchRefBlock(id, rootID, keyword string, beforeLen int, isSquareBrackets, isDatabase bool) (ret []*Block, newDoc bool) {
	cachedTrees := map[string]*parse.Tree{}
	nodeTrees := map[string]*parse.Tree{}
	var nodeIDs []string
	var nodes []*ast.Node

	onlyDoc := false
	if isSquareBrackets {
		onlyDoc = Conf.Editor.OnlySearchForDoc
	}

	if "" == keyword {
		// 查询为空时默认的块引排序规则按最近使用优先 https://github.com/siyuan-note/siyuan/issues/3218

		typeFilter := Conf.Search.TypeFilter()
		ignoreLines := getRefSearchIgnoreLines()
		refs := sql.QueryRefsRecent(onlyDoc, typeFilter, ignoreLines)
		var btsID []string
		for _, ref := range refs {
			btsID = append(btsID, ref.DefBlockRootID)
		}
		btsID = gulu.Str.RemoveDuplicatedElem(btsID)
		bts := treenode.GetBlockTrees(btsID)

		for _, ref := range refs {
			tree := cachedTrees[ref.DefBlockRootID]
			if nil == tree {
				tree, _ = loadTreeByBlockTree(bts[ref.DefBlockRootID])
			}
			if nil == tree {
				continue
			}
			cachedTrees[ref.RootID] = tree

			node := treenode.GetNodeInTree(tree, ref.DefBlockID)
			if nil == node {
				continue
			}

			nodes = append(nodes, node)
			nodeIDs = append(nodeIDs, node.ID)
			nodeTrees[node.ID] = tree
		}

		refCount := sql.QueryRefCount(nodeIDs)

		for _, node := range nodes {
			tree := nodeTrees[node.ID]
			sqlBlock := sql.BuildBlockFromNode(node, tree)
			if nil == sqlBlock {
				return
			}

			block := fromSQLBlock(sqlBlock, "", 0)
			block.RefText = getNodeRefText(node)
			block.RefText = maxContent(block.RefText, Conf.Editor.BlockRefDynamicAnchorTextMaxLen)
			block.RefCount = refCount[node.ID]
			ret = append(ret, block)
		}

		if 1 > len(ret) {
			ret = []*Block{}
		}

		prependNotebookNameInHPath(ret)
		filterSelfHPath(ret)
		return
	}

	ret = fullTextSearchRefBlock(keyword, beforeLen, onlyDoc)
	tmp := ret[:0]
	var btsID []string
	for _, b := range ret {
		btsID = append(btsID, b.RootID)
	}
	btsID = gulu.Str.RemoveDuplicatedElem(btsID)
	bts := treenode.GetBlockTrees(btsID)
	for _, b := range ret {
		tree := cachedTrees[b.RootID]
		if nil == tree {
			tree, _ = loadTreeByBlockTree(bts[b.RootID])
		}
		if nil == tree {
			continue
		}
		cachedTrees[b.RootID] = tree
		b.RefText = getBlockRefText(b.ID, tree)

		hitFirstChildID := false
		if b.IsContainerBlock() && "NodeDocument" != b.Type {
			// `((` 引用候选中排除当前块的父块 https://github.com/siyuan-note/siyuan/issues/4538
			tree = cachedTrees[b.RootID]
			if nil == tree {
				tree, _ = loadTreeByBlockTree(bts[b.RootID])
				cachedTrees[b.RootID] = tree
			}
			if nil != tree {
				bNode := treenode.GetNodeInTree(tree, b.ID)
				if fc := treenode.FirstLeafBlock(bNode); nil != fc && fc.ID == id {
					hitFirstChildID = true
				}
			}
		}

		if "NodeAttributeView" == b.Type {
			// 数据库块可以添加到自身数据库块中，当前文档也可以添加到自身数据库块中
			tmp = append(tmp, b)
			nodeIDs = append(nodeIDs, b.ID)
			nodeTrees[b.ID] = tree
		} else {
			// 排除自身块、父块和根块
			if b.ID != id && !hitFirstChildID && b.ID != rootID {
				tmp = append(tmp, b)
				nodeIDs = append(nodeIDs, b.ID)
				nodeTrees[b.ID] = tree
			}
		}

	}
	ret = tmp

	refCount := sql.QueryRefCount(nodeIDs)
	for _, b := range ret {
		b.RefCount = refCount[b.ID]
	}

	if !isDatabase {
		// 如果非数据库中搜索块引，则不允许新建重名文档
		if block := treenode.GetBlockTree(id); nil != block {
			p := path.Join(block.HPath, keyword)
			newDoc = nil == treenode.GetBlockTreeRootByHPath(block.BoxID, p)
		}
	} else { // 如果是数据库中搜索绑定块，则允许新建重名文档 https://github.com/siyuan-note/siyuan/issues/11713
		newDoc = true
	}

	prependNotebookNameInHPath(ret)
	filterSelfHPath(ret)
	return
}

func filterSelfHPath(blocks []*Block) {
	// 简化搜索结果列表中的文档块路径 Simplify document block paths in search results https://github.com/siyuan-note/siyuan/issues/13364
	// 文档块不显示自己的路径（最后一层）

	for _, b := range blocks {
		if b.IsDoc() {
			b.HPath = strings.TrimSuffix(b.HPath, path.Base(b.HPath))
		}
	}
}

func prependNotebookNameInHPath(blocks []*Block) {
	// 在 hPath 中加入笔记本名 Show notebooks in hpath of block ref search list results https://github.com/siyuan-note/siyuan/issues/9378

	var boxIDs []string
	for _, b := range blocks {
		boxIDs = append(boxIDs, b.Box)
	}
	boxIDs = gulu.Str.RemoveDuplicatedElem(boxIDs)
	boxNames := Conf.BoxNames(boxIDs)
	for _, b := range blocks {
		name := boxNames[b.Box]
		b.HPath = util.EscapeHTML(name) + b.HPath
	}
}

func FindReplace(keyword, replacement string, replaceTypes map[string]bool, ids []string, paths, boxes []string, types map[string]bool, method, orderBy, groupBy int) (err error) {
	// method：0：文本，1：查询语法，2：SQL，3：正则表达式
	if 2 == method {
		err = errors.New(Conf.Language(132))
		return
	}

	if 1 == method {
		// 将查询语法等价于关键字，因为 keyword 参数已经是结果关键字了
		// Find and replace supports query syntax https://github.com/siyuan-note/siyuan/issues/14937
		method = 0
	}

	if 0 != groupBy {
		// 按文档分组后不支持替换 Need to be reminded that replacement operations are not supported after grouping by doc https://github.com/siyuan-note/siyuan/issues/10161
		// 因为分组条件传入以后搜索只能命中文档块，会导致 全部替换 失效
		err = errors.New(Conf.Language(221))
		return
	}

	// No longer trim spaces for the keyword and replacement https://github.com/siyuan-note/siyuan/issues/9229
	if keyword == replacement {
		return
	}

	r, _ := regexp.Compile(keyword)
	escapedKey := util.EscapeHTML(keyword)
	escapedKey = strings.ReplaceAll(escapedKey, "&#34;", "&quot;")
	escapedKey = strings.ReplaceAll(escapedKey, "&#39;", "'")
	escapedR, _ := regexp.Compile(escapedKey)
	ids = gulu.Str.RemoveDuplicatedElem(ids)
	var renameRoots []*ast.Node
	renameRootTitles := map[string]string{}
	cachedTrees := map[string]*parse.Tree{}

	historyDir, err := getHistoryDir(HistoryOpReplace, time.Now())
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	if 1 > len(ids) {
		// `Replace All` is no longer affected by pagination https://github.com/siyuan-note/siyuan/issues/8265
		blocks, _, _, _, _ := FullTextSearchBlock(keyword, boxes, paths, types, method, orderBy, groupBy, 1, math.MaxInt)
		for _, block := range blocks {
			ids = append(ids, block.ID)
		}
	}

	for _, id := range ids {
		bt := treenode.GetBlockTree(id)
		if nil == bt {
			continue
		}

		tree := cachedTrees[bt.RootID]
		if nil != tree {
			continue
		}

		tree, _ = LoadTreeByBlockID(id)
		if nil == tree {
			continue
		}

		historyPath := filepath.Join(historyDir, tree.Box, tree.Path)
		if err = os.MkdirAll(filepath.Dir(historyPath), 0755); err != nil {
			logging.LogErrorf("generate history failed: %s", err)
			return
		}

		var data []byte
		if data, err = filelock.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path)); err != nil {
			logging.LogErrorf("generate history failed: %s", err)
			return
		}

		if err = gulu.File.WriteFileSafer(historyPath, data, 0644); err != nil {
			logging.LogErrorf("generate history failed: %s", err)
			return
		}

		cachedTrees[bt.RootID] = tree
	}
	indexHistoryDir(filepath.Base(historyDir), util.NewLute())

	luteEngine := util.NewLute()
	var reloadTreeIDs []string
	updateNodes := map[string]*ast.Node{}
	for i, id := range ids {
		bt := treenode.GetBlockTree(id)
		if nil == bt {
			continue
		}

		tree := cachedTrees[bt.RootID]
		if nil == tree {
			continue
		}

		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			continue
		}

		reloadTreeIDs = append(reloadTreeIDs, tree.ID)
		if ast.NodeDocument == node.Type {
			if !replaceTypes["docTitle"] {
				continue
			}

			title := node.IALAttr("title")
			tags := node.IALAttr("tags")
			if 0 == method {
				if strings.Contains(title, keyword) {
					docTitleReplacement := strings.ReplaceAll(replacement, "/", "／")
					renameRootTitles[node.ID] = strings.ReplaceAll(title, keyword, docTitleReplacement)
					renameRoots = append(renameRoots, node)
				}

				if strings.Contains(tags, keyword) {
					replacement = strings.TrimPrefix(replacement, "#")
					replacement = strings.TrimSuffix(replacement, "#")
					tags = strings.ReplaceAll(tags, keyword, replacement)
					tags = strings.ReplaceAll(tags, editor.Zwsp, "")
					node.SetIALAttr("tags", tags)
					ReloadTag()
				}
			} else if 3 == method {
				if nil != r && r.MatchString(title) {
					docTitleReplacement := strings.ReplaceAll(replacement, "/", "／")
					renameRootTitles[node.ID] = r.ReplaceAllString(title, docTitleReplacement)
					renameRoots = append(renameRoots, node)
				}

				if nil != r && r.MatchString(tags) {
					replacement = strings.TrimPrefix(replacement, "#")
					replacement = strings.TrimSuffix(replacement, "#")
					tags = r.ReplaceAllString(tags, replacement)
					tags = strings.ReplaceAll(tags, editor.Zwsp, "")
					node.SetIALAttr("tags", tags)
					ReloadTag()
				}
			}
		} else {
			var unlinks []*ast.Node
			ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}

				switch n.Type {
				case ast.NodeText:
					if !replaceTypes["text"] {
						return ast.WalkContinue
					}

					if replaceTextNode(n, method, keyword, replacement, r, luteEngine) {
						if nil != n.Parent && ast.NodeBackslash == n.Parent.Type {
							unlinks = append(unlinks, n.Parent)

							prev, next := n.Parent.Previous, n.Parent.Next
							for ; prev != nil && ((ast.NodeText == prev.Type && prev.Tokens == nil) || ast.NodeBackslash == prev.Type); prev = prev.Previous {
								// Tokens 为空的节点或者转义节点之前已经处理，需要跳过
							}
							if nil != prev && ast.NodeText == prev.Type && nil != next && ast.NodeText == next.Type {
								prev.Tokens = append(prev.Tokens, next.Tokens...)
								next.Tokens = nil // 将 Tokens 设置为空，表示该节点已经被处理过
								unlinks = append(unlinks, next)
							}
						} else {
							unlinks = append(unlinks, n)
						}
					}
				case ast.NodeLinkDest:
					if !replaceTypes["imgSrc"] {
						return ast.WalkContinue
					}

					replaceNodeTokens(n, method, keyword, strings.TrimSpace(replacement), r)
					if 1 > len(n.Tokens) {
						unlinks = append(unlinks, n.Parent)
						mergeSamePreNext(n)
					}
				case ast.NodeLinkText:
					if !replaceTypes["imgText"] {
						return ast.WalkContinue
					}

					replaceNodeTokens(n, method, keyword, replacement, r)
				case ast.NodeLinkTitle:
					if !replaceTypes["imgTitle"] {
						return ast.WalkContinue
					}

					replaceNodeTokens(n, method, keyword, replacement, r)
				case ast.NodeCodeBlockCode:
					if !replaceTypes["codeBlock"] {
						return ast.WalkContinue
					}

					replaceNodeTokens(n, method, keyword, replacement, r)
				case ast.NodeMathBlockContent:
					if !replaceTypes["mathBlock"] {
						return ast.WalkContinue
					}

					replaceNodeTokens(n, method, keyword, replacement, r)
				case ast.NodeHTMLBlock:
					if !replaceTypes["htmlBlock"] {
						return ast.WalkContinue
					}

					replaceNodeTokens(n, method, keyword, replacement, r)
				case ast.NodeTextMark:
					if n.IsTextMarkType("code") {
						if !replaceTypes["code"] {
							return ast.WalkContinue
						}

						if 0 == method {
							if strings.Contains(n.TextMarkTextContent, escapedKey) {
								n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, escapedKey, util.EscapeHTML(replacement))
							}
						} else if 3 == method {
							if nil != escapedR && escapedR.MatchString(n.TextMarkTextContent) {
								n.TextMarkTextContent = escapedR.ReplaceAllString(n.TextMarkTextContent, util.EscapeHTML(replacement))
							}
						}

						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
							mergeSamePreNext(n)
						}
					} else if n.IsTextMarkType("a") {
						if replaceTypes["aText"] {
							if 0 == method {
								content := util.UnescapeHTML(n.TextMarkTextContent)
								if strings.Contains(content, escapedKey) {
									n.TextMarkTextContent = strings.ReplaceAll(content, escapedKey, replacement)
								} else if strings.Contains(content, keyword) {
									n.TextMarkTextContent = strings.ReplaceAll(content, keyword, replacement)
								}
							} else if 3 == method {
								if nil != r && r.MatchString(n.TextMarkTextContent) {
									n.TextMarkTextContent = r.ReplaceAllString(n.TextMarkTextContent, replacement)
								}
							}
							if "" == n.TextMarkTextContent {
								unlinks = append(unlinks, n)
								mergeSamePreNext(n)
							}
						}

						if replaceTypes["aTitle"] {
							if 0 == method {
								title := util.UnescapeHTML(n.TextMarkATitle)
								if strings.Contains(title, escapedKey) {
									n.TextMarkATitle = strings.ReplaceAll(title, escapedKey, replacement)
								} else if strings.Contains(n.TextMarkATitle, keyword) {
									n.TextMarkATitle = strings.ReplaceAll(title, keyword, replacement)
								}
							} else if 3 == method {
								if nil != r && r.MatchString(n.TextMarkATitle) {
									n.TextMarkATitle = r.ReplaceAllString(n.TextMarkATitle, replacement)
								}
							}
						}

						if replaceTypes["aHref"] {
							if 0 == method {
								href := util.UnescapeHTML(n.TextMarkAHref)
								if strings.Contains(href, escapedKey) {
									n.TextMarkAHref = strings.ReplaceAll(href, escapedKey, util.EscapeHTML(replacement))
								} else if strings.Contains(href, keyword) {
									n.TextMarkAHref = strings.ReplaceAll(href, keyword, strings.TrimSpace(replacement))
								}
							} else if 3 == method {
								if nil != r && r.MatchString(n.TextMarkAHref) {
									n.TextMarkAHref = r.ReplaceAllString(n.TextMarkAHref, strings.TrimSpace(replacement))
								}
							}

							if "" == n.TextMarkAHref {
								if "" == n.TextMarkTextContent {
									unlinks = append(unlinks, n)
									mergeSamePreNext(n)
								} else {
									n.Type = ast.NodeText
									n.Tokens = []byte(n.TextMarkTextContent)
								}
							}
						}
					} else if n.IsTextMarkType("em") {
						if !replaceTypes["em"] {
							return ast.WalkContinue
						}

						replaceNodeTextMarkTextContent(n, method, keyword, escapedKey, replacement, r, "em", luteEngine)
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
							mergeSamePreNext(n)
						}
					} else if n.IsTextMarkType("strong") {
						if !replaceTypes["strong"] {
							return ast.WalkContinue
						}

						replaceNodeTextMarkTextContent(n, method, keyword, escapedKey, replacement, r, "strong", luteEngine)
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
							mergeSamePreNext(n)
						}
					} else if n.IsTextMarkType("kbd") {
						if !replaceTypes["kbd"] {
							return ast.WalkContinue
						}

						replaceNodeTextMarkTextContent(n, method, keyword, escapedKey, replacement, r, "kbd", luteEngine)
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
						}
					} else if n.IsTextMarkType("mark") {
						if !replaceTypes["mark"] {
							return ast.WalkContinue
						}

						replaceNodeTextMarkTextContent(n, method, keyword, escapedKey, replacement, r, "mark", luteEngine)
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
							mergeSamePreNext(n)
						}
					} else if n.IsTextMarkType("s") {
						if !replaceTypes["s"] {
							return ast.WalkContinue
						}

						replaceNodeTextMarkTextContent(n, method, keyword, escapedKey, replacement, r, "s", luteEngine)
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
							mergeSamePreNext(n)
						}
					} else if n.IsTextMarkType("sub") {
						if !replaceTypes["sub"] {
							return ast.WalkContinue
						}

						replaceNodeTextMarkTextContent(n, method, keyword, escapedKey, replacement, r, "sub", luteEngine)
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
						}
					} else if n.IsTextMarkType("sup") {
						if !replaceTypes["sup"] {
							return ast.WalkContinue
						}

						replaceNodeTextMarkTextContent(n, method, keyword, escapedKey, replacement, r, "sup", luteEngine)
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
						}
					} else if n.IsTextMarkType("tag") {
						if !replaceTypes["tag"] {
							return ast.WalkContinue
						}

						replaceNodeTextMarkTextContent(n, method, keyword, escapedKey, replacement, r, "tag", luteEngine)
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
						}

						ReloadTag()
					} else if n.IsTextMarkType("u") {
						if !replaceTypes["u"] {
							return ast.WalkContinue
						}

						replaceNodeTextMarkTextContent(n, method, keyword, escapedKey, replacement, r, "u", luteEngine)
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
							mergeSamePreNext(n)
						}
					} else if n.IsTextMarkType("inline-math") {
						if !replaceTypes["inlineMath"] {
							return ast.WalkContinue
						}

						if 0 == method {
							if strings.Contains(n.TextMarkInlineMathContent, keyword) {
								n.TextMarkInlineMathContent = strings.ReplaceAll(n.TextMarkInlineMathContent, keyword, replacement)
							}
						} else if 3 == method {
							if nil != r && r.MatchString(n.TextMarkInlineMathContent) {
								n.TextMarkInlineMathContent = r.ReplaceAllString(n.TextMarkInlineMathContent, replacement)
							}
						}

						if "" == n.TextMarkInlineMathContent {
							unlinks = append(unlinks, n)
						}
					} else if n.IsTextMarkType("inline-memo") {
						if !replaceTypes["inlineMemo"] {
							return ast.WalkContinue
						}

						if 0 == method {
							if strings.Contains(n.TextMarkInlineMemoContent, keyword) {
								n.TextMarkInlineMemoContent = strings.ReplaceAll(n.TextMarkInlineMemoContent, keyword, replacement)
								n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, keyword, replacement)
							}
						} else if 3 == method {
							if nil != r && r.MatchString(n.TextMarkInlineMemoContent) {
								n.TextMarkInlineMemoContent = r.ReplaceAllString(n.TextMarkInlineMemoContent, replacement)
								n.TextMarkTextContent = r.ReplaceAllString(n.TextMarkTextContent, replacement)
							}
						}

						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
						}
					} else if n.IsTextMarkType("text") {
						// Search and replace fails in some cases https://github.com/siyuan-note/siyuan/issues/10016
						if !replaceTypes["text"] {
							return ast.WalkContinue
						}

						replaceNodeTextMarkTextContent(n, method, keyword, escapedKey, replacement, r, "text", luteEngine)
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
							mergeSamePreNext(n)
						}
					} else if n.IsTextMarkType("block-ref") {
						if !replaceTypes["blockRef"] {
							return ast.WalkContinue
						}

						if 0 == method {
							if strings.Contains(n.TextMarkTextContent, keyword) {
								n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, keyword, replacement)
								n.TextMarkBlockRefSubtype = "s"
							}
						} else if 3 == method {
							if nil != r && r.MatchString(n.TextMarkTextContent) {
								n.TextMarkTextContent = r.ReplaceAllString(n.TextMarkTextContent, replacement)
								n.TextMarkBlockRefSubtype = "s"
							}
						}

						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
						}
					} else if n.IsTextMarkType("file-annotation-ref") {
						if !replaceTypes["fileAnnotationRef"] {
							return ast.WalkContinue
						}

						if 0 == method {
							if strings.Contains(n.TextMarkTextContent, keyword) {
								n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, keyword, replacement)
							}
						} else if 3 == method {
							if nil != r && r.MatchString(n.TextMarkTextContent) {
								n.TextMarkTextContent = r.ReplaceAllString(n.TextMarkTextContent, replacement)
							}
						}
						if "" == n.TextMarkTextContent {
							unlinks = append(unlinks, n)
						}
					}
				}
				return ast.WalkContinue
			})

			for _, unlink := range unlinks {
				unlink.Unlink()
			}
		}

		if err = writeTreeUpsertQueue(tree); err != nil {
			return
		}
		updateNodes[id] = node
		util.PushEndlessProgress(fmt.Sprintf(Conf.Language(206), i+1, len(ids)))
	}

	for i, renameRoot := range renameRoots {
		newTitle := renameRootTitles[renameRoot.ID]
		RenameDoc(renameRoot.Box, renameRoot.Path, newTitle)

		util.PushEndlessProgress(fmt.Sprintf(Conf.Language(207), i+1, len(renameRoots)))
	}

	sql.FlushQueue()

	reloadTreeIDs = gulu.Str.RemoveDuplicatedElem(reloadTreeIDs)
	for _, id := range reloadTreeIDs {
		ReloadProtyle(id)
	}

	updateAttributeViewBlockText(updateNodes)

	sql.FlushQueue()
	util.PushClearProgress()
	return
}

func replaceNodeTextMarkTextContent(n *ast.Node, method int, keyword, escapedKey string, replacement string, r *regexp.Regexp, typ string, luteEngine *lute.Lute) {
	if 0 == method {
		if strings.Contains(typ, "tag") {
			keyword = strings.TrimPrefix(keyword, "#")
			keyword = strings.TrimSuffix(keyword, "#")
			escapedKey = strings.TrimPrefix(escapedKey, "#")
			escapedKey = strings.TrimSuffix(escapedKey, "#")
			if strings.HasPrefix(replacement, "#") && strings.HasSuffix(replacement, "#") {
				replacement = strings.TrimPrefix(replacement, "#")
				replacement = strings.TrimSuffix(replacement, "#")
			} else if n.TextMarkTextContent == keyword || n.TextMarkTextContent == escapedKey {
				// 将标签转换为纯文本

				if "tag" == n.TextMarkType { // 没有其他类型，仅是标签时直接转换
					content := n.TextMarkTextContent
					if strings.Contains(content, escapedKey) {
						content = strings.ReplaceAll(content, escapedKey, replacement)
					} else if strings.Contains(content, keyword) {
						content = strings.ReplaceAll(content, keyword, replacement)
					}
					content = strings.ReplaceAll(content, editor.Zwsp, "")

					tree := parse.Inline("", []byte(content), luteEngine.ParseOptions)
					if nil == tree.Root.FirstChild {
						return
					}
					parse.NestedInlines2FlattedSpans(tree, false)

					var replaceNodes []*ast.Node
					for rNode := tree.Root.FirstChild.FirstChild; nil != rNode; rNode = rNode.Next {
						replaceNodes = append(replaceNodes, rNode)
						if blockRefID, _, _ := treenode.GetBlockRef(rNode); "" != blockRefID {
							task.AppendAsyncTaskWithDelay(task.SetDefRefCount, util.SQLFlushInterval, refreshRefCount, blockRefID)
						}
					}

					for _, rNode := range replaceNodes {
						n.InsertBefore(rNode)
					}
					n.TextMarkTextContent = ""
					return
				}

				// 存在其他类型时仅移除标签类型
				n.TextMarkType = strings.ReplaceAll(n.TextMarkType, "tag", "")
				n.TextMarkType = strings.TrimSpace(n.TextMarkType)
			} else if strings.Contains(n.TextMarkTextContent, keyword) || strings.Contains(n.TextMarkTextContent, escapedKey) { // 标签包含了部分关键字的情况
				if "tag" == n.TextMarkType { // 没有其他类型，仅是标签时保持标签类型不变，仅替换标签部分内容
					content := n.TextMarkTextContent
					if strings.Contains(content, escapedKey) {
						content = strings.ReplaceAll(content, escapedKey, replacement)
					} else if strings.Contains(content, keyword) {
						content = strings.ReplaceAll(content, keyword, replacement)
					}
					content = strings.ReplaceAll(content, editor.Zwsp, "")
					n.TextMarkTextContent = content
					return
				}
			}
		}

		if strings.Contains(n.TextMarkTextContent, escapedKey) {
			n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, escapedKey, util.EscapeHTML(replacement))
		} else if strings.Contains(n.TextMarkTextContent, keyword) {
			n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, keyword, replacement)
		}
		n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, editor.Zwsp, "")
	} else if 3 == method {
		if nil != r && r.MatchString(n.TextMarkTextContent) {
			n.TextMarkTextContent = r.ReplaceAllString(n.TextMarkTextContent, replacement)
		}
		n.TextMarkTextContent = strings.ReplaceAll(n.TextMarkTextContent, editor.Zwsp, "")
	}
}

// replaceTextNode 替换文本节点为其他节点。
// Supports replacing text elements with other elements https://github.com/siyuan-note/siyuan/issues/11058
func replaceTextNode(text *ast.Node, method int, keyword string, replacement string, r *regexp.Regexp, luteEngine *lute.Lute) bool {
	if 0 == method {
		newContent := text.Tokens
		if Conf.Search.CaseSensitive {
			if bytes.Contains(text.Tokens, []byte(keyword)) {
				newContent = bytes.ReplaceAll(text.Tokens, []byte(keyword), []byte(replacement))
			}
		} else {
			if "" != strings.TrimSpace(keyword) {
				// 当搜索结果中的文本元素包含大小写混合时替换失败
				// Replace fails when search results contain mixed case in text elements https://github.com/siyuan-note/siyuan/issues/9171
				keywords := strings.Split(keyword, " ")
				// keyword 可能是 "foo Foo" 使用空格分隔的大小写命中情况，这里统一转换小写后去重
				if 0 < len(keywords) {
					var lowerKeywords []string
					for _, k := range keywords {
						lowerKeywords = append(lowerKeywords, strings.ToLower(k))
					}
					keyword = strings.Join(lowerKeywords, " ")
				}
			}

			if bytes.Contains(bytes.ToLower(text.Tokens), []byte(keyword)) {
				newContent = replaceCaseInsensitive(text.Tokens, []byte(keyword), []byte(replacement))
			}
		}
		if !bytes.Equal(newContent, text.Tokens) {
			tree := parse.Inline("", newContent, luteEngine.ParseOptions)
			if nil == tree.Root.FirstChild {
				return false
			}
			parse.NestedInlines2FlattedSpans(tree, false)

			var replaceNodes []*ast.Node
			for rNode := tree.Root.FirstChild.FirstChild; nil != rNode; rNode = rNode.Next {
				replaceNodes = append(replaceNodes, rNode)
			}

			for _, rNode := range replaceNodes {
				text.InsertBefore(rNode)
			}
			return true
		}
	} else if 3 == method {
		if nil != r && r.MatchString(string(text.Tokens)) {
			newContent := []byte(r.ReplaceAllString(string(text.Tokens), replacement))
			tree := parse.Inline("", newContent, luteEngine.ParseOptions)
			if nil == tree.Root.FirstChild {
				return false
			}

			var replaceNodes []*ast.Node
			for rNode := tree.Root.FirstChild.FirstChild; nil != rNode; rNode = rNode.Next {
				replaceNodes = append(replaceNodes, rNode)
			}

			for _, rNode := range replaceNodes {
				text.InsertBefore(rNode)
			}
			return true
		}
	}
	return false
}

func replaceNodeTokens(n *ast.Node, method int, keyword string, replacement string, r *regexp.Regexp) {
	if 0 == method {
		if bytes.Contains(n.Tokens, []byte(keyword)) {
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte(keyword), []byte(replacement))
		}
	} else if 3 == method {
		if nil != r && r.MatchString(string(n.Tokens)) {
			n.Tokens = []byte(r.ReplaceAllString(string(n.Tokens), replacement))
		}
	}
}

func mergeSamePreNext(n *ast.Node) {
	prev, next := n.Previous, n.Next
	if nil != n.Parent && ast.NodeImage == n.Parent.Type {
		prev = n.Parent.Previous
		next = n.Parent.Next
	}

	if nil == prev || nil == next || prev.Type != next.Type || ast.NodeKramdownSpanIAL == prev.Type {
		return
	}

	switch prev.Type {
	case ast.NodeText:
		prev.Tokens = append(prev.Tokens, next.Tokens...)
		next.Unlink()
	case ast.NodeTextMark:
		if prev.TextMarkType != next.TextMarkType {
			break
		}

		switch prev.TextMarkType {
		case "em", "strong", "mark", "s", "u", "text":
			prev.TextMarkTextContent += next.TextMarkTextContent
			next.Unlink()
		}
	}
}

// FullTextSearchBlock 搜索内容块。
//
// method：0：关键字，1：查询语法，2：SQL，3：正则表达式
// orderBy: 0：按块类型（默认），1：按创建时间升序，2：按创建时间降序，3：按更新时间升序，4：按更新时间降序，5：按内容顺序（仅在按文档分组时），6：按相关度升序，7：按相关度降序
// groupBy：0：不分组，1：按文档分组
func FullTextSearchBlock(query string, boxes, paths []string, types map[string]bool, method, orderBy, groupBy, page, pageSize int) (ret []*Block, matchedBlockCount, matchedRootCount, pageCount int, docMode bool) {
	ret = []*Block{}
	if "" == query {
		return
	}

	query = filterQueryInvisibleChars(query)
	var ignoreFilter string
	if ignoreLines := getSearchIgnoreLines(); 0 < len(ignoreLines) {
		// Support ignore search results https://github.com/siyuan-note/siyuan/issues/10089
		buf := bytes.Buffer{}
		for _, line := range ignoreLines {
			buf.WriteString(" AND ")
			buf.WriteString(line)
		}
		ignoreFilter += buf.String()
	}

	beforeLen := 36
	var blocks []*Block
	orderByClause := buildOrderBy(query, method, orderBy)
	switch method {
	case 1: // 查询语法
		typeFilter := buildTypeFilter(types)
		boxFilter := buildBoxesFilter(boxes)
		pathFilter := buildPathsFilter(paths)
		if ast.IsNodeIDPattern(query) {
			blocks, matchedBlockCount, matchedRootCount = searchBySQL("SELECT * FROM `blocks` WHERE `id` = '"+query+"'", beforeLen, page, pageSize)
		} else {
			blocks, matchedBlockCount, matchedRootCount = fullTextSearchByFTS(query, boxFilter, pathFilter, typeFilter, ignoreFilter, orderByClause, beforeLen, page, pageSize)
		}
	case 2: // SQL
		blocks, matchedBlockCount, matchedRootCount = searchBySQL(query, beforeLen, page, pageSize)
	case 3: // 正则表达式
		typeFilter := buildTypeFilter(types)
		boxFilter := buildBoxesFilter(boxes)
		pathFilter := buildPathsFilter(paths)
		blocks, matchedBlockCount, matchedRootCount = fullTextSearchByRegexp(query, boxFilter, pathFilter, typeFilter, ignoreFilter, orderByClause, beforeLen, page, pageSize)
	default: // 关键字
		typeFilter := buildTypeFilter(types)
		boxFilter := buildBoxesFilter(boxes)
		pathFilter := buildPathsFilter(paths)
		if ast.IsNodeIDPattern(query) {
			blocks, matchedBlockCount, matchedRootCount = searchBySQL("SELECT * FROM `blocks` WHERE `id` = '"+query+"'", beforeLen, page, pageSize)
		} else {
			if 2 > len(strings.Split(strings.TrimSpace(query), " ")) {
				query = stringQuery(query)
				blocks, matchedBlockCount, matchedRootCount = fullTextSearchByFTS(query, boxFilter, pathFilter, typeFilter, ignoreFilter, orderByClause, beforeLen, page, pageSize)
			} else {
				docMode = true // 文档全文搜索模式 https://github.com/siyuan-note/siyuan/issues/10584
				blocks, matchedBlockCount, matchedRootCount = fullTextSearchByLikeWithRoot(query, boxFilter, pathFilter, typeFilter, ignoreFilter, orderByClause, beforeLen, page, pageSize)
			}
		}
	}
	pageCount = (matchedBlockCount + pageSize - 1) / pageSize

	switch groupBy {
	case 0: // 不分组
		ret = blocks
	case 1: // 按文档分组
		rootMap := map[string]bool{}
		var rootIDs []string
		contentSorts := map[string]int{}
		var btsID []string
		for _, b := range blocks {
			btsID = append(btsID, b.RootID)
		}
		btsID = gulu.Str.RemoveDuplicatedElem(btsID)
		bts := treenode.GetBlockTrees(btsID)
		for _, b := range blocks {
			if _, ok := rootMap[b.RootID]; !ok {
				rootMap[b.RootID] = true
				rootIDs = append(rootIDs, b.RootID)
				tree, _ := loadTreeByBlockTree(bts[b.RootID])
				if nil == tree {
					continue
				}

				if 5 == orderBy { // 按内容顺序（仅在按文档分组时）
					sortVal := 0
					ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
						if !entering || !n.IsBlock() {
							return ast.WalkContinue
						}

						contentSorts[n.ID] = sortVal
						sortVal++
						return ast.WalkContinue
					})
				}
			}
		}

		sqlRoots := sql.GetBlocks(rootIDs)
		roots := fromSQLBlocks(&sqlRoots, "", beforeLen)
		for _, root := range roots {
			for _, b := range blocks {
				if 5 == orderBy { // 按内容顺序（仅在按文档分组时）
					b.Sort = contentSorts[b.ID]
				}
				if b.RootID == root.ID {
					root.Children = append(root.Children, b)
				}
			}

			switch orderBy {
			case 1: //按创建时间升序
				sort.Slice(root.Children, func(i, j int) bool { return root.Children[i].Created < root.Children[j].Created })
			case 2: // 按创建时间降序
				sort.Slice(root.Children, func(i, j int) bool { return root.Children[i].Created > root.Children[j].Created })
			case 3: // 按更新时间升序
				sort.Slice(root.Children, func(i, j int) bool { return root.Children[i].Updated < root.Children[j].Updated })
			case 4: // 按更新时间降序
				sort.Slice(root.Children, func(i, j int) bool { return root.Children[i].Updated > root.Children[j].Updated })
			case 5: // 按内容顺序（仅在按文档分组时）
				sort.Slice(root.Children, func(i, j int) bool { return root.Children[i].Sort < root.Children[j].Sort })
			default: // 按块类型（默认）
				sort.Slice(root.Children, func(i, j int) bool { return root.Children[i].Sort < root.Children[j].Sort })
			}
		}

		switch orderBy {
		case 1: //按创建时间升序
			sort.Slice(roots, func(i, j int) bool { return roots[i].Created < roots[j].Created })
		case 2: // 按创建时间降序
			sort.Slice(roots, func(i, j int) bool { return roots[i].Created > roots[j].Created })
		case 3: // 按更新时间升序
			sort.Slice(roots, func(i, j int) bool { return roots[i].Updated < roots[j].Updated })
		case 4: // 按更新时间降序
			sort.Slice(roots, func(i, j int) bool { return roots[i].Updated > roots[j].Updated })
		case 5: // 按内容顺序（仅在按文档分组时）
			// 都是文档，按更新时间降序
			sort.Slice(roots, func(i, j int) bool { return roots[i].IAL["updated"] > roots[j].IAL["updated"] })
		case 6, 7: // 按相关度
		// 已在 ORDER BY 中处理
		default: // 按块类型（默认）
			// 都是文档，不需要再次排序
		}
		ret = roots
	default:
		ret = blocks
	}
	if 1 > len(ret) {
		ret = []*Block{}
	}

	if 0 == groupBy {
		filterSelfHPath(ret)
	}

	var nodeIDs []string
	for _, b := range ret {
		if 0 == groupBy {
			nodeIDs = append(nodeIDs, b.ID)
		} else {
			for _, c := range b.Children {
				nodeIDs = append(nodeIDs, c.ID)
			}
		}
	}

	refCount := sql.QueryRefCount(nodeIDs)
	for _, b := range ret {
		if 0 == groupBy {
			b.RefCount = refCount[b.ID]
		} else {
			for _, c := range b.Children {
				c.RefCount = refCount[c.ID]
			}
		}
	}
	return
}

func buildBoxesFilter(boxes []string) string {
	if 0 == len(boxes) {
		return ""
	}
	builder := bytes.Buffer{}
	builder.WriteString(" AND (")
	for i, box := range boxes {
		builder.WriteString(fmt.Sprintf("box = '%s'", box))
		if i < len(boxes)-1 {
			builder.WriteString(" OR ")
		}
	}
	builder.WriteString(")")
	return builder.String()
}

func buildPathsFilter(paths []string) string {
	if 0 == len(paths) {
		return ""
	}
	builder := bytes.Buffer{}
	builder.WriteString(" AND (")
	for i, path := range paths {
		builder.WriteString(fmt.Sprintf("path LIKE '%s%%'", path))
		if i < len(paths)-1 {
			builder.WriteString(" OR ")
		}
	}
	builder.WriteString(")")
	return builder.String()
}

func buildOrderBy(query string, method, orderBy int) string {
	switch orderBy {
	case 1:
		return "ORDER BY created ASC"
	case 2:
		return "ORDER BY created DESC"
	case 3:
		return "ORDER BY updated ASC"
	case 4:
		return "ORDER BY updated DESC"
	case 6:
		if 0 != method && 1 != method {
			// 只有关键字搜索和查询语法搜索才支持按相关度升序 https://github.com/siyuan-note/siyuan/issues/7861
			return "ORDER BY sort DESC, updated DESC"
		}
		return "ORDER BY rank DESC" // 默认是按相关度降序，所以按相关度升序要反过来使用 DESC
	case 7:
		if 0 != method && 1 != method {
			return "ORDER BY sort ASC, updated DESC"
		}
		return "ORDER BY rank" // 默认是按相关度降序
	default:
		clause := "ORDER BY CASE " +
			"WHEN name = '${keyword}' THEN 10 " +
			"WHEN alias = '${keyword}' THEN 20 " +
			"WHEN name LIKE '%${keyword}%' THEN 50 " +
			"WHEN alias LIKE '%${keyword}%' THEN 60 " +
			"ELSE 65535 END ASC, sort ASC, updated DESC"
		clause = strings.ReplaceAll(clause, "${keyword}", strings.ReplaceAll(query, "'", "''"))
		return clause
	}
}

func buildTypeFilter(types map[string]bool) string {
	s := conf.NewSearch()
	if err := copier.Copy(s, Conf.Search); err != nil {
		logging.LogErrorf("copy search conf failed: %s", err)
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
		s.EmbedBlock = types["embedBlock"]
		s.DatabaseBlock = types["databaseBlock"]
		s.AudioBlock = types["audioBlock"]
		s.VideoBlock = types["videoBlock"]
		s.IFrameBlock = types["iframeBlock"]
		s.WidgetBlock = types["widgetBlock"]
		s.Callout = types["callout"]
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
		s.EmbedBlock = Conf.Search.EmbedBlock
		s.DatabaseBlock = Conf.Search.DatabaseBlock
		s.AudioBlock = Conf.Search.AudioBlock
		s.VideoBlock = Conf.Search.VideoBlock
		s.IFrameBlock = Conf.Search.IFrameBlock
		s.WidgetBlock = Conf.Search.WidgetBlock
		s.Callout = Conf.Search.Callout
	}
	return s.TypeFilter()
}

func searchBySQL(stmt string, beforeLen, page, pageSize int) (ret []*Block, matchedBlockCount, matchedRootCount int) {
	stmt = strings.TrimSpace(stmt)
	blocks := sql.SelectBlocksRawStmt(stmt, page, pageSize)
	ret = fromSQLBlocks(&blocks, "", beforeLen)
	if 1 > len(ret) {
		ret = []*Block{}
		return
	}

	stmt = strings.ToLower(stmt)
	stdQuery := !strings.Contains(stmt, "with recursive") && !strings.Contains(stmt, "union")
	if stdQuery {
		if strings.HasPrefix(stmt, "select a.* ") { // 多个搜索关键字匹配文档 https://github.com/siyuan-note/siyuan/issues/7350
			stmt = strings.ReplaceAll(stmt, "select a.* ", "select COUNT(a.id) AS `matches`, COUNT(DISTINCT(a.root_id)) AS `docs` ")
		} else {
			stmt = strings.ReplaceAll(stmt, "select * ", "select COUNT(id) AS `matches`, COUNT(DISTINCT(root_id)) AS `docs` ")
		}
	}
	stmt = removeLimitClause(stmt)
	result, _ := sql.QueryNoLimit(stmt)
	if 1 > len(result) {
		return
	}

	if !stdQuery {
		var rootIDs, blockIDs []string
		for _, queryResult := range result {
			rootIDs = append(rootIDs, queryResult["root_id"].(string))
			blockIDs = append(blockIDs, queryResult["id"].(string))
		}
		rootIDs = gulu.Str.RemoveDuplicatedElem(rootIDs)
		blockIDs = gulu.Str.RemoveDuplicatedElem(blockIDs)
		matchedRootCount = len(rootIDs)
		matchedBlockCount = len(blockIDs)
	} else {
		matchedBlockCount = int(result[0]["matches"].(int64))
		matchedRootCount = int(result[0]["docs"].(int64))
	}
	return
}

func removeLimitClause(stmt string) string {
	parsedStmt, err := sqlparser.Parse(stmt)
	if err != nil {
		return stmt
	}

	switch parsedStmt.(type) {
	case *sqlparser.Select:
		slct := parsedStmt.(*sqlparser.Select)
		if nil != slct.Limit {
			slct.Limit = nil
		}
		stmt = sqlparser.String(slct)
	}
	return stmt
}

func fullTextSearchRefBlock(keyword string, beforeLen int, onlyDoc bool) (ret []*Block) {
	keyword = filterQueryInvisibleChars(keyword)

	if id := extractID(keyword); "" != id {
		ret, _, _ = searchBySQL("SELECT * FROM `blocks` WHERE `id` = '"+id+"'", 36, 1, 32)
		return
	}

	quotedKeyword := stringQuery(keyword)
	table := "blocks_fts" // 大小写敏感
	if !Conf.Search.CaseSensitive {
		table = "blocks_fts_case_insensitive"
	}

	projections := "id, parent_id, root_id, hash, box, path, " +
		"snippet(" + table + ", 6, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 64) AS hpath, " +
		"snippet(" + table + ", 7, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 64) AS name, " +
		"snippet(" + table + ", 8, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 64) AS alias, " +
		"snippet(" + table + ", 9, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 64) AS memo, " +
		"snippet(" + table + ", 10, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 64) AS tag, " +
		"snippet(" + table + ", 11, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 64) AS content, " +
		"fcontent, markdown, length, type, subtype, ial, sort, created, updated"
	stmt := "SELECT " + projections + " FROM " + table + " WHERE " + table + " MATCH '" + columnFilter() + ":(" + quotedKeyword + ")' AND type"
	if onlyDoc {
		stmt += " = 'd'"
	} else {
		stmt += " IN " + Conf.Search.TypeFilter()
	}

	if ignoreLines := getRefSearchIgnoreLines(); 0 < len(ignoreLines) {
		// Support ignore search results https://github.com/siyuan-note/siyuan/issues/10089
		buf := bytes.Buffer{}
		for _, line := range ignoreLines {
			buf.WriteString(" AND ")
			buf.WriteString(line)
		}
		stmt += buf.String()
	}

	orderBy := ` ORDER BY CASE
             WHEN name = '${keyword}' THEN 10
             WHEN alias = '${keyword}' THEN 20
             WHEN memo = '${keyword}' THEN 30
             WHEN content = '${keyword}' and type = 'd' THEN 40
             WHEN content LIKE '%${keyword}%' and type = 'd' THEN 41
             WHEN name LIKE '%${keyword}%' THEN 50
             WHEN alias LIKE '%${keyword}%' THEN 60
             WHEN content = '${keyword}' and type = 'h' THEN 70
             WHEN content LIKE '%${keyword}%' and type = 'h' THEN 71
             WHEN fcontent = '${keyword}' and type = 'i' THEN 80
             WHEN fcontent LIKE '%${keyword}%' and type = 'i' THEN 81
             WHEN memo LIKE '%${keyword}%' THEN 90
             WHEN content LIKE '%${keyword}%' and type != 'i' and type != 'l' THEN 100
             ELSE 65535 END ASC, sort ASC, length ASC`
	orderBy = strings.ReplaceAll(orderBy, "${keyword}", strings.ReplaceAll(keyword, "'", "''"))
	stmt += orderBy + " LIMIT " + strconv.Itoa(Conf.Search.Limit)
	blocks := sql.SelectBlocksRawStmtNoParse(stmt, Conf.Search.Limit)
	ret = fromSQLBlocks(&blocks, "", beforeLen)
	if 1 > len(ret) {
		ret = []*Block{}
	}
	return
}

func extractID(content string) (ret string) {
	// Improve block ref search ID extraction https://github.com/siyuan-note/siyuan/issues/10848

	if 22 > len(content) {
		return
	}

	// 从第一个字符开始循环，直到找到一个合法的 ID 为止
	for i := 0; i < len(content)-21; i++ {
		if ast.IsNodeIDPattern(content[i : i+22]) {
			ret = content[i : i+22]
			return
		}
	}
	return
}

func fullTextSearchByRegexp(exp, boxFilter, pathFilter, typeFilter, ignoreFilter, orderBy string, beforeLen, page, pageSize int) (ret []*Block, matchedBlockCount, matchedRootCount int) {
	fieldFilter := fieldRegexp(exp)
	stmt := "SELECT * FROM `blocks` WHERE " + fieldFilter + " AND type IN " + typeFilter
	stmt += boxFilter + pathFilter + ignoreFilter + " " + orderBy
	regex, err := regexp.Compile(exp)
	if nil != err {
		util.PushErrMsg(err.Error(), 5000)
		return
	}

	blocks := sql.SelectBlocksRegex(stmt, regex, Conf.Search.Name, Conf.Search.Alias, Conf.Search.Memo, Conf.Search.IAL, page, pageSize)
	ret = fromSQLBlocks(&blocks, "", beforeLen)
	if 1 > len(ret) {
		ret = []*Block{}
	}

	matchedBlockCount, matchedRootCount = fullTextSearchCountByRegexp(exp, boxFilter, pathFilter, typeFilter, ignoreFilter)
	return
}

func fullTextSearchCountByRegexp(exp, boxFilter, pathFilter, typeFilter, ignoreFilter string) (matchedBlockCount, matchedRootCount int) {
	fieldFilter := fieldRegexp(exp)
	stmt := "SELECT COUNT(id) AS `matches`, COUNT(DISTINCT(root_id)) AS `docs` FROM `blocks` WHERE " + fieldFilter + " AND type IN " + typeFilter + ignoreFilter
	stmt += boxFilter + pathFilter
	result, _ := sql.QueryNoLimit(stmt)
	if 1 > len(result) {
		return
	}
	matchedBlockCount = int(result[0]["matches"].(int64))
	matchedRootCount = int(result[0]["docs"].(int64))
	return
}

func fullTextSearchByFTS(query, boxFilter, pathFilter, typeFilter, ignoreFilter, orderBy string, beforeLen, page, pageSize int) (ret []*Block, matchedBlockCount, matchedRootCount int) {
	table := "blocks_fts" // 大小写敏感
	if !Conf.Search.CaseSensitive {
		table = "blocks_fts_case_insensitive"
	}
	projections := "id, parent_id, root_id, hash, box, path, " +
		// Search result content snippet returns more text https://github.com/siyuan-note/siyuan/issues/10707
		"snippet(" + table + ", 6, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 512) AS hpath, " +
		"snippet(" + table + ", 7, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 512) AS name, " +
		"snippet(" + table + ", 8, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 512) AS alias, " +
		"snippet(" + table + ", 9, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 512) AS memo, " +
		"snippet(" + table + ", 10, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 64) AS tag, " +
		"snippet(" + table + ", 11, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "', '...', 512) AS content, " +
		"fcontent, markdown, length, type, subtype, ial, sort, created, updated"
	stmt := "SELECT " + projections + " FROM " + table + " WHERE (`" + table + "` MATCH '" + columnFilter() + ":(" + query + ")'"
	stmt += ") AND type IN " + typeFilter
	stmt += boxFilter + pathFilter + ignoreFilter + " " + orderBy
	stmt += " LIMIT " + strconv.Itoa(pageSize) + " OFFSET " + strconv.Itoa((page-1)*pageSize)
	blocks := sql.SelectBlocksRawStmt(stmt, page, pageSize)
	ret = fromSQLBlocks(&blocks, "", beforeLen)
	if 1 > len(ret) {
		ret = []*Block{}
	}

	matchedBlockCount, matchedRootCount = fullTextSearchCountByFTS(query, boxFilter, pathFilter, typeFilter, ignoreFilter)
	return
}

func fullTextSearchCountByFTS(query, boxFilter, pathFilter, typeFilter, ignoreFilter string) (matchedBlockCount, matchedRootCount int) {
	table := "blocks_fts" // 大小写敏感
	if !Conf.Search.CaseSensitive {
		table = "blocks_fts_case_insensitive"
	}

	stmt := "SELECT COUNT(id) AS `matches`, COUNT(DISTINCT(root_id)) AS `docs` FROM `" + table + "` WHERE (`" + table + "` MATCH '" + columnFilter() + ":(" + query + ")'"
	stmt += ") AND type IN " + typeFilter
	stmt += boxFilter + pathFilter + ignoreFilter
	result, _ := sql.QueryNoLimit(stmt)
	if 1 > len(result) {
		return
	}
	matchedBlockCount = int(result[0]["matches"].(int64))
	matchedRootCount = int(result[0]["docs"].(int64))
	return
}

func fullTextSearchByLikeWithRoot(query, boxFilter, pathFilter, typeFilter, ignoreFilter, orderBy string, beforeLen, page, pageSize int) (ret []*Block, matchedBlockCount, matchedRootCount int) {
	query = strings.ReplaceAll(query, "'", "''") // 不需要转义双引号，因为条件都是通过单引号包裹的，只需要转义单引号即可
	keywords := strings.Split(query, " ")
	contentField := columnConcat()
	var likeFilter string
	orderByLike := "("
	for i, keyword := range keywords {
		likeFilter += "GROUP_CONCAT(" + contentField + ") LIKE '%" + keyword + "%'"
		orderByLike += "(docContent LIKE '%" + keyword + "%')"
		if i < len(keywords)-1 {
			likeFilter += " AND "
			orderByLike += " + "
		}
	}
	orderByLike += ")"
	dMatchStmt := "SELECT root_id, MAX(CASE WHEN type = 'd' THEN (" + contentField + ") END) AS docContent" +
		" FROM blocks WHERE type IN " + typeFilter + boxFilter + pathFilter + ignoreFilter +
		" GROUP BY root_id HAVING " + likeFilter + "ORDER BY " + orderByLike + " DESC, MAX(updated) DESC"
	cteStmt := "WITH docBlocks AS (" + dMatchStmt + ")"
	likeFilter = strings.ReplaceAll(likeFilter, "GROUP_CONCAT("+contentField+")", "concatContent")
	limit := " LIMIT " + strconv.Itoa(pageSize) + " OFFSET " + strconv.Itoa((page-1)*pageSize)
	selectStmt := cteStmt + "\nSELECT *, " +
		"(" + contentField + ") AS concatContent, " +
		"(SELECT COUNT(root_id) FROM docBlocks) AS docs, " +
		"(CASE WHEN (root_id IN (SELECT root_id FROM docBlocks) AND (" + strings.ReplaceAll(likeFilter, "concatContent", contentField) + ")) THEN 1 ELSE 0 END) AS blockSort" +
		" FROM blocks WHERE type IN " + typeFilter + boxFilter + pathFilter + ignoreFilter +
		" AND (id IN (SELECT root_id FROM docBlocks " + limit + ") OR" +
		"  (root_id IN (SELECT root_id FROM docBlocks" + limit + ") AND (" + likeFilter + ")))"
	if strings.Contains(orderBy, "ORDER BY rank DESC") {
		orderBy = buildOrderBy(query, 0, 0)
		selectStmt += " " + strings.Replace(orderBy, "END ASC, ", "END ASC, blockSort ASC, ", 1)
	} else if strings.Contains(orderBy, "ORDER BY rank") {
		orderBy = buildOrderBy(query, 0, 0)
		selectStmt += " " + strings.Replace(orderBy, "END ASC, ", "END ASC, blockSort DESC, ", 1)
	} else if strings.Contains(orderBy, "sort ASC") {
		selectStmt += " " + strings.Replace(orderBy, "END ASC, ", "END ASC, blockSort DESC, ", 1)
	} else {
		selectStmt += " " + orderBy
	}
	result, _ := sql.QueryNoLimit(selectStmt)
	resultBlocks := sql.ToBlocks(result)
	if 0 < len(resultBlocks) {
		matchedRootCount = int(result[0]["docs"].(int64))
		matchedBlockCount = matchedRootCount
	}

	keywords = gulu.Str.RemoveDuplicatedElem(keywords)
	terms := strings.Join(keywords, search.TermSep)
	terms = strings.ReplaceAll(terms, "''", "'")
	ret = fromSQLBlocks(&resultBlocks, terms, beforeLen)
	if 1 > len(ret) {
		ret = []*Block{}
	}
	return
}

func highlightByFTS(query, typeFilter, id string) (ret []string) {
	query = strings.ReplaceAll(query, " ", " OR ")
	const limit = 256
	table := "blocks_fts"
	if !Conf.Search.CaseSensitive {
		table = "blocks_fts_case_insensitive"
	}
	projections := "id, parent_id, root_id, hash, box, path, " +
		"highlight(" + table + ", 6, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "') AS hpath, " +
		"highlight(" + table + ", 7, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "') AS name, " +
		"highlight(" + table + ", 8, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "') AS alias, " +
		"highlight(" + table + ", 9, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "') AS memo, " +
		"highlight(" + table + ", 10, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "') AS tag, " +
		"highlight(" + table + ", 11, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "') AS content, " +
		"fcontent, markdown, length, type, subtype, " +
		"highlight(" + table + ", 17, '" + search.SearchMarkLeft + "', '" + search.SearchMarkRight + "') AS ial, " +
		"sort, created, updated"
	stmt := "SELECT " + projections + " FROM " + table + " WHERE (`" + table + "` MATCH '" + columnFilter() + ":(" + query + ")'"
	stmt += ") AND type IN " + typeFilter
	stmt += " AND root_id = '" + id + "'"
	stmt += " LIMIT " + strconv.Itoa(limit)
	sqlBlocks := sql.SelectBlocksRawStmt(stmt, 1, limit)
	for _, block := range sqlBlocks {
		keyword := gulu.Str.SubstringsBetween(block.HPath, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.Name, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.Alias, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.Memo, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.Tag, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.IAL, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.Content, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func highlightByRegexp(query, typeFilter, id string) (ret []string) {
	fieldFilter := fieldRegexp(query)
	stmt := "SELECT * FROM `blocks` WHERE " + fieldFilter + " AND type IN " + typeFilter
	stmt += " AND root_id = '" + id + "'"
	regex, _ := regexp.Compile(query)
	if nil == regex {
		return
	}
	sqlBlocks := sql.SelectBlocksRegex(stmt, regex, Conf.Search.Name, Conf.Search.Alias, Conf.Search.Memo, Conf.Search.IAL, 1, 256)
	for _, block := range sqlBlocks {
		keyword := gulu.Str.SubstringsBetween(block.HPath, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.Name, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.Alias, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.Memo, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.Tag, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
		keyword = gulu.Str.SubstringsBetween(block.Content, search.SearchMarkLeft, search.SearchMarkRight)
		if 0 < len(keyword) {
			ret = append(ret, keyword...)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func markSearch(text string, keyword string, beforeLen int) (marked string, score float64) {
	if 0 == len(keyword) {
		if strings.Contains(text, search.SearchMarkLeft) { // 使用 FTS snippet() 处理过高亮片段，这里简单替换后就返回
			marked = util.EscapeHTML(text)
			marked = strings.ReplaceAll(marked, search.SearchMarkLeft, "<mark>")
			marked = strings.ReplaceAll(marked, search.SearchMarkRight, "</mark>")
			return
		}

		keywords := gulu.Str.SubstringsBetween(text, search.SearchMarkLeft, search.SearchMarkRight)
		keywords = gulu.Str.RemoveDuplicatedElem(keywords)
		keyword = strings.Join(keywords, search.TermSep)
		marked = strings.ReplaceAll(text, search.SearchMarkLeft, "")
		marked = strings.ReplaceAll(marked, search.SearchMarkRight, "")
		_, marked = search.MarkText(marked, keyword, beforeLen, Conf.Search.CaseSensitive)
		marked = util.EscapeHTML(marked)
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
	if 1 < strings.Count(content, search.SearchMarkRight) && strings.HasSuffix(content, search.SearchMarkRight+"...") {
		// 返回多个关键字命中时需要检查最后一个关键字是否被截断
		firstKeyword := gulu.Str.SubStringBetween(content, search.SearchMarkLeft, search.SearchMarkRight)
		lastKeyword := gulu.Str.LastSubStringBetween(content, search.SearchMarkLeft, search.SearchMarkRight)
		if firstKeyword != lastKeyword {
			// 如果第一个关键字和最后一个关键字不相同，说明最后一个关键字被截断了
			// 此时需要将 content 中的最后一个关键字替换为完整的关键字
			content = strings.TrimSuffix(content, search.SearchMarkLeft+lastKeyword+search.SearchMarkRight+"...")
			content += search.SearchMarkLeft + firstKeyword + search.SearchMarkRight + "..."
		}
	}

	content, _ = markSearch(content, terms, beforeLen)
	content = maxContent(content, 5120)
	tag, _ := markSearch(sqlBlock.Tag, terms, beforeLen)
	markdown := maxContent(sqlBlock.Markdown, 5120)
	fContent := sqlBlock.FContent
	block = &Block{
		Box:      sqlBlock.Box,
		Path:     sqlBlock.Path,
		ID:       id,
		RootID:   sqlBlock.RootID,
		ParentID: sqlBlock.ParentID,
		Alias:    sqlBlock.Alias,
		Name:     sqlBlock.Name,
		Memo:     sqlBlock.Memo,
		Tag:      tag,
		Content:  content,
		FContent: fContent,
		Markdown: markdown,
		Type:     treenode.FromAbbrType(sqlBlock.Type),
		SubType:  sqlBlock.SubType,
		Sort:     sqlBlock.Sort,
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

	hPath, _ := markSearch(sqlBlock.HPath, "", 18)
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
	idx := strings.Index(content, "<mark>")
	if 128 < maxLen && maxLen <= idx {
		head := bytes.Buffer{}
		for i := 0; i < 512; i++ {
			r, size := utf8.DecodeLastRuneInString(content[:idx])
			head.WriteRune(r)
			idx -= size
			if 64 < head.Len() {
				break
			}
		}

		content = util.Reverse(head.String()) + content[idx:]
	}

	if maxLen < utf8.RuneCountInString(content) {
		return gulu.Str.SubStr(content, maxLen) + "..."
	}
	return content
}

func fieldRegexp(regexp string) string {
	regexp = strings.ReplaceAll(regexp, "'", "''") // 不需要转义双引号，因为条件都是通过单引号包裹的，只需要转义单引号即可
	buf := bytes.Buffer{}
	buf.WriteString("(")
	buf.WriteString("content REGEXP '")
	buf.WriteString(regexp)
	buf.WriteString("'")
	if Conf.Search.Name {
		buf.WriteString(" OR name REGEXP '")
		buf.WriteString(regexp)
		buf.WriteString("'")
	}
	if Conf.Search.Alias {
		buf.WriteString(" OR alias REGEXP '")
		buf.WriteString(regexp)
		buf.WriteString("'")
	}
	if Conf.Search.Memo {
		buf.WriteString(" OR memo REGEXP '")
		buf.WriteString(regexp)
		buf.WriteString("'")
	}
	if Conf.Search.IAL {
		buf.WriteString(" OR ial REGEXP '")
		buf.WriteString(regexp)
		buf.WriteString("'")
	}
	buf.WriteString(" OR tag REGEXP '")
	buf.WriteString(regexp)
	buf.WriteString("')")
	return buf.String()
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
	if Conf.Search.IAL {
		buf.WriteString(" ial")
	}
	buf.WriteString(" tag}")
	return buf.String()
}

func columnConcat() string {
	buf := bytes.Buffer{}
	buf.WriteString("content")
	if Conf.Search.Name {
		buf.WriteString("||name")
	}
	if Conf.Search.Alias {
		buf.WriteString("||alias")
	}
	if Conf.Search.Memo {
		buf.WriteString("||memo")
	}
	if Conf.Search.IAL {
		buf.WriteString("||ial")
	}
	buf.WriteString("||tag")
	return buf.String()
}

func stringQuery(query string) string {
	trimmedQuery := strings.TrimSpace(query)
	if "" == trimmedQuery {
		return "\"" + query + "\""
	}

	query = strings.ReplaceAll(query, "\"", "\"\"")
	query = strings.ReplaceAll(query, "'", "''")

	if strings.Contains(trimmedQuery, " ") {
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
	return "\"" + query + "\""
}

// markReplaceSpan 用于处理搜索高亮。
func markReplaceSpan(n *ast.Node, unlinks *[]*ast.Node, keywords []string, markSpanDataType string, luteEngine *lute.Lute) bool {
	if ast.NodeText == n.Type {
		text := n.Content()
		escapedText := util.EscapeHTML(text)
		escapedKeywords := make([]string, len(keywords))
		for i, keyword := range keywords {
			escapedKeywords[i] = util.EscapeHTML(keyword)
		}
		hText := search.EncloseHighlighting(escapedText, escapedKeywords, search.GetMarkSpanStart(markSpanDataType), search.GetMarkSpanEnd(), Conf.Search.CaseSensitive, false)
		if hText != escapedText {
			text = hText
		}
		n.Tokens = gulu.Str.ToBytes(text)
		if bytes.Contains(n.Tokens, []byte(search.MarkDataType)) {
			linkTree := parse.Inline("", n.Tokens, luteEngine.ParseOptions)
			var children []*ast.Node
			for c := linkTree.Root.FirstChild.FirstChild; nil != c; c = c.Next {
				children = append(children, c)
			}
			for _, c := range children {
				n.InsertBefore(c)
			}
			*unlinks = append(*unlinks, n)
			return true
		}
	} else if ast.NodeTextMark == n.Type {
		// 搜索结果高亮支持大部分行级元素 https://github.com/siyuan-note/siyuan/issues/6745

		if n.IsTextMarkType("inline-math") || n.IsTextMarkType("inline-memo") {
			return false
		}

		var text string
		if n.IsTextMarkType("code") {
			// code 在前面的 n.
			for i, k := range keywords {
				keywords[i] = html.EscapeString(k)
			}
			text = n.TextMarkTextContent
		} else {
			text = n.Content()
		}

		startTag := search.GetMarkSpanStart(markSpanDataType)
		text = search.EncloseHighlighting(text, keywords, startTag, search.GetMarkSpanEnd(), Conf.Search.CaseSensitive, false)
		if strings.Contains(text, search.MarkDataType) {
			dataType := search.GetMarkSpanStart(n.TextMarkType + " " + search.MarkDataType)
			text = strings.ReplaceAll(text, startTag, dataType)
			tokens := gulu.Str.ToBytes(text)
			linkTree := parse.Inline("", tokens, luteEngine.ParseOptions)
			var children []*ast.Node
			for c := linkTree.Root.FirstChild.FirstChild; nil != c; c = c.Next {
				if ast.NodeText == c.Type {
					c.Type = ast.NodeTextMark
					c.TextMarkType = n.TextMarkType
					c.TextMarkTextContent = string(c.Tokens)
					if n.IsTextMarkType("a") {
						c.TextMarkAHref, c.TextMarkATitle = n.TextMarkAHref, n.TextMarkATitle
					} else if treenode.IsBlockRef(n) {
						c.TextMarkBlockRefID = n.TextMarkBlockRefID
						c.TextMarkBlockRefSubtype = n.TextMarkBlockRefSubtype
					} else if treenode.IsFileAnnotationRef(n) {
						c.TextMarkFileAnnotationRefID = n.TextMarkFileAnnotationRefID
					}
				} else if ast.NodeTextMark == c.Type {
					if n.IsTextMarkType("a") {
						c.TextMarkAHref, c.TextMarkATitle = n.TextMarkAHref, n.TextMarkATitle
					} else if treenode.IsBlockRef(n) {
						c.TextMarkBlockRefID = n.TextMarkBlockRefID
						c.TextMarkBlockRefSubtype = n.TextMarkBlockRefSubtype
					} else if treenode.IsFileAnnotationRef(n) {
						c.TextMarkFileAnnotationRefID = n.TextMarkFileAnnotationRefID
					}
				}

				children = append(children, c)
				if nil != n.Next && ast.NodeKramdownSpanIAL == n.Next.Type {
					c.KramdownIAL = n.KramdownIAL
					ial := &ast.Node{Type: ast.NodeKramdownSpanIAL, Tokens: n.Next.Tokens}
					children = append(children, ial)
				}
			}
			for _, c := range children {
				n.InsertBefore(c)
			}
			*unlinks = append(*unlinks, n)
			return true
		}
	}
	return false
}

// markReplaceSpanWithSplit 用于处理虚拟引用和反链提及高亮。
func markReplaceSpanWithSplit(text string, keywords []string, replacementStart, replacementEnd string) (ret string) {
	// 虚拟引用和反链提及关键字按最长匹配优先 https://github.com/siyuan-note/siyuan/issues/7465
	sort.Slice(keywords, func(i, j int) bool { return len(keywords[i]) > len(keywords[j]) })

	tmp := search.EncloseHighlighting(text, keywords, replacementStart, replacementEnd, Conf.Search.CaseSensitive, true)
	parts := strings.Split(tmp, replacementEnd)
	buf := bytes.Buffer{}
	for i := 0; i < len(parts); i++ {
		if i >= len(parts)-1 {
			buf.WriteString(parts[i])
			break
		}

		if nextPart := parts[i+1]; 0 < len(nextPart) && lex.IsASCIILetter(nextPart[0]) {
			// 取消已经高亮的部分
			part := strings.ReplaceAll(parts[i], replacementStart, "")
			buf.WriteString(part)
			continue
		}

		buf.WriteString(parts[i])
		buf.WriteString(replacementEnd)
	}
	ret = buf.String()
	return
}

var (
	searchIgnoreLastModified int64
	searchIgnore             []string
	searchIgnoreLock         = sync.Mutex{}
)

func getSearchIgnoreLines() (ret []string) {
	// Support ignore search results https://github.com/siyuan-note/siyuan/issues/10089

	now := time.Now().UnixMilli()
	if now-searchIgnoreLastModified < 30*1000 {
		return searchIgnore
	}

	searchIgnoreLock.Lock()
	defer searchIgnoreLock.Unlock()

	searchIgnoreLastModified = now

	searchIgnorePath := filepath.Join(util.DataDir, ".siyuan", "searchignore")
	err := os.MkdirAll(filepath.Dir(searchIgnorePath), 0755)
	if err != nil {
		return
	}
	if !gulu.File.IsExist(searchIgnorePath) {
		if err = gulu.File.WriteFileSafer(searchIgnorePath, nil, 0644); err != nil {
			logging.LogErrorf("create searchignore [%s] failed: %s", searchIgnorePath, err)
			return
		}
	}
	data, err := os.ReadFile(searchIgnorePath)
	if err != nil {
		logging.LogErrorf("read searchignore [%s] failed: %s", searchIgnorePath, err)
		return
	}
	dataStr := string(data)
	dataStr = strings.ReplaceAll(dataStr, "\r\n", "\n")
	ret = strings.Split(dataStr, "\n")

	ret = gulu.Str.RemoveDuplicatedElem(ret)
	if 0 < len(ret) && "" == ret[0] {
		ret = ret[1:]
	}
	searchIgnore = nil
	for _, line := range ret {
		searchIgnore = append(searchIgnore, line)
	}
	return
}

var (
	refSearchIgnoreLastModified int64
	refSearchIgnore             []string
	refSearchIgnoreLock         = sync.Mutex{}
)

func getRefSearchIgnoreLines() (ret []string) {
	// Support ignore search results https://github.com/siyuan-note/siyuan/issues/10089

	now := time.Now().UnixMilli()
	if now-refSearchIgnoreLastModified < 30*1000 {
		return refSearchIgnore
	}

	refSearchIgnoreLock.Lock()
	defer refSearchIgnoreLock.Unlock()

	refSearchIgnoreLastModified = now

	searchIgnorePath := filepath.Join(util.DataDir, ".siyuan", "refsearchignore")
	err := os.MkdirAll(filepath.Dir(searchIgnorePath), 0755)
	if err != nil {
		return
	}
	if !gulu.File.IsExist(searchIgnorePath) {
		if err = gulu.File.WriteFileSafer(searchIgnorePath, nil, 0644); err != nil {
			logging.LogErrorf("create refsearchignore [%s] failed: %s", searchIgnorePath, err)
			return
		}
	}
	data, err := os.ReadFile(searchIgnorePath)
	if err != nil {
		logging.LogErrorf("read refsearchignore [%s] failed: %s", searchIgnorePath, err)
		return
	}
	dataStr := string(data)
	dataStr = strings.ReplaceAll(dataStr, "\r\n", "\n")
	ret = strings.Split(dataStr, "\n")

	ret = gulu.Str.RemoveDuplicatedElem(ret)
	if 0 < len(ret) && "" == ret[0] {
		ret = ret[1:]
	}
	refSearchIgnore = nil
	for _, line := range ret {
		refSearchIgnore = append(refSearchIgnore, line)
	}
	return
}

func filterQueryInvisibleChars(query string) string {
	query = strings.ReplaceAll(query, "　", "_@full_width_space@_")
	query = strings.ReplaceAll(query, "\t", "_@tab@_")
	query = strings.ReplaceAll(query, string(gulu.ZWJ), "__@ZWJ@__")
	query = util.RemoveInvalid(query)
	query = strings.ReplaceAll(query, "_@full_width_space@_", "　")
	query = strings.ReplaceAll(query, "_@tab@_", "\t")
	query = strings.ReplaceAll(query, "__@ZWJ@__", string(gulu.ZWJ))
	query = strings.ReplaceAll(query, string(gulu.ZWJ)+"#", "#")
	return query
}

func replaceCaseInsensitive(input, old, new []byte) []byte {
	re := regexp.MustCompile("(?i)" + regexp.QuoteMeta(string(old)))
	return []byte(re.ReplaceAllString(string(input), string(new)))
}
