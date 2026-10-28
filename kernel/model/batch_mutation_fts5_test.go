// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBookmarkMutationsRefreshCachedAttributesAfterCommit(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.GetNodeInTree(tree, fixture.childID)
	node.SetIALAttr("bookmark", "review")
	if err = writeTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	cache.PutBlockIALInBox(node.ID, tree.Box, map[string]string{"bookmark": "review"})
	if err = RenameBookmark("review", "done"); err != nil {
		t.Fatal(err)
	}
	if got := sql.GetBlockAttrs(node.ID)["bookmark"]; got != "done" {
		t.Fatalf("cached bookmark = %q", got)
	}
	if err = RemoveBookmark("done"); err != nil {
		t.Fatal(err)
	}
	if got := sql.GetBlockAttrs(node.ID)["bookmark"]; got != "" {
		t.Fatalf("removed bookmark remains cached: %q", got)
	}
}

func TestTagAndBookmarkMutationsRejectConcurrentEdits(t *testing.T) {
	for _, action := range []string{"renameTag", "removeTag", "renameBookmark", "removeBookmark"} {
		t.Run(action, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			paragraph := treenode.NewParagraph(ast.NewNodeID())
			paragraph.SetIALAttr("bookmark", "review")
			paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "review"})
			tree.Root.AppendChild(paragraph)
			if err = writeTreeUpsertQueue(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			sql.FlushQueue()
			var edited []byte
			filename := filepath.Join(util.DataDir, tree.Box, tree.Path)
			concurrentEdit := func() {
				current, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
				if err != nil {
					t.Fatal(err)
				}
				p := treenode.NewParagraph(ast.NewNodeID())
				p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("unrelated committed edit")})
				current.Root.AppendChild(p)
				if err := indexWriteTreeUpsertQueue(current); err != nil {
					t.Fatal(err)
				}
				sql.FlushQueue()
				edited, err = os.ReadFile(filename)
				if err != nil {
					t.Fatal(err)
				}
			}
			switch action {
			case "renameTag":
				err = renameTag("review", "done", concurrentEdit)
			case "removeTag":
				err = removeTag("review", concurrentEdit)
			case "renameBookmark":
				err = renameBookmark("review", "done", concurrentEdit)
			case "removeBookmark":
				err = removeBookmark("review", concurrentEdit)
			}
			if !errors.Is(err, util.ErrFileChanged) {
				t.Fatalf("stale mutation was accepted: %v", err)
			}
			actual, err := os.ReadFile(filename)
			if err != nil || len(edited) == 0 || !bytes.Equal(actual, edited) {
				t.Fatalf("concurrent edit was overwritten: %v", err)
			}
		})
	}
}
