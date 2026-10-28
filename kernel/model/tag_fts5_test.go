// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGlobalTagMutationsIncludeInlineTitles(t *testing.T) {
	for _, action := range []string{"rename", "remove", "replaceTag", "replaceText"} {
		t.Run(action, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			Conf.Search.Store(conf.NewSearch())
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			callout := &ast.Node{Type: ast.NodeCallout, ID: ast.NewNodeID(), CalloutType: "NOTE", CalloutTitleExplicit: true, CalloutTitle: "#review# foo"}
			callout.SetIALAttr("id", callout.ID)
			callout.AppendChild(treenode.NewParagraph(ast.NewNodeID()))
			tree.Root.AppendChild(callout)
			if err = writeTreeUpsertQueue(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			sql.FlushQueue()
			if len(sql.QueryTagSpansByLabel("review")) == 0 {
				t.Fatal("title tag was not indexed")
			}
			switch action {
			case "rename":
				err = RenameTag("review", "done")
			case "remove":
				err = RemoveTag("review")
			case "replaceTag":
				err = FindReplaceInBox("review", "#done#", map[string]bool{"tag": true}, []string{callout.ID}, nil, nil, nil, nil, 0, "")
			case "replaceText":
				err = FindReplaceInBox("foo", "bar", map[string]bool{"text": true}, []string{callout.ID}, nil, nil, nil, nil, 0, "")
			}
			if err != nil {
				t.Fatal(err)
			}
			actual, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			node := treenode.GetNodeInTree(actual, callout.ID)
			if node == nil || node.FirstChild == nil || node.FirstChild.Next != nil {
				t.Fatal("temporary title blocks leaked into the body")
			}
			wantText, wantTag := "foo", "done"
			if action == "remove" {
				wantTag = ""
			}
			if action == "replaceText" {
				wantText, wantTag = "bar", "review"
			}
			if !strings.Contains(node.CalloutTitle, wantText) {
				t.Fatalf("title text was not preserved: %q", node.CalloutTitle)
			}
			var tags []string
			treenode.WalkWithInlineTitles(node, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.Type == ast.NodeTextMark && n.IsTextMarkType("tag") {
					tags = append(tags, n.TextMarkTextContent)
				}
				return ast.WalkContinue
			})
			if wantTag == "" && len(tags) != 0 || wantTag != "" && (len(tags) != 1 || tags[0] != wantTag) {
				t.Fatalf("title tags = %v, want %q", tags, wantTag)
			}
		})
	}
}
