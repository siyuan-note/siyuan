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
	"testing"

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
