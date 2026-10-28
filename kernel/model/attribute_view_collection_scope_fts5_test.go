// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestBlockCollectionScopeLimitContract(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	ids := []string{fixture.sourceID}
	for range 33 {
		created, err := CreateDocByMdSync(fixture.box.ID, "/"+ast.NewNodeID()+".sy", "Scope", "", nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, created.ID)
	}
	save := func(source *av.AutomationBlockSource, enabled bool) error {
		t.Helper()
		current := readAttributeViewItemsTest(t, view.ID)
		current.Automations.Rules[0].BlockSource = source
		current.Automations.Rules[0].Enabled = enabled
		return PerformAttributeViewOperations([]*Operation{{Action: "setAttrViewAutomations", AvID: view.ID, Data: current.Automations}})
	}
	source := func(count int) *av.AutomationBlockSource {
		return &av.AutomationBlockSource{DocumentIDs: append([]string{}, ids[:count]...), Types: []string{"d"}, Tags: []string{"todo"}}
	}
	// 笔记本和文档合计计数，重复 ID 不额外占用名额。
	boundary := source(31)
	boundary.NotebookIDs = []string{fixture.box.ID, fixture.box.ID}
	if err := save(boundary, true); err != nil {
		t.Fatal("32 distinct scopes rejected", err)
	}
	before, _ := json.Marshal(readAttributeViewItemsTest(t, view.ID).Automations)
	for _, enabled := range []bool{false, true} {
		if err := save(source(33), enabled); err == nil {
			t.Fatal("33 new scopes accepted", enabled)
		}
		after, _ := json.Marshal(readAttributeViewItemsTest(t, view.ID).Automations)
		if !bytes.Equal(before, after) {
			t.Fatal("rejected scope changed saved rules")
		}
	}
	legacy := readAttributeViewItemsTest(t, view.ID)
	legacy.Automations.Rules[0].BlockSource = source(34)
	if err := av.SaveAttributeView(legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := PreviewAttributeViewCollection(view.ID, legacy.Automations.Rules[0].ID, 1); err != nil {
		t.Fatal("legacy scope preview rejected", err)
	}
	if err := save(source(34), true); err != nil {
		t.Fatal("unchanged legacy scope rejected", err)
	}
	if err := save(source(33), true); err != nil {
		t.Fatal("legacy scope could not be reduced while still above the limit", err)
	}
	replaced := source(33)
	replaced.DocumentIDs[32] = ids[33]
	if err := save(replaced, true); err == nil {
		t.Fatal("legacy oversized scope accepted a new document")
	}
	if err := PerformTxSync(blockCollectionTags(t, ids[0], "todo")); err != nil {
		t.Fatal("legacy scope stopped collecting", err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(ids[0]) == nil {
		t.Fatal("legacy scope lost its live collection behavior")
	}
	if err := save(source(32), true); err != nil {
		t.Fatal("legacy scope could not be reduced", err)
	}
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: []*Operation{{Action: "setAttrViewAutomations", AvID: view.ID, Data: legacy.Automations}}}); err != nil {
		t.Fatal("undo could not restore legacy scope", err)
	}
	if got := len(readAttributeViewItemsTest(t, view.ID).Automations.Rules[0].BlockSource.DocumentIDs); got != 34 {
		t.Fatal("undo truncated the legacy scope", got)
	}
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: []*Operation{{Action: "setAttrViewAutomations", AvID: view.ID,
		Data: &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{ID: legacy.Automations.Rules[0].ID, Name: "Collect", Trigger: "block", Enabled: true,
			BlockSource: source(32), Actions: legacy.Automations.Rules[0].Actions}}}}}}); err != nil {
		t.Fatal("redo could not reduce legacy scope", err)
	}
}

func TestBlockCollectionSelectedDocumentScope(t *testing.T) {
	ids := map[string]string{"parent": ast.NewNodeID(), "child": ast.NewNodeID(), "grand": ast.NewNodeID()}
	paths := strings.NewReplacer("parent", ids["parent"], "child", ids["child"], "grand", ids["grand"])
	for _, test := range []struct {
		name     string
		include  *bool
		depth    *int
		ids      []string
		box      string
		id, path string
		want     bool
	}{
		{"legacy self", nil, nil, []string{"parent"}, "", "parent", "/parent.sy", true},
		{"explicit self", new(true), new(0), []string{"parent"}, "", "parent", "/parent.sy", true},
		{"excluded self", new(false), nil, []string{"parent"}, "", "parent", "/parent.sy", false},
		{"zero depth empty", new(false), new(0), []string{"parent"}, "", "child", "/parent/child.sy", false},
		{"child", new(false), new(1), []string{"parent"}, "", "child", "/parent/child.sy", true},
		{"grandchild depth", new(false), new(1), []string{"parent"}, "", "grand", "/parent/child/grand.sy", false},
		{"unlimited", new(false), nil, []string{"parent"}, "", "grand", "/parent/child/grand.sy", true},
		{"overlap excluded scope first", new(false), new(1), []string{"child", "parent"}, "", "child", "/parent/child.sy", true},
		{"overlap ancestor first", new(false), new(1), []string{"parent", "child"}, "", "child", "/parent/child.sy", true},
		{"nested selected scope", new(false), new(1), []string{"parent", "child"}, "", "grand", "/parent/child/grand.sy", true},
		{"notebook union", new(false), new(0), []string{"parent"}, "box", "parent", "/parent.sy", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := &av.AutomationBlockSource{DocumentIDs: test.ids, DocumentDepth: test.depth, IncludeSelectedDocuments: test.include}
			source.DocumentIDs = make([]string, len(test.ids))
			for i, id := range test.ids {
				source.DocumentIDs[i] = ids[id]
			}
			if test.box != "" {
				source.NotebookIDs = []string{test.box}
			}
			root := &ast.Node{ID: ids[test.id], Type: ast.NodeDocument}
			paragraph := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeParagraph}
			root.AppendChild(paragraph)
			tree := &parse.Tree{ID: root.ID, Path: paths.Replace(test.path), Box: test.box, Root: root}
			matches := collectionMatches(source, tree)
			if collectionScopeMatches(source, tree) != test.want || matches[root.ID] != test.want || matches[paragraph.ID] != test.want {
				t.Fatalf("document and internal block inclusion = %v, want %v", matches, test.want)
			}
		})
	}
}

