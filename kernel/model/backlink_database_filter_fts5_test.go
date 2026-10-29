// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestBacklinkDatabaseFilteringPaginationAndMentions(t *testing.T) {
	setupAttributeViewValidationTest(t)
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search.Store(conf.NewSearch())
	Conf.Search.Load().BacklinkMentionDoc = true
	t.Cleanup(func() { ClearGlobalBacklinkSnapshots("") })
	view := av.NewAttributeView(ast.NewNodeID())
	savedNotifications := 0
	previousSaved := av.AttributeViewSaved
	av.AttributeViewSaved = func(avID, boxID string) {
		if avID == view.ID {
			savedNotifications++
		}
		if previousSaved != nil {
			previousSaved(avID, boxID)
		}
	}
	t.Cleanup(func() { av.AttributeViewSaved = previousSaved })
	view.Name = "Tasks"
	status := &av.Key{ID: ast.NewNodeID(), Name: "Status", Type: av.KeyTypeText}
	done := &av.Key{ID: ast.NewNodeID(), Name: "Done", Type: av.KeyTypeCheckbox}
	view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: status}, &av.KeyValues{Key: done})
	view.Views[0].Filters = []*av.ViewFilter{{Column: status.ID, Operator: av.FilterOperatorIsEqual,
		Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "closed"}}}}
	var ids []string
	for _, rootID := range []string{fixture.sourceID, fixture.targetID} {
		tree, err := LoadTreeByBlockID(rootID)
		if err != nil {
			t.Fatal(err)
		}
		for tree.Root.FirstChild != nil {
			tree.Root.FirstChild.Unlink()
		}
		if rootID == fixture.sourceID {
			tree.Root.SetIALAttr("title", "DatabaseBacklinkTopic")
			tree.HPath = "/DatabaseBacklinkTopic"
		} else {
			intro := treenode.NewParagraph(ast.NewNodeID())
			intro.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("DatabaseBacklinkTopic")})
			tree.Root.AppendChild(intro)
			for i := 0; i < 70; i++ {
				id := ast.NewNodeID()
				ids = append(ids, id)
				p := treenode.NewParagraph(id)
				p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Task ")})
				p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: fixture.sourceID,
					TextMarkBlockRefSubtype: "s", TextMarkTextContent: fmt.Sprintf("A%d", i+1)})
				if i < 65 {
					p.SetIALAttr(av.NodeAttrNameAvs, view.ID)
					itemID := ast.NewNodeID()
					view.KeyValues[0].Values = append(view.KeyValues[0].Values, &av.Value{ID: ast.NewNodeID(), KeyID: view.GetBlockKey().ID,
						BlockID: itemID, Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: id, Content: fmt.Sprintf("Task %d", i)}})
					content := "open"
					if i >= 60 {
						content = "closed"
					}
					view.KeyValues[2].Values = append(view.KeyValues[2].Values, &av.Value{ID: ast.NewNodeID(), KeyID: status.ID,
						BlockID: itemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: content}})
					view.KeyValues[3].Values = append(view.KeyValues[3].Values, &av.Value{ID: ast.NewNodeID(), KeyID: done.ID,
						BlockID: itemID, Type: av.KeyTypeCheckbox, Checkbox: &av.ValueCheckbox{Checked: true}})
				}
				tree.Root.AppendChild(p)
			}
		}
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
		sql.UpdateRefsTreeQueue(tree)
	}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if savedNotifications != 1 {
		t.Fatal("plain-text database field saves must notify filtered backlinks")
	}
	sql.FlushQueue()
	filter := &BacklinkSourceFilter{Database: &BacklinkDatabaseFilter{AvID: view.ID, Filters: []*av.ViewFilter{
		{Combination: av.FilterCombinationAnd, Filters: []*av.ViewFilter{
			{Column: done.ID, Operator: av.FilterOperatorIsTrue, Value: &av.Value{Type: av.KeyTypeCheckbox, Checkbox: &av.ValueCheckbox{Checked: true}}},
			{Combination: av.FilterCombinationOr, Filters: []*av.ViewFilter{
				{Column: status.ID, Operator: av.FilterOperatorIsEqual, Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "open"}}},
				{Column: status.ID, Operator: av.FilterOperatorIsEqual, Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "pending"}}},
			}},
		}},
	}}}
	_, _, mentions, originalCount, mentionCount := GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", nil, true, true)
	_, docs, filteredMentions, count, filteredMentionCount := GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", filter, true, true)
	if originalCount != 70 || count != 60 || len(docs) != 1 || docs[0].Count != 60 {
		t.Fatalf("counts: %d -> %d, %+v", originalCount, count, docs)
	}
	if mentionCount != filteredMentionCount || !reflect.DeepEqual(mentions, filteredMentions) {
		t.Fatal("database filtering changed mentions")
	}
	contexts, _ := GetBacklinkDocInBox(fixture.sourceID, fixture.targetID, "", false, false, "", filter)
	if len(contexts) != 60 {
		t.Fatalf("detail count: %d", len(contexts))
	}
	query := GlobalBacklinkQuery{ID: fixture.sourceID, Sort: 1, SourceFilter: filter}
	allow := func(string) bool { return true }
	token, page, total, _, expired, err := GetGlobalBacklinks(query, "", 0, "", allow)
	if err != nil || expired || total != 60 || len(page) != 50 {
		t.Fatalf("first filtered page: %d %d %v %v", total, len(page), expired, err)
	}
	_, page, total, offset, expired, err := GetGlobalBacklinks(query, token, 50, "", allow)
	if err != nil || expired || total != 60 || offset != 50 || len(page) != 10 || page[0].ID != ids[50] {
		t.Fatalf("second filtered page: %d %d %v %v", total, len(page), expired, err)
	}
	candidates, err := GetBacklinkDatabases(fixture.sourceID, "", "", false, filter)
	if err != nil || len(candidates) != 1 || candidates[0].ID != view.ID || len(candidates[0].Keys) != 4 {
		t.Fatalf("database candidates: %+v %v", candidates, err)
	}
	loaded, err := av.ParseAttributeView(view.ID)
	if err != nil || loaded.Views[0].Filters[0].Value.Text.Content != "closed" {
		t.Fatal("backlink filtering changed the original database view", err)
	}
	filter.Database.Filters = nil
	_, _, _, count, _ = GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", filter, false, true)
	if count != 65 {
		t.Fatalf("membership-only filter included unbound blocks: %d", count)
	}
	if _, _, _, _, expired, _ := GetGlobalBacklinks(query, token, 0, "", allow); !expired {
		t.Fatal("snapshot accepted changed database conditions")
	}
	filter.Database.Filters = []*av.ViewFilter{{Column: "removed-field", Operator: av.FilterOperatorIsEmpty}}
	_, _, _, count, _ = GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", filter, false, true)
	if count != 0 {
		t.Fatal("removed field expanded results")
	}
	_, _, _, count, _ = GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", nil, false, true)
	if count != 70 {
		t.Fatal("clearing filter did not restore all backlinks")
	}
}

