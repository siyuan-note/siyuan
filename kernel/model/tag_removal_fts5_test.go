// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"encoding/json"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTagRemovalRejectsChangedSourceSnapshot(t *testing.T) {
	fixture, _, _ := setupBlockCollectionTest(t)
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	_, _, sources, err := tagRemovalTrees([]*apicontract.TagRemovalChange{{ID: fixture.sourceID, Tags: []string{"todo"}}})
	if err != nil {
		t.Fatal(err)
	}
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("custom-latest", "preserve")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	tx := blockCollectionTags(t, fixture.sourceID, "")
	tx.tagRemovalSources = sources
	if err = PerformTxSync(tx); err == nil {
		t.Fatalf("stale source accepted: %v", err)
	}
	stored, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil || stored.Root.IALAttr("custom-latest") != "preserve" || stored.Root.IALAttr("tags") != "todo" {
		t.Fatal("stale removal overwrote newer content", err)
	}
}

func TestTagRemovalContainerRetainsOtherSources(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	quote := &ast.Node{Type: ast.NodeBlockquote, ID: ast.NewNodeID()}
	quote.SetIALAttr("id", quote.ID)
	first, second := treenode.NewParagraph(ast.NewNodeID()), treenode.NewParagraph(ast.NewNodeID())
	quote.AppendChild(first)
	quote.AppendChild(second)
	tree.Root.AppendChild(quote)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	view.Automations.Spec = 4
	view.Automations.Rules[0].BlockSource.Types = []string{treenode.TypeAbbr(ast.NodeBlockquote.String())}
	view.Automations.Rules[0].BlockSource.TagTarget = "container"
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	old := util.NewLute().RenderNodeBlockDOM(quote)
	for _, paragraph := range []*ast.Node{first, second} {
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "todo"})
	}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: quote.ID, Data: util.NewLute().RenderNodeBlockDOM(quote)}}, UndoOperations: []*Operation{{Action: "update", ID: quote.ID, Data: old}}}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(quote.ID) == nil {
		t.Fatal("container was not collected")
	}
	changes := []*apicontract.TagRemovalChange{{ID: first.ID, Tags: []string{"todo"}}}
	groups, err := PreviewTagRemoval(apicontract.TagRemovalPreviewRequest{Changes: changes})
	if err != nil || len(groups) != 0 {
		t.Fatalf("remaining tag source was ignored: %+v %v", groups, err)
	}
	changes = append(changes, &apicontract.TagRemovalChange{ID: second.ID, Tags: []string{"todo"}})
	groups, err = PreviewTagRemoval(apicontract.TagRemovalPreviewRequest{Changes: changes})
	if err != nil || len(groups) != 1 || len(groups[0].Cleanup.Items) != 1 || groups[0].Cleanup.Items[0].BlockID != quote.ID {
		t.Fatalf("container preview: %+v %v", groups, err)
	}
	old = util.NewLute().RenderNodeBlockDOM(quote)
	first.FirstChild.TextMarkTextContent = "t"
	second.FirstChild.TextMarkTextContent = "other"
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: quote.ID, Data: util.NewLute().RenderNodeBlockDOM(quote)}}, UndoOperations: []*Operation{{Action: "update", ID: quote.ID, Data: old}}}); err != nil {
		t.Fatal(err)
	}
	groups, err = PreviewTagRemoval(apicontract.TagRemovalPreviewRequest{Changes: []*apicontract.TagRemovalChange{{ID: first.ID, Tags: []string{"t"}}}})
	if err != nil || len(groups) != 1 || len(groups[0].Cleanup.Items) != 1 || groups[0].Cleanup.Items[0].BlockID != quote.ID {
		t.Fatalf("renamed container source preview: %+v %v", groups, err)
	}
}

