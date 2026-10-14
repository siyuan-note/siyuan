//go:build fts5

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
