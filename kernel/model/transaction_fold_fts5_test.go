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

//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCancelFoldedHeadingSuperBlockKeepsUndoBoundary(t *testing.T) {
	const (
		superBlockID = "20260817000000-sblock1"
		headingID    = "20260817000001-heading"
		paragraphID  = "20260817000002-para001"
		outsideID    = "20260817000003-outside"
	)
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if nil != err {
		t.Fatalf("load test tree failed: %s", err)
	}
	for child := tree.Root.FirstChild; nil != child; {
		next := child.Next
		child.Unlink()
		child = next
	}

	superBlock := &ast.Node{Type: ast.NodeSuperBlock, ID: superBlockID}
	superBlock.SetIALAttr("id", superBlockID)
	superBlock.AppendChild(&ast.Node{Type: ast.NodeSuperBlockOpenMarker, Tokens: []byte("{{{")})
	superBlock.AppendChild(&ast.Node{Type: ast.NodeSuperBlockLayoutMarker, Tokens: []byte("row")})
	heading := &ast.Node{Type: ast.NodeHeading, ID: headingID, HeadingLevel: 1}
	heading.SetIALAttr("id", headingID)
	heading.SetIALAttr("fold", "1")
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Heading")})
	paragraph := treenode.NewParagraph(paragraphID)
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Paragraph")})
	superBlock.AppendChild(heading)
	superBlock.AppendChild(paragraph)
	superBlock.AppendChild(&ast.Node{Type: ast.NodeSuperBlockCloseMarker, Tokens: []byte("}}}")})
	outside := treenode.NewParagraph(outsideID)
	outside.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Outside")})
	tree.Root.AppendChild(superBlock)
	tree.Root.AppendChild(outside)
	if _, err = filesys.WriteTree(tree); nil != err {
		t.Fatalf("write test tree failed: %s", err)
	}
	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()
	treenode.RemoveBlockTree(tree.Box, superBlockID)
	superBlockDOM := GetBlockDOM(superBlockID)
	for _, id := range []string{superBlockID, headingID, paragraphID} {
		if !strings.Contains(superBlockDOM, `data-node-id="`+id+`"`) {
			t.Fatalf("rendered super block DOM should contain block [%s]", id)
		}
	}

	doOperations := []*Operation{
		{Action: "unfoldHeading", ID: headingID},
		{Action: "move", ID: headingID, ParentID: fixture.sourceID},
		{Action: "move", ID: paragraphID, PreviousID: headingID, ParentID: fixture.sourceID},
		{Action: "delete", ID: superBlockID},
		{Action: "foldHeading", ID: headingID},
	}
	undoOperations := []*Operation{
		{Action: "unfoldHeading", ID: headingID},
		{
			Action: "insert",
			ID:     superBlockID,
			Data: `<div data-node-id="` + superBlockID + `" data-type="NodeSuperBlock" class="sb" ` +
				`data-sb-layout="row"><div class="protyle-attr" contenteditable="false"></div></div>`,
			ParentID: fixture.sourceID,
		},
		{Action: "move", ID: headingID, ParentID: superBlockID},
		{Action: "move", ID: paragraphID, PreviousID: headingID, ParentID: superBlockID},
		{Action: "foldHeading", ID: headingID},
	}

	if err = PerformTxSync(&Transaction{DoOperations: doOperations}); nil != err {
		t.Fatalf("cancel folded heading super block failed: %s", err)
	}
	assertCancelledFoldedSuperBlock(t, fixture.sourceID, superBlockID, headingID, paragraphID, outsideID)

	if err = PerformTxSync(&Transaction{DoOperations: undoOperations}); nil != err {
		t.Fatalf("undo folded heading super block cancellation failed: %s", err)
	}
	assertRestoredFoldedSuperBlock(t, fixture.sourceID, superBlockID, headingID, paragraphID, outsideID)

	if err = PerformTxSync(&Transaction{DoOperations: doOperations}); nil != err {
		t.Fatalf("redo folded heading super block cancellation failed: %s", err)
	}
	assertCancelledFoldedSuperBlock(t, fixture.sourceID, superBlockID, headingID, paragraphID, outsideID)
}