func TestTagRemovalPreviewAndAtomicUndo(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	row := view.GetBlockValueByBoundID(fixture.sourceID)
	itemID := row.BlockID
	view.GetValue(keyID, itemID).Text.Content = "Edited"
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	request := apicontract.TagRemovalPreviewRequest{Changes: []*apicontract.TagRemovalChange{{ID: fixture.sourceID, Tags: []string{"todo"}}}}
	groups, err := PreviewTagRemoval(request)
	if err != nil || len(groups) != 1 || len(groups[0].Cleanup.Items) != 1 || !groups[0].Cleanup.AutomaticOnly {
		t.Fatalf("preview: %+v, %v", groups, err)
	}
	tree, _ := LoadTreeByBlockID(fixture.sourceID)
	if tree.Root.IALAttr("tags") != "todo" || readAttributeViewItemsTest(t, view.ID).GetBlockValue(itemID) == nil {
		t.Fatal("preview modified source or entry")
	}
	tx := blockCollectionTags(t, fixture.sourceID, "")
	op := &Operation{Action: "cleanupAttrViewBlocks", AvID: view.ID, Data: groups[0].Cleanup}
	tx.DoOperations = append(tx.DoOperations, op)
	tx.UndoOperations = append(tx.UndoOperations, op)
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValue(itemID) != nil {
		t.Fatal("confirmed row was not removed")
	}
	undo := &Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations), UndoOperations: cloneOperations(tx.DoOperations)}
	if err = PerformTxSync(undo); err != nil {
		t.Fatal(err)
	}
	tree, _ = LoadTreeByBlockID(fixture.sourceID)
	view = readAttributeViewItemsTest(t, view.ID)
	if tree.Root.IALAttr("tags") != "todo" || view.GetBlockValue(itemID) == nil || view.GetValue(keyID, itemID).Text.Content != "Edited" {
		t.Fatal("undo did not restore tags, item identity and edited fields")
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(undo.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValue(itemID) != nil {
		t.Fatal("redo did not remove row")
	}
}

func TestTagRemovalAfterIncrementalRename(t *testing.T) {
	for _, mode := range []string{"automatic", "manual", "otherRule", "absentTag"} {
		t.Run(mode, func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
				t.Fatal(err)
			}
			for _, tag := range []string{"tod", "to", "t"} {
				if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, tag)); err != nil {
					t.Fatal(err)
				}
			}
			view = readAttributeViewItemsTest(t, view.ID)
			if mode == "manual" {
				view.GetBlockValueByBoundID(fixture.sourceID).Block.CollectionRuleID = ""
			}
			if mode == "otherRule" {
				rule := *view.Automations.Rules[0]
				rule.ID = ast.NewNodeID()
				source := *rule.BlockSource
				source.Tags = nil
				rule.BlockSource = &source
				view.Automations.Rules = append(view.Automations.Rules, &rule)
			}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			label := "t"
			if mode == "absentTag" {
				label = "todo"
			}
			groups, err := PreviewTagRemoval(apicontract.TagRemovalPreviewRequest{Changes: []*apicontract.TagRemovalChange{{ID: fixture.sourceID, Tags: []string{label}}}})
			if err != nil {
				t.Fatal(err)
			}
			if mode != "automatic" {
				if len(groups) != 0 {
					t.Fatal("protected entry appeared", groups)
				}
				return
			}
			if len(groups) != 1 || len(groups[0].Cleanup.Items) != 1 {
				t.Fatal("incrementally renamed tag did not offer cleanup", groups)
			}
			tx, err := RemoveTagWithCollections(apicontract.RemoveTagWithCollectionsRequest{Label: label, Collections: groups})
			if err != nil || tx == nil || readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.sourceID) != nil {
				t.Fatal("incrementally renamed tag cleanup failed", err)
			}
		})
	}
}

func TestTagRemovalPreservesManualAndOtherMatches(t *testing.T) {
	for _, mode := range []string{"manual", "otherRule", "orTag", "invalidRule", "alreadyUnmatched"} {
		t.Run(mode, func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo,other")); err != nil {
				t.Fatal(err)
			}
			view = readAttributeViewItemsTest(t, view.ID)
			switch mode {
			case "manual":
				view.GetBlockValueByBoundID(fixture.sourceID).Block.CollectionRuleID = ""
			case "otherRule", "invalidRule":
				rule := *view.Automations.Rules[0]
				rule.ID = ast.NewNodeID()
				source := *rule.BlockSource
				source.Tags = []string{"other"}
				if mode == "invalidRule" {
					source.Attributes = []*av.AutomationBlockAttribute{{Name: "[", NameOperator: "regex", Operator: "exists"}}
					view.Automations.Spec = 6
				}
				rule.BlockSource = &source
				view.Automations.Rules = append(view.Automations.Rules, &rule)
			case "orTag":
				view.Automations.Spec = 3
				view.Automations.Rules[0].BlockSource.Tags = []string{"todo", "other"}
				view.Automations.Rules[0].BlockSource.TagMatch = "or"
			case "alreadyUnmatched":
				if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "other")); err != nil {
					t.Fatal(err)
				}
			}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			groups, err := PreviewTagRemoval(apicontract.TagRemovalPreviewRequest{Changes: []*apicontract.TagRemovalChange{{ID: fixture.sourceID, Tags: []string{"todo"}}}})
			if err != nil || len(groups) != 0 {
				t.Fatalf("protected entries appeared: %+v, %v", groups, err)
			}
		})
	}
}

