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
	"context"
	"errors"
	stdhtml "html"
	"strconv"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	maxDocumentStatEmbedDepth   = 4
	maxDocumentStatEmbedResults = 1024
)

// DocumentStat 表示文档本身及包含嵌入块后的统计结果。
type DocumentStat struct {
	Stat          *util.BlockStatResult `json:"stat"`
	ContainsEmbed bool                  `json:"containsEmbed"`
	StatWithEmbed *util.BlockStatResult `json:"statWithEmbed,omitempty"`
	EmbedStat     *EmbedStat            `json:"embedStat,omitempty"`
}

// EmbedStat 表示嵌入块解析的完整性和处理数量。
type EmbedStat struct {
	Complete            bool `json:"complete"`
	QueryEmbedCount     int  `json:"queryEmbedCount"`
	JSEmbedCount        int  `json:"jsEmbedCount"`
	ResultCount         int  `json:"resultCount"`
	FailedQueryCount    int  `json:"failedQueryCount"`
	FailedResultCount   int  `json:"failedResultCount"`
	TruncatedQueryCount int  `json:"truncatedQueryCount"`
	CycleCount          int  `json:"cycleCount"`
	DepthLimitCount     int  `json:"depthLimitCount"`
}

type documentEmbedStatResolver struct {
	ctx           context.Context
	hostRootID    string
	accessChecker EmbedBlockAccessChecker
	queryLimit    int
	treeCache     map[string]*parse.Tree
	path          map[string]bool
	stat          *util.BlockStatResult
	info          *EmbedStat
	queryBlocks   func(context.Context, string, int, string) ([]*sql.Block, bool, error)
	loadTree      func(*sql.Block) *parse.Tree
	validate      func(string, string) error
}

// GetDocumentStat 统计文档，并按需解析查询嵌入块。
func GetDocumentStat(ctx context.Context, id, boxID string, includeEmbed bool, accessChecker EmbedBlockAccessChecker) (ret *DocumentStat) {
	tree := loadDocumentStatTree(id, boxID)
	if nil == tree {
		return
	}

	ret = &DocumentStat{
		Stat:          filesys.StatTreeFromTree(tree),
		ContainsEmbed: containsQueryEmbed([]*ast.Node{tree.Root}),
	}
	if !includeEmbed {
		return
	}

	statWithEmbed := *ret.Stat
	ret.StatWithEmbed = &statWithEmbed
	ret.EmbedStat = &EmbedStat{Complete: true}
	if !ret.ContainsEmbed {
		return
	}

	queryLimit := 64
	if nil != Conf && nil != Conf.Search && 0 < Conf.Search.Limit {
		queryLimit = Conf.Search.Limit
	}
	resolver := &documentEmbedStatResolver{
		ctx:           ctx,
		hostRootID:    tree.Root.ID,
		accessChecker: accessChecker,
		queryLimit:    queryLimit,
		treeCache:     map[string]*parse.Tree{documentStatTreeCacheKey(tree.Box, tree.Root.ID): tree},
		path:          map[string]bool{},
		stat:          ret.StatWithEmbed,
		info:          ret.EmbedStat,
		queryBlocks:   sql.SelectBlocksRawStmtBoundedInBoxContext,
		loadTree:      loadDocumentStatResultTree,
		validate:      validateDocumentStatQuery,
	}
	resolver.resolveNodes(tree, []*ast.Node{tree.Root}, 0)
	return
}

func loadDocumentStatTree(id, boxID string) (ret *parse.Tree) {
	var err error
	if "" != boxID {
		ret, err = LoadTreeByBlockIDInExactBox(id, boxID)
	} else {
		ret, err = LoadTreeByBlockID(id)
	}
	if nil != err {
		return nil
	}
	return
}

func loadDocumentStatResultTree(block *sql.Block) (ret *parse.Tree) {
	if nil == block {
		return
	}
	var err error
	if IsEncryptedBox(block.Box) {
		ret, err = LoadTreeByBlockIDInExactBox(block.RootID, block.Box)
	} else {
		ret, err = LoadTreeByBlockID(block.RootID)
	}
	if nil != err {
		return nil
	}
	return
}

func validateDocumentStatQuery(stmt, boxID string) (err error) {
	if err = sql.CheckSingleStatement(stmt); nil != err {
		return
	}
	return sql.CheckReadonlyStatementInBox(stmt, boxID)
}

func (resolver *documentEmbedStatResolver) resolveNodes(tree *parse.Tree, nodes []*ast.Node, depth int) {
	var embeds []*ast.Node
	for _, node := range nodes {
		if nil == node {
			continue
		}
		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			if ast.NodeBlockQueryEmbed == n.Type {
				embeds = append(embeds, n)
				return ast.WalkSkipChildren
			}
			return ast.WalkContinue
		})
	}

	for _, embed := range embeds {
		if nil != resolver.ctx.Err() {
			resolver.info.Complete = false
			return
		}
		resolver.resolveEmbed(tree, embed, depth)
	}
}

