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
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentEmbedStatCountsRepeatedResults(t *testing.T) {
	setDocumentStatTestConf(t)

	embed := documentStatTestEmbed("20260813120000-embed01", "query")
	hostTree := documentStatTestTree("20260813120000-host001", embed)
	paragraph := documentStatTestParagraph("20260813120000-para001", "hello world")
	resultTree := documentStatTestTree("20260813120000-doc0001", paragraph)
	loadCount := 0
	info := &EmbedStat{Complete: true}
	stat := filesys.StatTreeFromTree(hostTree)
	resolver := documentStatTestResolver(hostTree, stat, info)
	resolver.queryBlocks = func(_ context.Context, stmt string, limit int, boxID string) ([]*sql.Block, bool, error) {
		if "query" != stmt || 64 != limit || "" != boxID {
			t.Fatalf("查询参数不正确：stmt=%q limit=%d boxID=%q", stmt, limit, boxID)
		}
		block := &sql.Block{ID: paragraph.ID, RootID: resultTree.Root.ID, Box: resultTree.Box, Type: "p"}
		return []*sql.Block{block, block}, false, nil
	}
	resolver.loadTree = func(_ *sql.Block) *parse.Tree {
		loadCount++
		return resultTree
	}

	resolver.resolveNodes(hostTree, []*ast.Node{hostTree.Root}, 0)

	if 4 != stat.WordCount || 20 != stat.RuneCount {
		t.Fatalf("重复显示的结果应重复统计：%+v", stat)
	}
	if 3 != stat.BlockCount {
		t.Fatalf("块数量不正确：%d", stat.BlockCount)
	}
	if 1 != info.QueryEmbedCount || 2 != info.ResultCount || !info.Complete {
		t.Fatalf("嵌入统计元数据不正确：%+v", info)
	}
	if 1 != loadCount {
		t.Fatalf("同一文档应仅加载一次，实际加载 %d 次", loadCount)
	}
}

func TestDocumentEmbedStatMarksJSEmbedIncomplete(t *testing.T) {
	setDocumentStatTestConf(t)

	embed := documentStatTestEmbed("20260813120001-embed02", "//!js\nreturn [];")
	hostTree := documentStatTestTree("20260813120001-host002", embed)
	info := &EmbedStat{Complete: true}
	stat := filesys.StatTreeFromTree(hostTree)
	resolver := documentStatTestResolver(hostTree, stat, info)
	resolver.queryBlocks = func(context.Context, string, int, string) ([]*sql.Block, bool, error) {
		t.Fatal("JavaScript 嵌入不应执行 SQL 查询")
		return nil, false, nil
	}

	resolver.resolveNodes(hostTree, []*ast.Node{hostTree.Root}, 0)

	if info.Complete || 1 != info.JSEmbedCount || 0 != info.QueryEmbedCount {
		t.Fatalf("JavaScript 嵌入应标记为部分统计：%+v", info)
	}
}

func TestDocumentEmbedStatFiltersInaccessibleResults(t *testing.T) {
	setDocumentStatTestConf(t)

	embed := documentStatTestEmbed("20260813120005-embed05", "query")
	hostTree := documentStatTestTree("20260813120005-host004", embed)
	paragraph := documentStatTestParagraph("20260813120005-para003", "hidden content")
	resultTree := documentStatTestTree("20260813120005-doc0003", paragraph)
	info := &EmbedStat{Complete: true}
	stat := filesys.StatTreeFromTree(hostTree)
	resolver := documentStatTestResolver(hostTree, stat, info)
	resolver.accessChecker = func(string) bool {
		return false
	}
	resolver.queryBlocks = func(context.Context, string, int, string) ([]*sql.Block, bool, error) {
		return []*sql.Block{{ID: paragraph.ID, RootID: resultTree.Root.ID, Type: "p"}}, false, nil
	}
	resolver.loadTree = func(*sql.Block) *parse.Tree {
		t.Fatal("无权限的查询结果不应加载文档树")
		return nil
	}

	resolver.resolveNodes(hostTree, []*ast.Node{hostTree.Root}, 0)

	if 0 != stat.WordCount || 0 != info.ResultCount || !info.Complete {
		t.Fatalf("无权限的查询结果不应计入统计：stat=%+v info=%+v", stat, info)
	}
}

func TestDocumentEmbedStatMarksTruncatedQueryIncomplete(t *testing.T) {
	setDocumentStatTestConf(t)

	embed := documentStatTestEmbed("20260813120006-embed06", "query")
	hostTree := documentStatTestTree("20260813120006-host005", embed)
	paragraph := documentStatTestParagraph("20260813120006-para004", "visible content")
	resultTree := documentStatTestTree("20260813120006-doc0004", paragraph)
	info := &EmbedStat{Complete: true}
	stat := filesys.StatTreeFromTree(hostTree)
	resolver := documentStatTestResolver(hostTree, stat, info)
	resolver.queryBlocks = func(context.Context, string, int, string) ([]*sql.Block, bool, error) {
		return []*sql.Block{{ID: paragraph.ID, RootID: resultTree.Root.ID, Type: "p"}}, true, nil
	}
	resolver.loadTree = func(*sql.Block) *parse.Tree {
		return resultTree
	}

	resolver.resolveNodes(hostTree, []*ast.Node{hostTree.Root}, 0)

	if info.Complete || 1 != info.TruncatedQueryCount || 1 != info.ResultCount {
		t.Fatalf("截断查询应保留已计结果并标记为部分统计：%+v", info)
	}
}

