// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestRenderAttributeViewRelationCandidates(t *testing.T) {
	attrView, alphaID, betaID := newRelationCandidateTestAttributeView()

	table := renderAttributeViewRelationCandidates(attrView)
	if 3 != len(table.Columns) {
		t.Fatalf("line number columns should be excluded, got %d columns", len(table.Columns))
	}
	if av.KeyTypeBlock != table.Columns[0].Type || "Text" != table.Columns[1].Name || "Number" != table.Columns[2].Name {
		t.Fatalf("unexpected relation candidate columns: %+v", table.Columns)
	}
	if 2 != len(table.Rows) {
		t.Fatalf("expected two candidate rows, got %d", len(table.Rows))
	}

	var selectedRows, rows []*av.TableRow
	for _, row := range table.Rows {
		if row.ID == betaID {
			selectedRows = append(selectedRows, row)
		}
		if relationCandidateMatches(row, "alpha red") {
			rows = append(rows, row)
		}
	}
	if 1 != len(selectedRows) || betaID != selectedRows[0].ID {
		t.Fatalf("unexpected selected rows: %+v", selectedRows)
	}
	if 1 != len(rows) || alphaID != rows[0].ID {
		t.Fatalf("search should match multiple keywords in one field: %+v", rows)
	}
}

func TestRelationCandidateOrderingAndPaging(t *testing.T) {
	attrView, alphaID, betaID := newRelationCandidateTestAttributeView()
	table := renderAttributeViewRelationCandidates(attrView)
	rows, total := filterSortPageRelationCandidates(table, attrView, "", 1, 1, nil)
	if 2 != total || 1 != len(rows) || betaID != rows[0].ID {
		t.Fatalf("the first page should contain the newest candidate: total=%d rows=%+v", total, rows)
	}

	rows, total = filterSortPageRelationCandidates(table, attrView, "", 2, 1, nil)
	if 2 != total || 1 != len(rows) || alphaID != rows[0].ID {
		t.Fatalf("the second page should contain the older candidate: total=%d rows=%+v", total, rows)
	}

	rows, total = filterSortPageRelationCandidates(table, attrView, "blue", 1, 16, nil)
	if 1 != total || 1 != len(rows) || betaID != rows[0].ID {
		t.Fatalf("search should inspect all fields: total=%d rows=%+v", total, rows)
	}
}

func TestRelationCandidateColumnSort(t *testing.T) {
	attrView, alphaID, betaID := newRelationCandidateTestAttributeView()
	numberKey := attrView.KeyValues[2].Key
	attrView.KeyValues[2].Values = []*av.Value{
		{ID: ast.NewNodeID(), KeyID: numberKey.ID, BlockID: alphaID, Type: av.KeyTypeNumber, Number: &av.ValueNumber{Content: 10, IsNotEmpty: true}},
		{ID: ast.NewNodeID(), KeyID: numberKey.ID, BlockID: betaID, Type: av.KeyTypeNumber, Number: &av.ValueNumber{Content: 2, IsNotEmpty: true}},
	}
	for _, test := range []struct {
		column  string
		order   av.SortOrder
		keyword string
		page    int
		want    string
		total   int
	}{
		{attrView.GetBlockKey().ID, av.SortOrderAsc, "", 1, alphaID, 2},
		{attrView.GetBlockKey().ID, av.SortOrderDesc, "", 1, betaID, 2},
		{attrView.GetBlockKey().ID, av.SortOrderAsc, "", 2, betaID, 2},
		{attrView.KeyValues[1].Key.ID, av.SortOrderDesc, "red", 1, alphaID, 1},
		{numberKey.ID, av.SortOrderAsc, "", 1, betaID, 2},
		{numberKey.ID, av.SortOrderDesc, "", 1, alphaID, 2},
	} {
		table := renderAttributeViewRelationCandidates(attrView)
		rows, total := filterSortPageRelationCandidates(table, attrView, test.keyword, test.page, 1,
			&av.ViewSort{Column: test.column, Order: test.order})
		if len(rows) != 1 || rows[0].ID != test.want || total != test.total {
			t.Fatalf("sort %+v: rows=%+v total=%d", test, rows, total)
		}
	}
}

func newRelationCandidateTestAttributeView() (attrView *av.AttributeView, alphaID, betaID string) {
	blockKey := av.NewKey(ast.NewNodeID(), "Primary", "", av.KeyTypeBlock)
	textKey := av.NewKey(ast.NewNodeID(), "Text", "", av.KeyTypeText)
	numberKey := av.NewKey(ast.NewNodeID(), "Number", "", av.KeyTypeNumber)
	lineNumberKey := av.NewKey(ast.NewNodeID(), "Line number", "", av.KeyTypeLineNumber)
	alphaID, betaID = ast.NewNodeID(), ast.NewNodeID()

	attrView = &av.AttributeView{
		ID: ast.NewNodeID(),
		KeyValues: []*av.KeyValues{
			{Key: blockKey, Values: []*av.Value{
				{ID: ast.NewNodeID(), KeyID: blockKey.ID, BlockID: alphaID, Type: av.KeyTypeBlock, IsDetached: true,
					CreatedAt: 100, Block: &av.ValueBlock{Content: "Alpha"}},
				{ID: ast.NewNodeID(), KeyID: blockKey.ID, BlockID: betaID, Type: av.KeyTypeBlock, IsDetached: true,
					CreatedAt: 200, Block: &av.ValueBlock{Content: "Beta"}},
			}},
			{Key: textKey, Values: []*av.Value{
				{ID: ast.NewNodeID(), KeyID: textKey.ID, BlockID: alphaID, Type: av.KeyTypeText,
					Text: &av.ValueText{Content: "Alpha red"}},
				{ID: ast.NewNodeID(), KeyID: textKey.ID, BlockID: betaID, Type: av.KeyTypeText,
					Text: &av.ValueText{Content: "Beta blue"}},
			}},
			{Key: numberKey},
			{Key: lineNumberKey},
		},
		KeyIDs:            []string{textKey.ID, lineNumberKey.ID, blockKey.ID, numberKey.ID},
		RenderedViewables: map[string]av.Viewable{},
	}
	return
}