func TestReplayFoldedHeadingMoveUsesOriginalChildren(t *testing.T) {
	const (
		anchorID    = "20260819000000-anchor0"
		listID      = "20260819000001-list001"
		itemID      = "20260819000002-item001"
		itemBlockID = "20260819000003-itemblk"
		headingID   = "20260819000004-heading"
		firstID     = "20260819000005-first00"
		secondID    = "20260819000006-second0"
	)
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	anchor := treenode.NewParagraph(anchorID)
	list := &ast.Node{Type: ast.NodeList, ID: listID, ListData: &ast.ListData{Typ: 1}}
	list.SetIALAttr("id", listID)
	item := &ast.Node{Type: ast.NodeListItem, ID: itemID, ListData: &ast.ListData{Typ: 1}}
	item.SetIALAttr("id", itemID)
	item.AppendChild(treenode.NewParagraph(itemBlockID))
	list.AppendChild(item)
	heading := newFoldMoveTestHeading(headingID, 2)
	writeFoldMoveTestTree(t, fixture.sourceID, anchor, list, heading, treenode.NewParagraph(firstID),
		treenode.NewParagraph(secondID))

	moveGroupID := "fold-heading-list"
	forward := &Transaction{
		DoOperations: []*Operation{{
			Action:     "move",
			ID:         headingID,
			PreviousID: anchorID,
			ParentID:   fixture.sourceID,
			Context:    map[string]any{moveGroupIDContextKey: moveGroupID},
		}},
		UndoOperations: []*Operation{{
			Action:     "move",
			ID:         headingID,
			PreviousID: listID,
			ParentID:   fixture.sourceID,
			Context:    map[string]any{moveGroupIDContextKey: moveGroupID},
		}},
	}
	if err := PerformTxSync(forward); nil != err {
		t.Fatalf("move folded heading before list failed: %s", err)
	}
	wantGroup := []string{firstID, secondID}
	if !slices.Equal(forward.DoOperations[0].BlockIDs, wantGroup) ||
		!slices.Equal(forward.UndoOperations[0].BlockIDs, wantGroup) {
		t.Fatalf("folded heading move group was not stored in both directions: do=%v undo=%v",
			forward.DoOperations[0].BlockIDs, forward.UndoOperations[0].BlockIDs)
	}
	assertFoldMoveState(t, fixture.sourceID, []string{anchorID, headingID, firstID, secondID, listID}, headingID, true)

	undo := &Transaction{DoOperations: cloneOperations(forward.UndoOperations)}
	undo.MarkReplay()
	if err := PerformTxSync(undo); nil != err {
		t.Fatalf("undo folded heading list move failed: %s", err)
	}
	assertFoldMoveState(t, fixture.sourceID, []string{anchorID, listID, headingID, firstID, secondID}, headingID, true)

	redo := &Transaction{DoOperations: cloneOperations(forward.DoOperations)}
	redo.MarkReplay()
	if err := PerformTxSync(redo); nil != err {
		t.Fatalf("redo folded heading list move failed: %s", err)
	}
	assertFoldMoveState(t, fixture.sourceID, []string{anchorID, headingID, firstID, secondID, listID}, headingID, true)
}

func TestReplayUnfoldedHeadingMoveUsesStoredChildren(t *testing.T) {
	const (
		paragraphID = "20260819000100-paragr0"
		headingID   = "20260819000101-heading"
		childID     = "20260819000102-child00"
	)
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	writeFoldMoveTestTree(t, fixture.sourceID, treenode.NewParagraph(paragraphID),
		newFoldMoveTestHeading(headingID, 2), treenode.NewParagraph(childID))

	moveGroupID := "fold-heading-paragraph"
	forward := &Transaction{
		DoOperations: []*Operation{
			{
				Action:   "move",
				ID:       headingID,
				ParentID: fixture.sourceID,
				Context:  map[string]any{moveGroupIDContextKey: moveGroupID},
			},
			{Action: "unfoldHeading", ID: headingID},
		},
		UndoOperations: []*Operation{
			{
				Action:     "move",
				ID:         headingID,
				PreviousID: paragraphID,
				ParentID:   fixture.sourceID,
				Context:    map[string]any{moveGroupIDContextKey: moveGroupID},
			},
			{Action: "foldHeading", ID: headingID},
		},
	}
	if err := PerformTxSync(forward); nil != err {
		t.Fatalf("move and unfold heading failed: %s", err)
	}
	assertFoldMoveState(t, fixture.sourceID, []string{headingID, childID, paragraphID}, headingID, false)

	undo := &Transaction{DoOperations: cloneOperations(forward.UndoOperations)}
	undo.MarkReplay()
	if err := PerformTxSync(undo); nil != err {
		t.Fatalf("undo unfolded heading move failed: %s", err)
	}
	assertFoldMoveState(t, fixture.sourceID, []string{paragraphID, headingID, childID}, headingID, true)

	redo := &Transaction{DoOperations: cloneOperations(forward.DoOperations)}
	redo.MarkReplay()
	if err := PerformTxSync(redo); nil != err {
		t.Fatalf("redo unfolded heading move failed: %s", err)
	}
	assertFoldMoveState(t, fixture.sourceID, []string{headingID, childID, paragraphID}, headingID, false)
}