func TestDocumentEmbedStatDetectsCycles(t *testing.T) {
	setDocumentStatTestConf(t)

	firstEmbed := documentStatTestEmbed("20260813120002-embed03", "to-b")
	hostContainer := &ast.Node{Type: ast.NodeSuperBlock, ID: "20260813120002-super01"}
	hostContainer.AppendChild(firstEmbed)
	hostTree := documentStatTestTree("20260813120002-host003", hostContainer)

	secondEmbed := documentStatTestEmbed("20260813120003-embed04", "to-a")
	resultTree := documentStatTestTree("20260813120003-doc0002", secondEmbed)
	info := &EmbedStat{Complete: true}
	stat := filesys.StatTreeFromTree(hostTree)
	resolver := documentStatTestResolver(hostTree, stat, info)
	resolver.queryBlocks = func(_ context.Context, stmt string, _ int, _ string) ([]*sql.Block, bool, error) {
		if "to-b" == stmt {
			return []*sql.Block{{ID: resultTree.Root.ID, RootID: resultTree.Root.ID, Type: "d"}}, false, nil
		}
		return []*sql.Block{{ID: hostContainer.ID, RootID: hostTree.Root.ID, Type: "s"}}, false, nil
	}
	resolver.loadTree = func(block *sql.Block) *parse.Tree {
		if block.RootID == resultTree.Root.ID {
			return resultTree
		}
		return hostTree
	}

	resolver.resolveNodes(hostTree, []*ast.Node{hostTree.Root}, 0)

	if info.Complete || 1 != info.CycleCount {
		t.Fatalf("循环嵌入应终止并标记为部分统计：%+v", info)
	}
	if 3 != info.QueryEmbedCount || 2 != info.ResultCount {
		t.Fatalf("循环前的结果统计不正确：%+v", info)
	}
}

func TestEmbeddedBlockNodesUsesHeadingMode(t *testing.T) {
	heading := &ast.Node{Type: ast.NodeHeading, ID: "20260813120004-heading", HeadingLevel: 2}
	paragraph := documentStatTestParagraph("20260813120004-para002", "content")
	nextHeading := &ast.Node{Type: ast.NodeHeading, ID: "20260813120004-heading2", HeadingLevel: 2}
	root := &ast.Node{Type: ast.NodeDocument}
	root.AppendChild(heading)
	root.AppendChild(paragraph)
	root.AppendChild(nextHeading)

	if nodes := embeddedBlockNodes(heading, 0); 2 != len(nodes) || nodes[0] != heading || nodes[1] != paragraph {
		t.Fatalf("标题及下方块模式不正确：%v", nodes)
	}
	if nodes := embeddedBlockNodes(heading, 1); 1 != len(nodes) || nodes[0] != heading {
		t.Fatalf("仅标题模式不正确：%v", nodes)
	}
	if nodes := embeddedBlockNodes(heading, 2); 1 != len(nodes) || nodes[0] != paragraph {
		t.Fatalf("仅标题下方块模式不正确：%v", nodes)
	}

	heading.SetIALAttr("fold", "1")
	if nodes := embeddedBlockNodes(heading, 2); 0 != len(nodes) {
		t.Fatalf("折叠标题不应返回下方块：%v", nodes)
	}
}

func documentStatTestResolver(tree *parse.Tree, stat *util.BlockStatResult, info *EmbedStat) *documentEmbedStatResolver {
	return &documentEmbedStatResolver{
		ctx:        context.Background(),
		hostRootID: tree.Root.ID,
		queryLimit: 64,
		treeCache: map[string]*parse.Tree{
			documentStatTreeCacheKey(tree.Box, tree.Root.ID): tree,
		},
		path: map[string]bool{},
		stat: stat,
		info: info,
		validate: func(string, string) error {
			return nil
		},
	}
}

func setDocumentStatTestConf(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	Conf.Editor = conf.NewEditor()
	Conf.Search = conf.NewSearch()
	t.Cleanup(func() {
		Conf = previousConf
	})
}

func documentStatTestTree(rootID string, blocks ...*ast.Node) *parse.Tree {
	root := &ast.Node{Type: ast.NodeDocument, ID: rootID}
	for _, block := range blocks {
		root.AppendChild(block)
	}
	return &parse.Tree{Root: root, Box: "20260813120000-box0001"}
}

func documentStatTestEmbed(id, stmt string) *ast.Node {
	embed := &ast.Node{Type: ast.NodeBlockQueryEmbed, ID: id}
	embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte(stmt)})
	return embed
}

func documentStatTestParagraph(id, content string) *ast.Node {
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: id}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(content)})
	return paragraph
}