func TestBacklinkDatabaseListItemBindingAndDirectPrecedence(t *testing.T) {
	setupAttributeViewValidationTest(t)
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search.Store(conf.NewSearch())
	source, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	sql.IndexTreeQueue(source)
	view := av.NewAttributeView(ast.NewNodeID())
	key := &av.Key{ID: ast.NewNodeID(), Name: "Status", Type: av.KeyTypeText}
	view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: key})
	tree, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	for tree.Root.FirstChild != nil {
		tree.Root.FirstChild.Unlink()
	}
	intro := treenode.NewParagraph(ast.NewNodeID())
	intro.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Intro")})
	tree.Root.AppendChild(intro)
	list := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeList, ListData: &ast.ListData{}}
	item := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeListItem, ListData: &ast.ListData{}}
	paragraph := treenode.NewParagraph(ast.NewNodeID())
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: fixture.sourceID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Topic"})
	item.AppendChild(paragraph)
	list.AppendChild(item)
	tree.Root.AppendChild(list)
	item.SetIALAttr(av.NodeAttrNameAvs, view.ID)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.UpdateRefsTreeQueue(tree)
	appendItem := func(blockID, state string, detached bool) {
		itemID := ast.NewNodeID()
		view.KeyValues[0].Values = append(view.KeyValues[0].Values, &av.Value{ID: ast.NewNodeID(), KeyID: view.GetBlockKey().ID,
			BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: detached, Block: &av.ValueBlock{ID: blockID, Content: "Task"}})
		view.KeyValues[2].Values = append(view.KeyValues[2].Values, &av.Value{ID: ast.NewNodeID(), KeyID: key.ID,
			BlockID: itemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: state}})
	}
	appendItem(item.ID, "open", false)
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	filter := &BacklinkSourceFilter{Database: &BacklinkDatabaseFilter{AvID: view.ID, Filters: []*av.ViewFilter{
		{Column: key.ID, Operator: av.FilterOperatorIsEqual, Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "open"}}},
	}}}
	_, _, _, count, _ := GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", filter, false, true)
	contexts, _ := GetBacklinkDocInBox(fixture.sourceID, fixture.targetID, "", false, false, "", filter)
	if count != 1 || len(contexts) != 1 || contexts[0].ID != item.ID {
		t.Fatalf("list binding not used consistently: %d %+v", count, contexts)
	}
	query := GlobalBacklinkQuery{ID: fixture.sourceID, Sort: 1, SourceFilter: filter}
	_, page, total, _, _, err := GetGlobalBacklinks(query, "", 0, "", func(string) bool { return true })
	if err != nil || total != 1 || page[0].ID != paragraph.ID {
		t.Fatalf("global list owner: %+v %v", page, err)
	}
	candidates, err := GetBacklinkDatabases(fixture.sourceID, "", "", false, nil)
	if err != nil || len(candidates) != 1 || candidates[0].ID != view.ID {
		t.Fatalf("list binding candidates: %+v %v", candidates, err)
	}
	appendItem(paragraph.ID, "closed", false)
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	_, _, _, count, _ = GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", filter, false, true)
	if count != 0 {
		t.Fatal("a matching parent overrode the source block's own database row")
	}
	other := av.NewAttributeView(ast.NewNodeID())
	other.Name = view.Name
	if err := av.SaveAttributeView(other); err != nil {
		t.Fatal(err)
	}
	filter.Database = &BacklinkDatabaseFilter{AvID: other.ID}
	_, _, _, count, _ = GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, "", filter, false, true)
	if count != 0 {
		t.Fatal("same-named databases were mixed")
	}
	ClearGlobalBacklinkSnapshots("")
}
