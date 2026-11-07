// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestListItemInsertionReplaysAllSiblings(t *testing.T) {
	for _, marker := range []string{"* ", "1. ", "* [ ] "} {
		for _, anchor := range []string{"parent", "previous", "next"} {
			t.Run(marker+anchor, func(t *testing.T) {
				fixture := setupStructureTransactionTest(t)
				setupFoldTransactionDatabase(t, fixture)
				lute := util.NewLute()
				tree, err := LoadTreeByBlockID(fixture.sourceID)
				if err != nil {
					t.Fatal(err)
				}
				list := lute.BlockDOM2Tree(lute.Md2BlockDOM(marker+"anchor", false)).Root.FirstChild
				tree.Root.AppendChild(list)
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				fragment := lute.BlockDOM2Tree(lute.Md2BlockDOM(marker+"first\n"+marker+"second", false)).Root.FirstChild
				var dom strings.Builder
				var insertedIDs []string
				var undo []*Operation
				for item := fragment.FirstChild; item != nil; item = item.Next {
					if item.Type != ast.NodeListItem {
						continue
					}
					dom.WriteString(lute.RenderNodeBlockDOM(item))
					insertedIDs = append(insertedIDs, item.ID)
					undo = append(undo, &Operation{Action: "delete", ID: item.ID})
				}
				if len(insertedIDs) != 2 {
					t.Fatalf("expected two fixture items, got %v", insertedIDs)
				}
				anchorID := list.FirstChild.ID
				op := &Operation{Action: "insert", ID: insertedIDs[0], ParentID: list.ID, Data: dom.String()}
				expected := append(slices.Clone(insertedIDs), anchorID)
				if anchor == "previous" {
					op.PreviousID = anchorID
					expected = append([]string{anchorID}, insertedIDs...)
				} else if anchor == "next" {
					op.NextID = anchorID
				}
				tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo, fromAPI: true}
				if err = PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				check := func(want []string) {
					t.Helper()
					cache.RemoveTreeData(fixture.sourceID)
					current, loadErr := LoadTreeByBlockID(fixture.sourceID)
					if loadErr != nil {
						t.Fatal(loadErr)
					}
					parent := treenode.GetNodeInTree(current, list.ID)
					if parent == nil {
						t.Fatal("list disappeared")
					}
					var got []string
					for item := parent.FirstChild; item != nil; item = item.Next {
						if item.Type == ast.NodeListItem {
							got = append(got, item.ID)
						}
					}
					if !slices.Equal(got, want) {
						t.Fatalf("list items: got %v, want %v", got, want)
					}
				}
				check(expected)
				entry := GlobalUndoLog.Peek(fixture.sourceID)
				if entry == nil {
					t.Fatal("insertion was not recorded")
				}
				for range 2 {
					if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
						t.Fatal(err)
					}
					check([]string{anchorID})
					if err = PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
						t.Fatal(err)
					}
					check(expected)
				}
			})
		}
	}
}
