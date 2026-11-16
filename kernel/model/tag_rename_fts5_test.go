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
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGlobalTagRenameTransactionAndUndo(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	previousLog := GlobalUndoLog
	GlobalUndoLog = newUndoLog(64)
	t.Cleanup(func() { GlobalUndoLog = previousLog })
	assertTag := func(node *ast.Node, want string) {
		t.Helper()
		var labels []string
		treenode.WalkWithInlineTitles(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && n.Type == ast.NodeTextMark && n.IsTextMarkType("tag") {
				labels = append(labels, n.TextMarkTextContent)
			}
			return ast.WalkContinue
		})
		if len(labels) != 1 || labels[0] != want {
			t.Fatalf("tags=%v, want %q", labels, want)
		}
	}
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("tags", "review,review/child,review-more,xreview")
	paragraph := treenode.NewParagraph(ast.NewNodeID())
	for _, label := range []string{"review", "review/child", "review-more", "xreview"} {
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: label})
	}
	tree.Root.AppendChild(paragraph)
	callout := &ast.Node{Type: ast.NodeCallout, ID: ast.NewNodeID(), CalloutType: "NOTE", CalloutTitleExplicit: true, CalloutTitle: "#review# keep"}
	callout.SetIALAttr("id", callout.ID)
	callout.AppendChild(treenode.NewParagraph(ast.NewNodeID()))
	tree.Root.AppendChild(callout)
	parsed, _, _, _ := parseStdMd([]byte("| Header |\n| --- |\n| Cell |"), true)
	table := parsed.Root.FirstChild
	cells := table.ChildrenByType(ast.NodeTableCell)
	cells[len(cells)-1].TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: "#review/child# keep"}
	tree.Root.AppendChild(table)
	if err = treenode.RefreshTableCellRichProjection(tree.Root); err != nil {
		t.Fatal(err)
	}
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	second, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	second.Root.SetIALAttr("tags", "review/child")
	if err = indexWriteTreeUpsertQueue(second); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	tx, err := RenameTagWithTransaction("review", "/done/")
	if err != nil {
		t.Fatal(err)
	}
	if len(tx.DoOperations) != 5 || len(tx.UndoOperations) != 5 {
		t.Fatalf("expected one operation per changed source block: do=%d undo=%d", len(tx.DoOperations), len(tx.UndoOperations))
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	if entry == nil || entry != GlobalUndoLog.Peek(fixture.targetID) || len(entry.MutatedRootIDs()) != 2 {
		t.Fatal("rename did not record one shared cross-document history entry")
	}
	for index, label := range []string{"done", "review", "done"} {
		if index == 1 {
			if GlobalUndoLog.Undo(fixture.targetID) != entry {
				t.Fatal("rename history unavailable for undo")
			}
			err = PerformTxSync(&Transaction{isReplay: true, DoOperations: entry.UndoOperationsForReplay()})
			if err == nil {
				GlobalUndoLog.UndoCommit(entry, fixture.targetID)
			}
		} else if index == 2 {
			if GlobalUndoLog.Redo(fixture.targetID) != entry {
				t.Fatal("rename history unavailable for redo")
			}
			err = PerformTxSync(&Transaction{isReplay: true, DoOperations: entry.DoOperationsForReplay()})
			if err == nil {
				GlobalUndoLog.RedoCommit(entry, fixture.targetID)
			}
		}
		if err != nil {
			t.Fatal(err)
		}
		stored, readErr := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
		if readErr != nil {
			t.Fatal(readErr)
		}
		if got, want := stored.Root.IALAttr("tags"), label+","+label+"/child,review-more,xreview"; got != want {
			t.Fatalf("document tags=%q, want %q", got, want)
		}
		other, readErr := filesys.LoadTree(second.Box, second.Path, util.NewLute())
		if readErr != nil || other.Root.IALAttr("tags") != label+"/child" {
			t.Fatal("cross-document rename history did not update both documents", readErr)
		}
		tags := treenode.GetNodeInTree(stored, paragraph.ID).ChildrenByType(ast.NodeTextMark)
		if tags[0].TextMarkTextContent != label || tags[1].TextMarkTextContent != label+"/child" || tags[2].TextMarkTextContent != "review-more" || tags[3].TextMarkTextContent != "xreview" {
			t.Fatalf("inline boundaries lost: %+v", tags)
		}
		storedCallout := treenode.GetNodeInTree(stored, callout.ID)
		if !strings.Contains(storedCallout.CalloutTitle, "keep") {
			t.Fatalf("inline title=%q", storedCallout.CalloutTitle)
		}
		assertTag(storedCallout, label)
		storedCells := treenode.GetNodeInTree(stored, table.ID).ChildrenByType(ast.NodeTableCell)
		rich := storedCells[len(storedCells)-1].TableCellRich
		if rich == nil || !strings.Contains(rich.Content, "keep") {
			t.Fatalf("table source=%+v", rich)
		}
		fragment, parseErr := av.ParseTableCellRich(rich)
		if parseErr != nil {
			t.Fatal(parseErr)
		}
		assertTag(fragment.Root, label+"/child")
	}
}

