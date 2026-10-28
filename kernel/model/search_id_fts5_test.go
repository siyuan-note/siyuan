// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestFullTextSearchByIDFilters(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search.Store(conf.NewSearch())
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2, ID: ast.NewNodeID()}
	heading.SetIALAttr("id", heading.ID)
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("heading")})
	tree.Root.AppendChild(heading)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()
	previousIgnore, previousModified := searchIgnore, searchIgnoreLastModified
	t.Cleanup(func() { searchIgnore, searchIgnoreLastModified = previousIgnore, previousModified })
	searchIgnore, searchIgnoreLastModified = nil, time.Now().UnixMilli()
	for _, method := range []int{0, 1} {
		for _, group := range []int{0, 1} {
			for _, tc := range []struct {
				name   string
				change func(*BlockSearchOptions)
				want   int
			}{
				{"allowed", func(*BlockSearchOptions) {}, 1},
				{"notebook", func(o *BlockSearchOptions) { o.Boxes = []string{"20261026000000-other00"} }, 0},
				{"path", func(o *BlockSearchOptions) { o.Paths = []string{fixture.targetPath} }, 0},
				{"type", func(o *BlockSearchOptions) { o.Types = map[string]bool{"paragraph": true} }, 0},
				{"subtype", func(o *BlockSearchOptions) { o.SubTypes = map[string]bool{"h1": true} }, 0},
				{"excluded notebook", func(o *BlockSearchOptions) { o.ExcludeBoxIDs = []string{fixture.box.ID} }, 0},
				{"excluded document", func(o *BlockSearchOptions) { o.ExcludeDocIDs = []string{fixture.sourceID} }, 0},
				{"ignore", func(*BlockSearchOptions) { searchIgnore = []string{"id != '" + heading.ID + "'"} }, 0},
				{"second page", func(o *BlockSearchOptions) { o.Page = 2 }, 0},
			} {
				t.Run(tc.name+string(rune('0'+method))+string(rune('0'+group)), func(t *testing.T) {
					searchIgnore = nil
					options := BlockSearchOptions{Query: heading.ID, Method: method, GroupBy: group, Page: 1, PageSize: 32,
						Boxes: []string{fixture.box.ID}, Paths: []string{fixture.sourcePath}, Types: map[string]bool{"heading": true}, SubTypes: map[string]bool{"h2": true}}
					tc.change(&options)
					blocks, matched, roots, pages, docMode := FullTextSearchBlock(options)
					if len(blocks) != tc.want || matched != tc.want || roots != tc.want || pages != tc.want || docMode {
						t.Fatalf("results=%d matched=%d roots=%d pages=%d docMode=%v, want %d", len(blocks), matched, roots, pages, docMode, tc.want)
					}
				})
			}
		}
	}
}
