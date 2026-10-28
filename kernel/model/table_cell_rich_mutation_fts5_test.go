// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRichTableCellBatchMutationsPersistSource(t *testing.T) {
	for _, tc := range []struct{ name, source, keyword, replacement, typ, want, absent string }{
		{"removeMixedTag", "#review# text", "review", "", "remove", "text", "review"},
		{"removeOnlyTag", "#review#", "review", "", "remove", "", "review"},
		{"renameTag", "#review# text", "review", "done", "rename", "done", "review"},
		{"replaceFormatting", "foo\n\n- keep list", "foo", "**bar**", "text", "bar", "foo"},
		{"removeLink", "[foo](https://example.com)", "foo", "", "aText", "", "example.com"},
		{"removeStrong", "**foo**", "foo", "", "strong", "", "foo"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			Conf.Search.Store(conf.NewSearch())
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			parsed, _, _, _ := parseStdMd([]byte("| Header |\n| --- |\n| Cell |"), true)
			table := parsed.Root.FirstChild
			cells := table.ChildrenByType(ast.NodeTableCell)
			cell := cells[len(cells)-1]
			cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: tc.source}
			tree.Root.AppendChild(table)
			if err := treenode.RefreshTableCellRichProjection(tree.Root); err != nil {
				t.Fatal(err)
			}
			if err = writeTreeUpsertQueue(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			sql.FlushQueue()
			switch tc.typ {
			case "remove":
				err = RemoveTag(tc.keyword)
			case "rename":
				err = RenameTag(tc.keyword, tc.replacement)
			default:
				err = FindReplaceInBox(tc.keyword, tc.replacement, map[string]bool{tc.typ: true}, []string{table.ID}, nil, nil, nil, nil, 0, "")
			}
			if err != nil {
				t.Fatal(err)
			}
			actual, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			cells = treenode.GetNodeInTree(actual, table.ID).ChildrenByType(ast.NodeTableCell)
			rich := cells[len(cells)-1].TableCellRich
			if rich == nil || strings.Contains(rich.Content, tc.absent) || !strings.Contains(rich.Content, tc.want) {
				t.Fatalf("source mutation was not persisted: %+v", rich)
			}
			fragment, err := av.ParseTableCellRich(rich)
			if err != nil {
				t.Fatal(err)
			}
			if tc.name == "replaceFormatting" {
				strong := false
				ast.Walk(fragment.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if entering && n.IsTextMarkType("strong") {
						strong = true
					}
					return ast.WalkContinue
				})
				if !strong || !strings.Contains(rich.Content, "keep list") {
					t.Fatal("formatting or adjacent list lost", rich.Content)
				}
			}
		})
	}
}