func TestTagRenameNoopPreservesSource(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("tags", "review-more,xreview")
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	filename := filepath.Join(util.DataDir, tree.Box, tree.Path)
	before, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	for _, labels := range [][2]string{{"missing", "done"}, {"review", "done"}, {"review-more", "review-more"}} {
		tx, err := renameTag(labels[0], labels[1], func() { t.Fatal("no-op reached commit") })
		if err != nil || len(tx.DoOperations) != 0 || len(tx.UndoOperations) != 0 {
			t.Fatalf("no-op produced operations: %+v, %v", tx, err)
		}
	}
	after, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("no-op changed the source: %v", err)
	}
	for _, label := range []string{"", "/", "#invalid#"} {
		if _, err := RenameTagWithTransaction("review", label); err == nil {
			t.Fatalf("invalid label accepted: %q", label)
		}
	}
}

func TestTagRenameRejectsChangedSourceAcrossDocuments(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	files := map[string]string{}
	originals := map[string][]byte{}
	for _, id := range []string{fixture.sourceID, fixture.targetID} {
		tree, err := LoadTreeByBlockID(id)
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr("tags", "review")
		if err = indexWriteTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
		files[id] = filepath.Join(util.DataDir, tree.Box, tree.Path)
		originals[id], err = os.ReadFile(files[id])
		if err != nil {
			t.Fatal(err)
		}
	}
	sql.FlushQueue()
	_, err := renameTag("review", "done", func() {
		tree, err := filesys.LoadTree(fixture.box.ID, fixture.targetPath, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr("custom-latest", "preserve")
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		originals[fixture.targetID], err = os.ReadFile(files[fixture.targetID])
		if err != nil {
			t.Fatal(err)
		}
	})
	if !errors.Is(err, util.ErrFileChanged) {
		t.Fatalf("stale source accepted: %v", err)
	}
	for id, filename := range files {
		actual, err := os.ReadFile(filename)
		if err != nil || !bytes.Equal(actual, originals[id]) {
			t.Fatalf("rejected rename changed %s: %v", id, err)
		}
	}
}

func TestTagRenameRetainsCollectedFieldsAndCollectsNewMatches(t *testing.T) {
	for _, oldLabel := range []string{"todo", "later"} {
		t.Run(oldLabel, func(t *testing.T) {
			fixture, view, keyID := setupBlockCollectionTest(t)
			if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, oldLabel)); err != nil {
				t.Fatal(err)
			}
			newLabel := "todo"
			if oldLabel == "todo" {
				newLabel = "done"
				view = readAttributeViewItemsTest(t, view.ID)
				row := view.GetBlockValueByBoundID(fixture.sourceID)
				view.GetValue(keyID, row.BlockID).Text.Content = "Keep fields"
				if err := av.SaveAttributeView(view); err != nil {
					t.Fatal(err)
				}
			}
			tx, err := RenameTagWithTransaction(oldLabel, newLabel)
			if err != nil {
				t.Fatal(err)
			}
			stored := readAttributeViewItemsTest(t, view.ID)
			row := stored.GetBlockValueByBoundID(fixture.sourceID)
			if row == nil {
				t.Fatal("existing entry removed or new match not collected")
			}
			if oldLabel == "todo" && stored.GetValue(keyID, row.BlockID).Text.Content != "Keep fields" {
				t.Fatal("rename replaced existing field values")
			}
			if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
				t.Fatal(err)
			}
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil || tree.Root.IALAttr("tags") != oldLabel {
				t.Fatal("undo did not restore the tag", err)
			}
			if oldLabel == "todo" {
				stored = readAttributeViewItemsTest(t, view.ID)
				row = stored.GetBlockValueByBoundID(fixture.sourceID)
				if row == nil || stored.GetValue(keyID, row.BlockID).Text.Content != "Keep fields" {
					t.Fatal("undo lost the original entry or fields")
				}
			}
		})
	}
}
