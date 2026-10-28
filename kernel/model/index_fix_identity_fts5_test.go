// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func isolateIndexRepairPaths(t *testing.T) {
	t.Helper()
	oldHistory, oldQueue := util.HistoryDir, util.QueueDir
	util.HistoryDir, util.QueueDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.HistoryDir, util.QueueDir = oldHistory, oldQueue })
}

func assertIndexRepairDocument(t *testing.T, tree *parse.Tree) {
	t.Helper()
	if !indexRepairIdentitiesMatch(tree) {
		t.Fatal("source and block-tree identities differ")
	}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.IsBlock() && node.ID != "" {
			block := sql.GetBlockInBox(node.ID, tree.Box)
			if block == nil || block.RootID != tree.ID || block.Path != tree.Path {
				t.Fatalf("source and SQL identities differ for %s: %+v", node.ID, block)
			}
		}
		return ast.WalkContinue
	})
}

func TestIndexFixDuplicateChildRebuildsIndexesAndPreservesAmbiguousData(t *testing.T) {
	fixture, view, _, _ := setupAttributeViewItemsTest(t, false)
	isolateIndexRepairPaths(t)
	source, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	target, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	oldTargetID := target.Root.FirstChild.ID
	sql.UpsertTreeQueue(source)
	sql.UpsertTreeQueue(target)
	sql.FlushQueue()
	duplicateID := source.Root.FirstChild.ID
	duplicated := target.Root.FirstChild
	duplicated.ID = duplicateID
	duplicated.SetIALAttr("id", duplicateID)
	duplicated.SetIALAttr(av.NodeAttrNameAvs, view.ID)
	duplicated.SetIALAttr(NodeAttrRiffDecks, "20230218211946-2kw8jgx")
	duplicated.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: duplicateID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Ambiguous"})
	row := view.GetBlockKeyValues().Values[0]
	row.IsDetached, row.Block.ID = false, duplicateID
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	viewPath := av.GetAttributeViewDataPath(view.ID)
	viewBefore, err := os.ReadFile(viewPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = filesys.WriteTree(target); err != nil {
		t.Fatal(err)
	}
	updated := target.Root.IALAttr("updated")
	filename := filepath.Join(util.DataDir, target.Box, target.Path)
	original, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	if err = resetDuplicateBlocksOnFileSys(); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	repaired, _, err := filesys.ReadTreeSnapshot(target.Box, target.Path)
	if err != nil {
		t.Fatal(err)
	}
	node := repaired.Root.FirstChild
	if node.ID == duplicateID || repaired.Root.IALAttr("updated") != updated {
		t.Fatal("fixture did not exercise ID repair without a root timestamp change")
	}
	assertIndexRepairDocument(t, source)
	assertIndexRepairDocument(t, repaired)
	if treenode.GetBlockTreeInExactBox(oldTargetID, target.Box) != nil || sql.GetBlockInBox(oldTargetID, target.Box) != nil {
		t.Fatal("obsolete target identity remained indexed")
	}
	if node.LastChild.TextMarkBlockRefID != duplicateID || node.IALAttr(av.NodeAttrNameAvs) != view.ID || node.IALAttr(NodeAttrRiffDecks) != "20230218211946-2kw8jgx" {
		t.Fatal("repair guessed or discarded ambiguous associations")
	}
	refs := sql.QueryRefsByDefIDInBox(duplicateID, false, target.Box)
	if len(refs) != 1 || refs[0].BlockID != node.ID || refs[0].RootID != repaired.ID {
		t.Fatalf("reference source was not reindexed: %+v", refs)
	}
	if current, readErr := os.ReadFile(viewPath); readErr != nil || !bytes.Equal(current, viewBefore) {
		t.Fatal("repair changed database bindings or field values", readErr)
	}
	histories, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-format", target.Box, filepath.Base(target.Path)))
	if err != nil || len(histories) != 1 {
		t.Fatalf("missing original repair history: %v %v", histories, err)
	}
	if backup, readErr := os.ReadFile(histories[0]); readErr != nil || !bytes.Equal(backup, original) {
		t.Fatal("repair did not preserve exact original source", readErr)
	}
	after, _ := os.ReadFile(filename)
	if err = resetDuplicateBlocksOnFileSys(); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	current, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(current, after) {
		t.Fatal("repeated repair changed a completed source", err)
	}
}

func TestIndexFixRepairsExplicitTabAndMirrorOwnership(t *testing.T) {
	fixture, view, _, _ := setupAttributeViewItemsTest(t, false)
	isolateIndexRepairPaths(t)
	source, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	target, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	mirrorID := ast.NewNodeID()
	for _, tree := range []*parse.Tree{source, target} {
		node := &ast.Node{ID: mirrorID, Type: ast.NodeAttributeView, AttributeViewID: view.ID, AttributeViewType: "table"}
		node.SetIALAttr("id", mirrorID)
		tree.Root.AppendChild(node)
	}
	av.UpsertBlockRel(view.ID, mirrorID)
	oldItemID := source.Root.FirstChild.ID
	tabs := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeTabs}
	tabs.SetIALAttr("id", tabs.ID)
	tabs.SetIALAttr(treenode.TabsActiveIDAttr, oldItemID)
	item := &ast.Node{ID: oldItemID, Type: ast.NodeTabItem}
	item.SetIALAttr("id", item.ID)
	item.AppendChild(treenode.NewParagraph(""))
	tabs.AppendChild(item)
	target.Root.AppendChild(tabs)
	for _, tree := range []*parse.Tree{source, target} {
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
	}
	if err = resetDuplicateBlocksOnFileSys(); err != nil {
		t.Fatal(err)
	}
	repaired, _, err := filesys.ReadTreeSnapshot(target.Box, target.Path)
	if err != nil {
		t.Fatal(err)
	}
	tabs = repaired.Root.LastChild
	if tabs.FirstChild.ID == oldItemID || tabs.IALAttr(treenode.TabsActiveIDAttr) != tabs.FirstChild.ID {
		t.Fatal("selected tab did not follow its structurally owned item")
	}
	newMirrorID := repaired.Root.LastChild.Previous.ID
	rels := av.GetBlockRels()[view.ID]
	if len(rels) != 2 || !((rels[0] == mirrorID && rels[1] == newMirrorID) || (rels[1] == mirrorID && rels[0] == newMirrorID)) {
		t.Fatalf("mirror ownership was not repaired while preserving the original: %v", rels)
	}
}

func TestIndexFixResumesSourceOnlyIdentityRepair(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	isolateIndexRepairPaths(t)
	tree, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	oldID := tree.Root.FirstChild.ID
	treenode.ResetNodeID(tree.Root.FirstChild)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	// Simulate interruption after source replacement, before queueing or updating either index.
	if err = resetDuplicateBlocksOnFileSys(); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	assertIndexRepairDocument(t, tree)
	if treenode.GetBlockTreeInExactBox(oldID, tree.Box) != nil || sql.GetBlockInBox(oldID, tree.Box) != nil {
		t.Fatal("interrupted repair left obsolete identities")
	}
}