func TestReplayEmptyFoldedHeadingMoveGroup(t *testing.T) {
	const (
		anchorID   = "20260819000200-anchor0"
		headingID  = "20260819000201-heading"
		boundaryID = "20260819000202-boundry"
	)
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	writeFoldMoveTestTree(t, fixture.sourceID, treenode.NewParagraph(anchorID),
		newFoldMoveTestHeading(headingID, 2), newFoldMoveTestHeading(boundaryID, 2))

	moveGroupID := "empty-fold-heading"
	forward := &Transaction{
		DoOperations: []*Operation{{
			Action:   "move",
			ID:       headingID,
			ParentID: fixture.sourceID,
			Context:  map[string]any{moveGroupIDContextKey: moveGroupID},
		}},
		UndoOperations: []*Operation{{
			Action:     "move",
			ID:         headingID,
			PreviousID: anchorID,
			ParentID:   fixture.sourceID,
			Context:    map[string]any{moveGroupIDContextKey: moveGroupID},
		}},
	}
	if err := PerformTxSync(forward); nil != err {
		t.Fatalf("move empty folded heading failed: %s", err)
	}
	if nil == forward.DoOperations[0].BlockIDs || 0 != len(forward.DoOperations[0].BlockIDs) ||
		nil == forward.UndoOperations[0].BlockIDs {
		t.Fatal("an empty folded heading move group should be stored as an explicit empty slice")
	}

	undo := &Transaction{DoOperations: cloneOperations(forward.UndoOperations)}
	undo.MarkReplay()
	if err := PerformTxSync(undo); nil != err {
		t.Fatalf("undo empty folded heading move failed: %s", err)
	}
	assertFoldMoveState(t, fixture.sourceID, []string{anchorID, headingID, boundaryID}, headingID, true)
}

func newFoldMoveTestHeading(id string, level int) *ast.Node {
	heading := &ast.Node{Type: ast.NodeHeading, ID: id, HeadingLevel: level}
	heading.SetIALAttr("id", id)
	heading.SetIALAttr("fold", "1")
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Heading")})
	return heading
}

func writeFoldMoveTestTree(t *testing.T, rootID string, nodes ...*ast.Node) {
	t.Helper()
	tree, err := LoadTreeByBlockID(rootID)
	if nil != err {
		t.Fatalf("load folded heading move tree failed: %s", err)
	}
	for child := tree.Root.FirstChild; nil != child; {
		next := child.Next
		child.Unlink()
		child = next
	}
	for _, node := range nodes {
		tree.Root.AppendChild(node)
	}
	if _, err = filesys.WriteTree(tree); nil != err {
		t.Fatalf("write folded heading move tree failed: %s", err)
	}
	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()
}

func assertFoldMoveState(t *testing.T, rootID string, wantIDs []string, headingID string, folded bool) {
	t.Helper()
	tree, err := LoadTreeByBlockID(rootID)
	if nil != err {
		t.Fatalf("load folded heading move state failed: %s", err)
	}
	var gotIDs []string
	for child := tree.Root.FirstChild; nil != child; child = child.Next {
		if child.IsBlock() && ast.NodeKramdownBlockIAL != child.Type {
			gotIDs = append(gotIDs, child.ID)
		}
	}
	if !slices.Equal(gotIDs, wantIDs) {
		t.Fatalf("unexpected top-level block order: got %v, want %v", gotIDs, wantIDs)
	}
	heading := treenode.GetNodeInTree(tree, headingID)
	if nil == heading || treenode.IsSelfFolded(heading) != folded {
		t.Fatalf("unexpected heading fold state: got %v, want %v", nil != heading && treenode.IsSelfFolded(heading), folded)
	}
}

