// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRelationRetargetPreservesOtherFields(t *testing.T) {
	for _, mode := range []string{"one-way", "two-way", "self"} {
		t.Run(mode, func(t *testing.T) {
			setupAttributeViewValidationTest(t)
			source, oldTarget, target := av.NewAttributeView(ast.NewNodeID()), av.NewAttributeView(ast.NewNodeID()), av.NewAttributeView(ast.NewNodeID())
			if mode == "self" {
				oldTarget = source
			}
			first, second := ast.NewNodeID(), ast.NewNodeID()
			backID := ast.NewNodeID()
			for _, keyID := range []string{first, second} {
				relation := &av.Relation{AvID: oldTarget.ID}
				if mode == "two-way" && keyID == first {
					relation.IsTwoWay, relation.BackKeyID = true, backID
				}
				source.KeyValues = append(source.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Name: keyID, Type: av.KeyTypeRelation, Relation: relation}})
			}
			if mode == "two-way" {
				oldTarget.KeyValues = append(oldTarget.KeyValues, &av.KeyValues{Key: &av.Key{ID: backID, Type: av.KeyTypeRelation,
					Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: first}}})
			}
			for _, view := range []*av.AttributeView{source, oldTarget, target} {
				if err := av.SaveAttributeView(view); err != nil {
					t.Fatal(err)
				}
			}
			av.UpsertAvBackRel(source.ID, oldTarget.ID)
			peerID := ast.NewNodeID()
			av.UpsertAvBackRel(peerID, oldTarget.ID)
			for _, keyID := range []string{first, second} {
				if err := updateAttributeViewColRelation(&Operation{AvID: source.ID, ID: target.ID, KeyID: keyID, Format: keyID}); err != nil {
					t.Fatal(err)
				}
				remaining := av.GetSrcAvIDs(oldTarget.ID)
				if slices.Contains(remaining, source.ID) != (keyID == first) || !slices.Contains(remaining, peerID) {
					t.Fatalf("unexpected old target dependencies after %s: %v", keyID, remaining)
				}
				if !slices.Contains(av.GetSrcAvIDs(target.ID), source.ID) {
					t.Fatal("new target dependency is missing")
				}
				updated, err := av.ParseAttributeView(source.ID)
				if err != nil {
					t.Fatal(err)
				}
				key, _ := updated.GetKey(second)
				want := target.ID
				if keyID == first {
					want = oldTarget.ID
				}
				if key.Relation.AvID != want {
					t.Fatal("the unchanged field was retargeted")
				}
			}
		})
	}
}

func TestRelationCandidateUntitledSearch(t *testing.T) {
	oldLang, oldWorkingDir, oldCaseSensitive := util.Lang, util.WorkingDir, util.SearchCaseSensitive.Load()
	util.WorkingDir = "../../app"
	t.Cleanup(func() {
		util.Lang, util.WorkingDir = oldLang, oldWorkingDir
		util.SearchCaseSensitive.Store(oldCaseSensitive)
	})
	for _, language := range []struct{ lang, keyword string }{{"en", "unt"}, {"zh-CN", "未命"}, {"de", "unbet"}} {
		data, err := os.ReadFile("../../app/appearance/langs/" + language.lang + ".json")
		if err != nil {
			t.Fatal(err)
		}
		var labels struct {
			Untitled string `json:"untitled"`
		}
		if err = json.Unmarshal(data, &labels); err != nil {
			t.Fatal(err)
		}
		if labels.Untitled == "" {
			t.Fatal("frontend untitled label must be available")
		}
		util.Lang = language.lang
		util.SearchCaseSensitive.Store(false)
		attrView, alphaID, betaID := newRelationCandidateTestAttributeView()
		table := renderAttributeViewRelationCandidates(attrView)
		for _, row := range table.Rows {
			row.GetBlockValue().Block.Content = ""
		}
		for page, id := range []string{betaID, alphaID} {
			rows, total := filterSortPageRelationCandidates(table, attrView, language.keyword, page+1, 1, nil)
			if total != 2 || len(rows) != 1 || rows[0].ID != id {
				t.Fatalf("%s page %d: total=%d rows=%+v", language.lang, page+1, total, rows)
			}
		}
		row := table.Rows[0]
		value := row.GetBlockValue()
		if value.Block.Content != "" {
			t.Fatal("search must preserve the stored empty value")
		}
		value.HasRenderTemplate = true
		if relationCandidateMatches(row, language.keyword, labels.Untitled, table.Columns...) {
			t.Fatal("an empty template result must not match the placeholder")
		}
		value.HasRenderTemplate = false
		value.RenderedContent = "custom"
		if relationCandidateMatches(row, language.keyword, labels.Untitled, table.Columns...) {
			t.Fatal("a rendered template must not match the placeholder")
		}
		value.RenderedContent = ""
		table.Columns[0].RenderTemplate = "{{.name}}"
		if relationCandidateMatches(row, language.keyword, labels.Untitled, table.Columns...) {
			t.Fatal("a configured template must not match the placeholder")
		}
		table.Columns[0].RenderTemplate = ""
		value.Block.Content = " "
		if relationCandidateMatches(row, language.keyword, labels.Untitled, table.Columns...) {
			t.Fatal("whitespace that is not displayed as untitled must not match")
		}
		value.Block.Content = "named"
		if relationCandidateMatches(row, language.keyword, labels.Untitled, table.Columns...) {
			t.Fatal("empty non-primary fields must not match the placeholder")
		}
		value.Block.Content = ""
		if language.lang == "en" {
			util.SearchCaseSensitive.Store(true)
			if relationCandidateMatches(row, "unt", labels.Untitled, table.Columns...) || !relationCandidateMatches(row, "Unt", labels.Untitled, table.Columns...) {
				t.Fatal("placeholder search must respect case sensitivity")
			}
		}
	}
}

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
		if relationCandidateMatches(row, "alpha red", "") {
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