func TestTagRemovalRechecksAndRollsBack(t *testing.T) {
	for _, mode := range []string{"rulesChanged", "manual", "tagKept"} {
		t.Run(mode, func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
				t.Fatal(err)
			}
			groups, err := PreviewTagRemoval(apicontract.TagRemovalPreviewRequest{Changes: []*apicontract.TagRemovalChange{{ID: fixture.sourceID, Tags: []string{"todo"}}}})
			if err != nil || len(groups) != 1 {
				t.Fatalf("preview: %v", err)
			}
			view = readAttributeViewItemsTest(t, view.ID)
			if mode == "rulesChanged" {
				view.Automations.Rules[0].Name = "Changed"
			}
			if mode == "manual" {
				view.GetBlockValueByBoundID(fixture.sourceID).Block.CollectionRuleID = ""
			}
			if err = av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			tags := ""
			if mode == "tagKept" {
				tags = "todo"
			}
			tx := blockCollectionTags(t, fixture.sourceID, tags)
			op := &Operation{Action: "cleanupAttrViewBlocks", AvID: view.ID, Data: groups[0].Cleanup}
			tx.DoOperations = append(tx.DoOperations, op)
			tx.UndoOperations = append(tx.UndoOperations, op)
			err = PerformTxSync(tx)
			if (err != nil) != (mode == "rulesChanged") {
				t.Fatalf("commit: %v", err)
			}
			if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.sourceID) == nil {
				t.Fatal("recheck removed a protected entry")
			}
			if mode == "rulesChanged" {
				tree, _ := LoadTreeByBlockID(fixture.sourceID)
				if tree.Root.IALAttr("tags") != "todo" {
					t.Fatal("failure did not roll back tag deletion")
				}
			}
		})
	}
}

func TestGlobalTagRemovalSelectionAndUndo(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	secondData, _ := json.Marshal(view)
	var second av.AttributeView
	if err := json.Unmarshal(secondData, &second); err != nil {
		t.Fatal(err)
	}
	second.ID = ast.NewNodeID()
	if err := av.SaveAttributeView(&second); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	groups, err := PreviewTagRemoval(apicontract.TagRemovalPreviewRequest{Label: "todo"})
	if err != nil || len(groups) != 2 {
		t.Fatalf("global preview: %+v, %v", groups, err)
	}
	view = readAttributeViewItemsTest(t, groups[0].AvID)
	itemID := view.GetBlockValueByBoundID(fixture.sourceID).BlockID
	view.GetValue(keyID, itemID).Text.Content = "Retain on undo"
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	tx, err := RemoveTagWithCollections(apicontract.RemoveTagWithCollectionsRequest{Label: "todo", Collections: groups[:1]})
	if err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, groups[0].AvID).GetBlockValue(itemID) != nil || readAttributeViewItemsTest(t, groups[1].AvID).GetBlockValueByBoundID(fixture.sourceID) == nil {
		t.Fatal("selection affected wrong databases")
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, groups[0].AvID)
	tree, _ := LoadTreeByBlockID(fixture.sourceID)
	if view.GetValue(keyID, itemID).Text.Content != "Retain on undo" || tree.Root.IALAttr("tags") != "todo" {
		t.Fatal("global undo lost fields or tags")
	}
}

func TestGlobalTagRemovalInlineContentAndTitles(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	paragraph := treenode.NewParagraph(ast.NewNodeID())
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "review"})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "review-more"})
	callout := &ast.Node{Type: ast.NodeCallout, ID: ast.NewNodeID(), CalloutType: "NOTE", CalloutTitleExplicit: true, CalloutTitle: "#review# foo"}
	callout.SetIALAttr("id", callout.ID)
	callout.AppendChild(paragraph)
	tree.Root.AppendChild(callout)
	if err = writeTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.FlushQueue()
	tx, err := RemoveTagWithCollections(apicontract.RemoveTagWithCollectionsRequest{Label: "review"})
	if err != nil {
		t.Fatal(err)
	}
	for _, restore := range []bool{false, true} {
		if restore {
			if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
				t.Fatal(err)
			}
		}
		stored, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		var review, other int
		treenode.WalkWithInlineTitles(stored.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.Type == ast.NodeTextMark && node.IsTextMarkType("tag") {
				if node.TextMarkTextContent == "review" {
					review++
				}
				if node.TextMarkTextContent == "review-more" {
					other++
				}
			}
			return ast.WalkContinue
		})
		want := 0
		if restore {
			want = 2
		}
		if review != want || other != 1 {
			t.Fatalf("tags: review=%d other=%d restored=%v", review, other, restore)
		}
	}
}
