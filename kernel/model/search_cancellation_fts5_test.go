// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestSearchContextPreservesResultsCountsAndPagination(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search.Store(conf.NewSearch())
	for _, rootID := range []string{fixture.sourceID, fixture.targetID} {
		tree, err := LoadTreeByBlockID(rootID)
		if err != nil {
			t.Fatal(err)
		}
		for tree.Root.FirstChild != nil {
			tree.Root.FirstChild.Unlink()
		}
		for _, content := range []string{"alpha content", "beta content"} {
			paragraph := treenode.NewParagraph("")
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(content)})
			tree.Root.AppendChild(paragraph)
		}
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}
	sql.FlushQueue()
	for _, test := range []struct {
		name, query string
		method      int
	}{
		{"keyword", "alpha", 0}, {"syntax", "alpha", 1}, {"regexp", "a[a-z]+a", 3},
		{"document", "alpha beta", 0},
		{"sql", "SELECT * FROM blocks WHERE content LIKE '%alpha%' ORDER BY id", 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, group := range []int{0, 1} {
				for _, page := range []int{1, 2} {
					options := BlockSearchOptions{Query: test.query, Method: test.method, GroupBy: group,
						Page: page, PageSize: 1, Types: map[string]bool{"document": true, "paragraph": true}}
					want, matched, roots, pages, docMode := FullTextSearchBlock(options)
					ctx, cancel := context.WithCancel(context.Background())
					options.Context = ctx
					got, gotMatched, gotRoots, gotPages, gotDocMode := FullTextSearchBlock(options)
					cancel()
					if !reflect.DeepEqual(got, want) || matched != gotMatched || roots != gotRoots || pages != gotPages || docMode != gotDocMode {
						t.Fatalf("context changed results for group=%d page=%d", group, page)
					}
					if len(got) == 0 || matched != 2 || roots != 2 || (test.method != 2 && pages != 2) {
						t.Fatalf("unexpected search result: blocks=%d matched=%d roots=%d pages=%d", len(got), matched, roots, pages)
					}
					if group == 0 && test.method != 2 && test.name != "document" && !strings.Contains(got[0].Content, "<mark>") {
						t.Fatalf("missing result highlight: %s", got[0].Content)
					}
				}
			}
		})
	}
}
