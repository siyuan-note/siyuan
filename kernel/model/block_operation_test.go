// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPerformBlockOperationPersistsBeforeReturning(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	const firstID = "20260908000000-first01"
	const secondID = "20260908000000-second1"
	dom := func(id string) string {
		return util.NewLute().Md2BlockDOM("test\n{: id=\""+id+"\"}", false)
	}
	for index, op := range []*Operation{
		{Action: "appendInsert", ParentID: fixture.sourceID, Data: dom(firstID)},
		{Action: "insert", PreviousID: firstID, Data: dom(secondID)},
		{Action: "delete", ID: firstID},
	} {
		transactions, err := PerformBlockOperation(op)
		if err != nil || len(transactions) != 1 {
			t.Fatalf("operation %s failed: %v", op.Action, err)
		}
		cache.RemoveTreeData(fixture.sourceID)
		tree, err := LoadTreeByBlockID(fixture.sourceID)
		if err != nil {
			t.Fatal(err)
		}
		if op.Action == "delete" {
			if treenode.GetNodeInTree(tree, firstID) != nil {
				t.Fatal("deleted block is still present after returning")
			}
		} else {
			id := firstID
			if index == 1 {
				id = secondID
			}
			if treenode.GetNodeInTree(tree, id) == nil {
				t.Fatalf("inserted block %s is missing after returning", id)
			}
		}
	}

	// 后续同步删除必须先执行队列中的追加，不能将尚未执行的目标误判为不存在。
	queued := []*Transaction{{DoOperations: []*Operation{{
		Action: "appendInsert", ParentID: fixture.sourceID, Data: dom(firstID),
	}}}}
	PerformTransactions(&queued)
	if _, err := PerformBlockOperation(&Operation{Action: "delete", ID: firstID}); err != nil {
		t.Fatalf("delete after queued append failed: %v", err)
	}
	cache.RemoveTreeData(fixture.sourceID)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	if treenode.GetNodeInTree(tree, firstID) != nil {
		t.Fatal("queued append was applied after synchronous delete")
	}
}

func TestPerformBlockOperationReturnsErrors(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	listID, _ := addOrderedListForStructureTest(t, fixture.sourceID)
	for _, op := range []*Operation{
		{Action: "appendInsert", ParentID: "20260908000000-missing", Data: ""},
		{Action: "insert", PreviousID: "20260908000000-missing", Data: ""},
		{Action: "insert", ParentID: listID, Data: util.NewLute().Md2BlockDOM("invalid child", false)},
		{Action: "appendInsert", ParentID: fixture.sourceID, Data: ""},
		{Action: "delete", ID: "20260908000000-missing"},
		{Action: "delete", ID: fixture.sourceID},
	} {
		transactions, err := PerformBlockOperation(op)
		if err == nil || transactions != nil {
			t.Fatalf("expected failed operation without success data: %+v, %v", op, err)
		}
	}
}

func TestInsertDocumentSiblingAnchorRollsBackEarlierOperations(t *testing.T) {
	for _, test := range []struct {
		name  string
		count int
	}{{"small", 2}, {"large", 33}} {
		t.Run(test.name, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			path := filepath.Join(util.DataDir, fixture.box.ID, filepath.Base(fixture.sourcePath))
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{}
			var insertedIDs []string
			for index := 0; index < test.count-1; index++ {
				id := ast.NewNodeID()
				insertedIDs = append(insertedIDs, id)
				dom := util.NewLute().Md2BlockDOM("inserted\n{: id=\""+id+"\"}", false)
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "insert", PreviousID: fixture.childID, Data: dom})
			}
			tx.DoOperations = append(tx.DoOperations, &Operation{
				Action: "insert", NextID: fixture.sourceID, Data: util.NewLute().Md2BlockDOM("invalid", false),
			})
			err = PerformTxSync(tx)
			requireStructureTransactionError(t, err)
			if err.Error() != "`nextID` cannot be the ID of a document" {
				t.Fatalf("expected document anchor error, got %v", err)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("rejected transaction changed the source document: %v", err)
			}
			cache.RemoveTreeData(fixture.sourceID)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range insertedIDs {
				if treenode.GetNodeInTree(tree, id) != nil {
					t.Fatal("rejected transaction persisted an earlier insertion")
				}
			}
		})
	}
}

func TestPerformBlockOperationInsertAfterQueuedAppend(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	const queuedID = "20261006000000-queued1"
	const insertedID = "20261006000000-insert1"
	dom := func(id string) string {
		return util.NewLute().Md2BlockDOM("queued\n{: id=\""+id+"\"}", false)
	}
	queued := []*Transaction{{DoOperations: []*Operation{{
		Action: "appendInsert", ParentID: fixture.sourceID, Data: dom(queuedID),
	}}}}
	PerformTransactions(&queued)
	if _, err := PerformBlockOperation(&Operation{
		Action: "insert", PreviousID: queuedID, Data: dom(insertedID),
	}); err != nil {
		t.Fatalf("insert after queued append failed: %v", err)
	}
	cache.RemoveTreeData(fixture.sourceID)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.GetNodeInTree(tree, insertedID)
	if node == nil || node.Previous == nil || node.Previous.ID != queuedID {
		t.Fatal("insert did not use the queued append as its sibling anchor")
	}
}

func TestLargeInsertSiblingAnchors(t *testing.T) {
	for _, field := range []string{"previousID", "nextID"} {
		t.Run(field, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			tx := &Transaction{}
			var ids []string
			for index := 0; index < 32; index++ {
				id := ast.NewNodeID()
				ids = append(ids, id)
				dom := util.NewLute().Md2BlockDOM("inserted\n{: id=\""+id+"\"}", false)
				operation := &Operation{Action: "insert", Data: dom}
				if field == "previousID" {
					operation.PreviousID = fixture.childID
				} else {
					operation.NextID, operation.PreviousID = fixture.childID, fixture.sourceID
				}
				tx.DoOperations = append(tx.DoOperations, operation)
			}
			if err := PerformTxSync(tx); err != nil {
				t.Fatalf("valid bulk insert failed: %v", err)
			}
			cache.RemoveTreeData(fixture.sourceID)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			anchor := treenode.GetNodeInTree(tree, fixture.childID)
			for index, id := range ids {
				node := treenode.GetNodeInTree(tree, id)
				if node == nil || node.Parent != tree.Root {
					t.Fatalf("bulk insert did not persist block %s", id)
				}
				if field == "previousID" && (index == len(ids)-1 && node.Previous != anchor ||
					index < len(ids)-1 && (node.Previous == nil || node.Previous.ID != ids[index+1])) {
					t.Fatal("bulk insert did not preserve previousID placement")
				}
				if field == "nextID" && (index == len(ids)-1 && node.Next != anchor ||
					index < len(ids)-1 && (node.Next == nil || node.Next.ID != ids[index+1])) {
					t.Fatal("bulk insert did not preserve nextID placement")
				}
			}
		})
	}
}
