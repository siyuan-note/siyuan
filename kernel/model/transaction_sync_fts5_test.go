// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPerformTransactionSyncEditsUTF8BOMDocument(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	path := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, append([]byte("\xef\xbb\xbf"), data...), 0600); err != nil {
		t.Fatal(err)
	}
	cache.RemoveTreeDataInBox(fixture.sourceID, fixture.box.ID)
	dom := fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">edited BOM document</div></div>`, fixture.childID)
	if err = PerformTransactionSync(&Transaction{DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom}}}); err != nil {
		t.Fatalf("BOM document could not be edited: %v", err)
	}
	cache.RemoveTreeDataInBox(fixture.sourceID, fixture.box.ID)
	tree, err := LoadTreeByBlockID(fixture.childID)
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.GetNodeInTree(tree, fixture.childID)
	if node == nil || !strings.Contains(util.NewLute().RenderNodeBlockDOM(node), "edited BOM document") {
		t.Fatal("edit was not persisted")
	}
	stored, err := os.ReadFile(path)
	if err != nil || bytes.HasPrefix(stored, []byte("\xef\xbb\xbf")) {
		t.Fatalf("BOM was not removed when saving: %v", err)
	}
}

func TestPerformTransactionSyncPreservesQueueOrder(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	const insertedID = "20261006000000-queued1"
	dom := util.NewLute().Md2BlockDOM("queued\n{: id=\""+insertedID+"\"}", false)
	queued := []*Transaction{{DoOperations: []*Operation{{
		Action: "appendInsert", ParentID: fixture.sourceID, Data: dom,
	}}}}
	PerformTransactions(&queued)
	if err := PerformTransactionSync(&Transaction{DoOperations: []*Operation{{
		Action: "move", ID: fixture.childID, PreviousID: insertedID,
	}}}); err != nil {
		t.Fatalf("move after queued insert failed: %v", err)
	}
	cache.RemoveTreeData(fixture.sourceID)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.GetNodeInTree(tree, fixture.childID)
	if node == nil || node.Previous == nil || node.Previous.ID != insertedID {
		t.Fatal("queued insert was not applied before the persisted move")
	}
}
