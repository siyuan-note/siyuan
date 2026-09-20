//go:build fts5

// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
)

func TestAttributeViewListCreateAndDuplicate(t *testing.T) {
	fixture, database, _, _ := setupAttributeViewItemsTest(t, false)
	setAttributeViewListTestLangs()
	blockID := fixture.sourceID
	listID := ast.NewNodeID()
	if err := addAttrViewView(database.ID, listID, blockID, av.LayoutTypeList); nil != err {
		t.Fatal(err)
	}
	attrView, err := av.ParseAttributeView(database.ID)
	if nil != err {
		t.Fatal(err)
	}
	list := attrView.GetView(listID)
	assertListDefaultFields(t, attrView, list)
	list.List.Columns[1].Hidden = false
	list.List.Columns[1].Wrap = true
	if err = av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}
	duplicateID := ast.NewNodeID()
	tx := &Transaction{}
	if txErr := tx.doDuplicateAttrViewView(&Operation{AvID: attrView.ID, ID: duplicateID, PreviousID: listID, BlockID: blockID}); nil != txErr {
		t.Fatalf("duplicate list failed: %+v", txErr)
	}
	cache.ClearAVCache()
	attrView, err = av.ParseAttributeView(attrView.ID)
	if nil != err {
		t.Fatal(err)
	}
	duplicate := attrView.GetView(duplicateID)
	if nil == duplicate || nil == duplicate.List || duplicate.List.Columns[1].Hidden || !duplicate.List.Columns[1].Wrap {
		t.Fatalf("duplicate must preserve list settings: %+v", duplicate)
	}
	if attrView.GetView(database.Views[0].ID).Table.Columns[1].Hidden {
		t.Fatal("creating a list must not hide fields in the source table")
	}
}