func TestBlockCollectionSelectedDocumentTransitionsAndReview(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	parent, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	child, err := CreateDocByMdSync(fixture.box.ID, strings.TrimSuffix(parent.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "Child", "Child content", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	ruleID := view.Automations.Rules[0].ID
	setInclude := func(include *bool) *Transaction {
		t.Helper()
		view = readAttributeViewItemsTest(t, view.ID)
		raw, err := json.Marshal(view.Automations)
		if err != nil {
			t.Fatal(err)
		}
		var previous av.AutomationConfig
		if err = json.Unmarshal(raw, &previous); err != nil {
			t.Fatal(err)
		}
		view.Automations.Spec = 7
		view.Automations.Rules[0].BlockSource.IncludeSelectedDocuments = include
		view.Automations.Rules[0].BlockSource.DocumentDepth = new(1)
		op := &Operation{Action: "setAttrViewAutomations", AvID: view.ID, Data: view.Automations}
		tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{{Action: "setAttrViewAutomations", AvID: view.ID, Data: &previous}}}
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		return tx
	}
	setInclude(new(false))
	for _, id := range []string{parent.ID, child.ID} {
		if err = PerformTxSync(blockCollectionTags(t, id, "todo")); err != nil {
			t.Fatal(err)
		}
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValueByBoundID(parent.ID) != nil || view.GetBlockValueByBoundID(child.ID) == nil {
		t.Fatal("live collection did not exclude self and retain child")
	}
	preview, err := PreviewAttributeViewCollection(view.ID, ruleID, 1)
	if err != nil || len(preview.Blocks) != 1 || preview.Blocks[0].ID != child.ID {
		t.Fatalf("excluding self preview: %+v %v", preview, err)
	}
	if err = PerformAttributeViewOperations([]*Operation{{Action: "collectAttrViewBlocks", AvID: view.ID,
		Data: map[string]any{"ruleID": ruleID, "blockIDs": []string{parent.ID}}}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(parent.ID) != nil {
		t.Fatal("explicit collection collected excluded parent")
	}
	change := setInclude(nil)
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValueByBoundID(parent.ID) != nil {
		t.Fatal("including self backfilled existing parent")
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(change.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if include := view.Automations.Rules[0].BlockSource.IncludeSelectedDocuments; include == nil || *include {
		t.Fatal("undo lost scope exclusion")
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(change.DoOperations)}); err != nil {
		t.Fatal(err)
	}
	if err = PerformAttributeViewOperations([]*Operation{{Action: "collectAttrViewBlocks", AvID: view.ID,
		Data: map[string]any{"ruleID": ruleID, "blockIDs": []string{parent.ID}}}}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	parentItem := view.GetBlockValueByBoundID(parent.ID).BlockID
	view.GetValue(keyID, parentItem).Text.Content = "Edited parent"
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	setInclude(new(false))
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetValue(keyID, parentItem).Text.Content != "Edited parent" {
		t.Fatal("scope exclusion changed existing fields")
	}
	review, err := ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Matched != 1 || review.Unmatched != 1 {
		t.Fatalf("exclusion review: %+v %v", review, err)
	}
	stale := collectionCleanupOperation(view.ID, review)
	setInclude(nil)
	if err = PerformAttributeViewOperations([]*Operation{stale}); err == nil {
		t.Fatal("inclusion change accepted stale cleanup")
	}
	setInclude(new(false))
	review, err = ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	op := collectionCleanupOperation(view.ID, review)
	cleanup := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{op}}
	if err = PerformTxSync(cleanup); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValue(parentItem) != nil || view.GetBlockValueByBoundID(child.ID) == nil {
		t.Fatal("cleanup removed the wrong entries")
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(cleanup.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetValue(keyID, parentItem).Text.Content != "Edited parent" {
		t.Fatal("cleanup undo lost original fields")
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(cleanup.DoOperations)}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValue(parentItem) != nil {
		t.Fatal("cleanup redo did not remove excluded parent")
	}
	created, err := CreateDocByMdSync(fixture.box.ID, strings.TrimSuffix(parent.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "New child", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(blockCollectionTags(t, created.ID, "todo")); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(created.ID) == nil {
		t.Fatal("new child was excluded with its parent")
	}
}

func TestBlockCollectionSelectedDocumentBlockMoves(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	parent, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	child, err := CreateDocByMdSync(fixture.box.ID, strings.TrimSuffix(parent.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "Child", "Child content", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	view.Automations.Spec = 7
	source := view.Automations.Rules[0].BlockSource
	source.IncludeSelectedDocuments, source.Tags, source.Types = new(false), nil, []string{"p"}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	blockID := parent.Root.FirstChild.ID
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "move", ID: blockID, ParentID: child.ID}}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(blockID) == nil {
		t.Fatal("move from excluded parent into child did not collect")
	}
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "move", ID: blockID, ParentID: parent.ID}}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(blockID) == nil {
		t.Fatal("move back into excluded parent removed existing entry")
	}
}