func (resolver *documentEmbedStatResolver) resolveEmbed(sourceTree *parse.Tree, embed *ast.Node, depth int) {
	stmt, ok := documentStatEmbedStatement(embed)
	if !ok {
		resolver.info.QueryEmbedCount++
		resolver.info.FailedQueryCount++
		resolver.info.Complete = false
		return
	}
	if strings.HasPrefix(stmt, "//!js") {
		resolver.info.JSEmbedCount++
		resolver.info.Complete = false
		return
	}

	resolver.info.QueryEmbedCount++
	if maxDocumentStatEmbedDepth <= depth {
		resolver.info.DepthLimitCount++
		resolver.info.Complete = false
		return
	}
	if resolver.path[embed.ID] {
		resolver.info.CycleCount++
		resolver.info.Complete = false
		return
	}

	remaining := maxDocumentStatEmbedResults - resolver.info.ResultCount
	if 1 > remaining {
		resolver.info.TruncatedQueryCount++
		resolver.info.Complete = false
		return
	}
	queryLimit := min(resolver.queryLimit, remaining)
	queryBoxID := ""
	if IsEncryptedBox(sourceTree.Box) {
		queryBoxID = sourceTree.Box
	}
	if err := resolver.validate(stmt, queryBoxID); nil != err {
		resolver.info.FailedQueryCount++
		resolver.info.Complete = false
		return
	}

	blocks, truncated, err := resolver.queryBlocks(resolver.ctx, stmt, queryLimit, queryBoxID)
	if nil != err {
		if !errors.Is(err, context.Canceled) {
			resolver.info.FailedQueryCount++
		}
		resolver.info.Complete = false
		return
	}
	if truncated {
		resolver.info.TruncatedQueryCount++
		resolver.info.Complete = false
	}

	resolver.path[embed.ID] = true
	defer delete(resolver.path, embed.ID)
	for _, block := range blocks {
		if nil != resolver.ctx.Err() {
			resolver.info.Complete = false
			return
		}
		if maxDocumentStatEmbedResults <= resolver.info.ResultCount {
			resolver.info.TruncatedQueryCount++
			resolver.info.Complete = false
			break
		}
		if nil == block || "query_embed" == block.Type || block.ID == embed.ID || block.ID == resolver.hostRootID {
			continue
		}
		if nil != resolver.accessChecker && !resolver.accessChecker(block.ID) {
			continue
		}
		resultTree := resolver.getResultTree(block)
		if nil == resultTree {
			resolver.info.FailedResultCount++
			resolver.info.Complete = false
			continue
		}
		def := treenode.GetNodeInTree(resultTree, block.ID)
		if nil == def {
			resolver.info.FailedResultCount++
			resolver.info.Complete = false
			continue
		}

		headingMode := documentStatHeadingMode(embed)
		visibleNodes := cleanRenderNodes(embeddedBlockNodes(def, headingMode), true)
		addBlockStat(resolver.stat, filesys.StatNodes(resultTree, visibleNodes))
		resolver.info.ResultCount++
		resolver.resolveNodes(resultTree, visibleNodes, depth+1)
	}
}

func (resolver *documentEmbedStatResolver) getResultTree(block *sql.Block) (ret *parse.Tree) {
	key := documentStatTreeCacheKey(block.Box, block.RootID)
	if ret = resolver.treeCache[key]; nil != ret {
		return
	}
	ret = resolver.loadTree(block)
	if nil != ret {
		resolver.treeCache[key] = ret
	}
	return
}

func documentStatEmbedStatement(embed *ast.Node) (stmt string, ok bool) {
	if nil == embed {
		return
	}
	script := embed.ChildByType(ast.NodeBlockQueryEmbedScript)
	if nil == script {
		return
	}
	stmt = stdhtml.UnescapeString(script.TokensStr())
	stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")
	ok = true
	return
}

func documentStatHeadingMode(embed *ast.Node) (ret int) {
	if nil != Conf && nil != Conf.Editor {
		ret = Conf.Editor.HeadingEmbedMode
	}
	if nil == embed {
		return
	}
	if customMode := embed.IALAttr("custom-heading-mode"); "" != customMode {
		if mode, err := strconv.Atoi(customMode); nil == err && 0 <= mode && mode <= 2 {
			ret = mode
		}
	}
	return
}

func containsQueryEmbed(nodes []*ast.Node) (ret bool) {
	for _, node := range nodes {
		if nil == node {
			continue
		}
		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeBlockQueryEmbed == n.Type {
				ret = true
				return ast.WalkStop
			}
			return ast.WalkContinue
		})
		if ret {
			return
		}
	}
	return
}

func addBlockStat(target, addition *util.BlockStatResult) {
	if nil == target || nil == addition {
		return
	}
	target.RuneCount += addition.RuneCount
	target.WordCount += addition.WordCount
	target.LinkCount += addition.LinkCount
	target.ImageCount += addition.ImageCount
	target.RefCount += addition.RefCount
	target.BlockCount += addition.BlockCount
}

func documentStatTreeCacheKey(boxID, rootID string) string {
	return boxID + "\x00" + rootID
}