func setupFoldTransactionDatabase(t *testing.T, fixture *fileOperationTestFixture) {
	t.Helper()
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	originalTempDir := util.TempDir
	originalQueueDir := util.QueueDir
	originalConfDir := util.ConfDir
	originalDBPath := util.DBPath
	originalHistoryDBPath := util.HistoryDBPath
	originalAssetContentDBPath := util.AssetContentDBPath
	util.TempDir = t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.ConfDir = filepath.Join(util.TempDir, "conf")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	for _, dir := range []string{util.QueueDir, util.ConfDir} {
		if err := os.MkdirAll(dir, 0755); nil != err {
			t.Fatalf("create test directory [%s] failed: %v", dir, err)
		}
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	for _, path := range []string{fixture.sourcePath, fixture.targetPath} {
		tree, err := filesys.LoadTree(fixture.box.ID, path, util.NewLute())
		if nil != err {
			t.Fatalf("reload fixture document [%s] failed: %v", path, err)
		}
		treenode.UpsertBlockTree(tree)
	}
	t.Cleanup(func() {
		sql.CloseDatabase()
		util.TempDir = originalTempDir
		util.QueueDir = originalQueueDir
		util.ConfDir = originalConfDir
		util.DBPath = originalDBPath
		util.HistoryDBPath = originalHistoryDBPath
		util.AssetContentDBPath = originalAssetContentDBPath
	})
}

func assertCancelledFoldedSuperBlock(t *testing.T, rootID, superBlockID, headingID, paragraphID, outsideID string) {
	t.Helper()
	tree, err := LoadTreeByBlockID(rootID)
	if nil != err {
		t.Fatalf("load cancelled tree failed: %s", err)
	}
	if nil != treenode.GetNodeInTree(tree, superBlockID) {
		t.Fatal("cancelled super block should be removed")
	}
	heading := treenode.GetNodeInTree(tree, headingID)
	paragraph := treenode.GetNodeInTree(tree, paragraphID)
	outside := treenode.GetNodeInTree(tree, outsideID)
	if heading.Parent != tree.Root || paragraph.Parent != tree.Root || outside.Parent != tree.Root {
		t.Fatal("cancelled super block children and outside block should remain at the document root")
	}
	if !treenode.IsSelfFolded(heading) {
		t.Fatal("cancelled heading should preserve its folded state")
	}
	if ids := contentBlockIDs(treenode.HeadingChildren(heading)); !slices.Equal(ids, []string{paragraphID, outsideID}) {
		t.Fatalf("cancelled heading should use its new document scope, got %v", ids)
	}
}

func assertRestoredFoldedSuperBlock(t *testing.T, rootID, superBlockID, headingID, paragraphID, outsideID string) {
	t.Helper()
	tree, err := LoadTreeByBlockID(rootID)
	if nil != err {
		t.Fatalf("load restored tree failed: %s", err)
	}
	superBlock := treenode.GetNodeInTree(tree, superBlockID)
	heading := treenode.GetNodeInTree(tree, headingID)
	paragraph := treenode.GetNodeInTree(tree, paragraphID)
	outside := treenode.GetNodeInTree(tree, outsideID)
	if nil == superBlock || heading.Parent != superBlock || paragraph.Parent != superBlock {
		t.Fatal("undo should restore the original super block children")
	}
	if outside.Parent != tree.Root {
		t.Fatal("undo should keep the outside block out of the super block")
	}
	if nil == superBlock.ChildByType(ast.NodeSuperBlockCloseMarker) {
		t.Fatal("undo should restore the super block close marker")
	}
	if !treenode.IsSelfFolded(heading) {
		t.Fatal("undo should restore the heading fold")
	}
	if ids := contentBlockIDs(treenode.HeadingChildren(heading)); !slices.Equal(ids, []string{paragraphID}) {
		t.Fatalf("restored heading should stop at the super block boundary, got %v", ids)
	}
}

func contentBlockIDs(nodes []*ast.Node) (ret []string) {
	for _, node := range nodes {
		if node.IsBlock() && ast.NodeKramdownBlockIAL != node.Type {
			ret = append(ret, node.ID)
		}
	}
	return
}
