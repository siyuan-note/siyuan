// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"encoding/json"
	"maps"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTagCreatedDocumentAndInlineHistory(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("tags", "A,B,C")
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	read := func(id string) tagDates {
		t.Helper()
		stored, _, readErr := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
		if readErr != nil {
			t.Fatal(readErr)
		}
		node := treenode.GetNodeInTree(stored, id)
		source := node.IALAttr(treenode.TagCreatedAttr)
		if cached := sql.GetBlockAttrs(id)[treenode.TagCreatedAttr]; cached != source {
			t.Fatalf("block attributes %s differ from source %s", cached, source)
		}
		return readTagDates(source)
	}
	change := func(tags string) *Operation {
		data, _ := json.Marshal(map[string]string{"tags": tags})
		return &Operation{Action: "setAttrs", ID: tree.ID, Data: string(data)}
	}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{change("A,B,C,project/new")}, UndoOperations: []*Operation{change("A,B,C")}}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	dates := read(tree.ID)
	if len(dates) != 1 || dates["project/new"] <= 0 {
		t.Fatalf("only the new association should have a date: %v", dates)
	}
	for index, operations := range [][]*Operation{tx.UndoOperations, tx.DoOperations} {
		if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(operations)}); err != nil {
			t.Fatal(err)
		}
		got := read(tree.ID)
		if index == 0 && len(got) != 0 || index == 1 && !maps.Equal(got, dates) {
			t.Fatalf("replay %d changed association dates: %v", index, got)
		}
	}
	rename, err := RenameTagWithTransaction("project", "active")
	if err != nil {
		t.Fatal(err)
	}
	if got := read(tree.ID); len(got) != 1 || got["active/new"] != dates["project/new"] {
		t.Fatalf("rename changed association dates: %v", got)
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(rename.UndoOperations)}); err != nil || !maps.Equal(read(tree.ID), dates) {
		t.Fatalf("undo rename failed: %v", err)
	}

	stored, err := LoadTreeByBlockID(tree.ID)
	if err != nil {
		t.Fatal(err)
	}
	old := stored.Root.FirstChild
	engine := util.NewLute()
	previousDOM := engine.RenderNodeBlockDOM(old)
	old.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "inline"})
	update := &Transaction{fromAPI: true,
		DoOperations:   []*Operation{{Action: "update", ID: old.ID, Data: engine.RenderNodeBlockDOM(old)}},
		UndoOperations: []*Operation{{Action: "update", ID: old.ID, Data: previousDOM}}}
	if err = PerformTxSync(update); err != nil || read(old.ID)["inline"] <= 0 {
		t.Fatalf("inline addition was not recorded: %v", err)
	}
	for _, operations := range [][]*Operation{update.UndoOperations, update.DoOperations} {
		if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(operations)}); err != nil {
			t.Fatal(err)
		}
	}
	if read(old.ID)["inline"] <= 0 {
		t.Fatal("redo lost the inline addition date")
	}
	copied := treenode.NewParagraph(ast.NewNodeID())
	copied.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "inline"})
	setTagDates(copied, tagDates{"inline": 1})
	insert := &Transaction{fromAPI: true,
		DoOperations:   []*Operation{{Action: "insert", ID: copied.ID, ParentID: tree.ID, Data: engine.RenderNodeBlockDOM(copied)}},
		UndoOperations: []*Operation{{Action: "delete", ID: copied.ID}}}
	if err = PerformTxSync(insert); err != nil {
		t.Fatal(err)
	}
	copiedAt := read(copied.ID)["inline"]
	if copiedAt <= 1 {
		t.Fatal("copy inherited the source date")
	}
	for _, operations := range [][]*Operation{insert.UndoOperations, insert.DoOperations} {
		if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(operations)}); err != nil {
			t.Fatal(err)
		}
	}
	if read(copied.ID)["inline"] != copiedAt {
		t.Fatal("redo did not restore the recorded copy date")
	}
}

func TestTagCreatedSortUsesVisibleAssociationsAfterIndexRebuild(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	sources := []struct {
		id, tags string
		dates    tagDates
	}{
		{fixture.sourceID, "z/group,a,old", tagDates{"z/group": 10, "a": 20}},
		{fixture.targetID, "z/group,private", tagDates{"z/group": 40, "private": 30}},
	}
	boxes := map[string]string{}
	paths := map[string]string{}
	for _, source := range sources {
		tree, err := LoadTreeByBlockID(source.id)
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr("tags", source.tags)
		setTagDates(tree.Root, source.dates)
		if err = indexWriteTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
		boxes[source.id], paths[source.id] = tree.Box, tree.Path
	}
	sql.FlushQueue()
	sql.InitDatabase(true)
	for _, source := range sources {
		loaded, _, err := filesys.LoadTreeSnapshot(boxes[source.id], paths[source.id], util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		sql.IndexTreeQueue(loaded)
		sql.FlushQueue()
	}
	labels := func(tags *Tags) []string {
		ret := make([]string, 0, len(*tags))
		for _, tag := range *tags {
			ret = append(ret, tag.Label)
		}
		return ret
	}
	all := BuildTags(true, "", util.SortModeTagCreatedDESC, nil)
	if got, want := labels(all), []string{"z", "private", "a", "old"}; !slices.Equal(got, want) {
		t.Fatalf("global sort = %v, want %v", got, want)
	}
	visible := BuildTags(true, "", util.SortModeTagCreatedDESC, func(_, path string) bool {
		return path == paths[fixture.sourceID]
	})
	if got, want := labels(visible), []string{"a", "z", "old"}; !slices.Equal(got, want) || (*visible)[1].Children[0].Count != 1 {
		t.Fatalf("visible sort or count failed: %v", got)
	}
}
