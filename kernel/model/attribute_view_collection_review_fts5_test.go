//go:build fts5

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func collectionCleanupOperation(viewID string, review *apicontract.AVCollectionReview) *Operation {
	items := []*apicontract.AVCollectionCleanupItem{}
	for _, item := range review.Items {
		items = append(items, &apicontract.AVCollectionCleanupItem{ItemID: item.ItemID, BlockID: item.BlockID})
	}
	return &Operation{Action: "cleanupAttrViewBlocks", AvID: viewID,
		Data: &apicontract.AVCollectionCleanup{RuleVersion: review.RuleVersion, Items: items}}
}

func TestBlockCollectionReviewCleanupAndUndo(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	autoID := view.GetBlockValueByBoundID(fixture.sourceID).BlockID
	view.GetValue(keyID, autoID).Text.Content = "Edited"
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "")); err != nil {
		t.Fatal(err)
	}
	if err := PerformAttributeViewOperations([]*Operation{{Action: "insertAttrViewBlock", AvID: view.ID,
		Srcs: []map[string]any{{"id": fixture.targetID, "isDetached": false}}}}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	manualID := view.GetBlockValueByBoundID(fixture.targetID).BlockID
	key := view.GetBlockKeyValues()
	detachedID := ast.NewNodeID()
	key.Values = append(key.Values, &av.Value{KeyID: key.Key.ID, BlockID: detachedID, Type: av.KeyTypeBlock,
		IsDetached: true, Block: &av.ValueBlock{Content: "Detached"}})
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	review, err := ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if review.Unmatched != 2 || review.Unknown != 1 || review.Matched != 0 {
		t.Fatalf("unexpected classification: %+v", review)
	}
	if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 3 {
		t.Fatal("review modified entries")
	}
	op := collectionCleanupOperation(view.ID, review)
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{op}}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValue(autoID) != nil || view.GetBlockValue(manualID) != nil || view.GetBlockValue(detachedID) == nil {
		t.Fatal("cleanup did not treat automatic/manual bindings equally or removed an unknown entry")
	}
	for _, id := range []string{fixture.sourceID, fixture.targetID} {
		if _, err = LoadTreeByBlockID(id); err != nil {
			t.Fatal("cleanup removed source content", err)
		}
	}
	undo := &Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations), UndoOperations: cloneOperations(tx.DoOperations)}
	if err = PerformTxSync(undo); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValue(autoID) == nil || view.GetBlockValue(manualID) == nil || view.GetValue(keyID, autoID).Text.Content != "Edited" {
		t.Fatal("undo did not restore original item IDs and manually edited fields")
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(undo.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValue(autoID) != nil {
		t.Fatal("redo did not replay confirmed removal")
	}
}

func TestBlockCollectionReviewUnionAndRecheck(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	if err := PerformAttributeViewOperations([]*Operation{{Action: "insertAttrViewBlock", AvID: view.ID,
		Srcs: []map[string]any{{"id": fixture.sourceID, "isDetached": false}, {"id": fixture.targetID, "isDetached": false}}}}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	first := view.Automations.Rules[0]
	view.Automations.Rules = append(view.Automations.Rules, &av.AutomationRule{ID: ast.NewNodeID(), Enabled: true, Trigger: "block",
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{fixture.targetID}, Types: []string{"d"}}, Actions: first.Actions})
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	review, err := ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Matched != 1 || review.Unmatched != 1 {
		t.Fatalf("enabled rule union: %+v %v", review, err)
	}
	if err = PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	op := collectionCleanupOperation(view.ID, review)
	if err = PerformAttributeViewOperations([]*Operation{op}); err != nil {
		t.Fatal(err)
	}
	if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 2 {
		t.Fatal("cleanup ignored a newer match or another rule")
	}
	view = readAttributeViewItemsTest(t, view.ID)
	view.Automations.Rules[0].Name = "Changed since review"
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err = PerformAttributeViewOperations([]*Operation{op}); err == nil {
		t.Fatal("stale rule snapshot was accepted")
	}
	for _, rule := range view.Automations.Rules {
		rule.Enabled = false
	}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	review, err = ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Unknown != 2 || review.Unmatched != 0 {
		t.Fatalf("no enabled rules must remain indeterminate: %+v %v", review, err)
	}
	for _, item := range review.Items {
		if item.Reason != "noRules" {
			t.Fatalf("missing disabled-rule reason: %+v", item)
		}
	}
}

func TestBlockCollectionReviewBindingAndUnavailableSource(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	if err := PerformAttributeViewOperations([]*Operation{{Action: "insertAttrViewBlock", AvID: view.ID,
		Srcs: []map[string]any{{"id": fixture.sourceID, "isDetached": false}}}}); err != nil {
		t.Fatal(err)
	}
	review, err := ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Unmatched != 1 {
		t.Fatalf("initial review: %+v %v", review, err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	row := view.GetBlockValueByBoundID(fixture.sourceID)
	row.Block.ID = fixture.targetID
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err = PerformAttributeViewOperations([]*Operation{collectionCleanupOperation(view.ID, review)}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValue(row.BlockID) == nil {
		t.Fatal("cleanup removed an entry rebound after preview")
	}
	view.GetBlockValue(row.BlockID).Block.ID = ast.NewNodeID()
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	review, err = ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Unknown != 1 || review.Unmatched != 0 || review.Items[0].Reason != "unavailable" {
		t.Fatalf("unavailable source must remain indeterminate: %+v %v", review, err)
	}
}

func TestBlockCollectionReviewClassifiedPagination(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	view.Automations.Rules[0].BlockSource.Types = []string{"p"}
	key := view.GetBlockKeyValues()
	for i := 0; i < 202; i++ {
		node := treenode.NewParagraph("")
		if i%2 == 0 {
			node.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "todo"})
		}
		tree.Root.AppendChild(node)
		key.Values = append(key.Values, &av.Value{KeyID: key.Key.ID, BlockID: ast.NewNodeID(), Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: node.ID, Content: "Entry"}})
	}
	for i := 0; i < 3; i++ {
		key.Values = append(key.Values, &av.Value{KeyID: key.Key.ID, BlockID: ast.NewNodeID(), Type: av.KeyTypeBlock,
			IsDetached: true, Block: &av.ValueBlock{Content: "Detached"}})
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"", "matched", "unmatched", "unknown"} {
		for _, page := range []int{0, 1, 2, 3, int(^uint(0) >> 1)} {
			review, reviewErr := ReviewAttributeViewCollection(view.ID, page, status)
			if reviewErr != nil || review.Matched != 101 || review.Unmatched != 101 || review.Unknown != 3 {
				t.Fatalf("global counts changed for %s page %d: %+v %v", status, page, review, reviewErr)
			}
			count := 101
			if status == "" {
				count = 205
			}
			if status == "unknown" {
				count = 3
			}
			current := max(1, page)
			expected := 0
			if current <= 3 {
				expected = max(0, min(100, count-(current-1)*100))
			}
			if len(review.Items) != expected || review.HasMore != (current <= count/100 && count > current*100) {
				t.Fatalf("%s page %d: %d items, hasMore=%v", status, page, len(review.Items), review.HasMore)
			}
			for _, item := range review.Items {
				if status != "" && item.Status != status {
					t.Fatalf("unexpected category: %+v", item)
				}
				if item.Status == "unknown" && (item.Reason != "detached" || !item.IsDetached) {
					t.Fatalf("missing reason: %+v", item)
				}
			}
		}
	}
	if _, err = ReviewAttributeViewCollection(view.ID, 1, "invalid"); err == nil {
		t.Fatal("invalid category was accepted")
	}
}

func TestBlockCollectionReviewInvalidRulesAndPagination(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	if err := PerformAttributeViewOperations([]*Operation{{Action: "insertAttrViewBlock", AvID: view.ID,
		Srcs: []map[string]any{{"id": fixture.sourceID, "isDetached": false}}}}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	view.Automations.Rules = append(view.Automations.Rules, &av.AutomationRule{ID: ast.NewNodeID(), Enabled: true, Trigger: "block"})
	key := view.GetBlockKeyValues()
	for i := 0; i < 100; i++ {
		key.Values = append(key.Values, &av.Value{KeyID: key.Key.ID, BlockID: ast.NewNodeID(), Type: av.KeyTypeBlock,
			IsDetached: true, Block: &av.ValueBlock{Content: "Detached"}})
	}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	for _, page := range []int{0, 1, 2, 3, int(^uint(0) >> 1)} {
		review, err := ReviewAttributeViewCollection(view.ID, page, "")
		if err != nil || review.Unknown != 101 || review.Unmatched != 0 || review.Matched != 0 {
			t.Fatalf("invalid rules must preserve uncertain entries: %+v %v", review, err)
		}
		expected, more := 0, false
		if page <= 1 {
			expected, more = 100, true
		} else if page == 2 {
			expected = 1
		}
		if len(review.Items) != expected || review.HasMore != more {
			t.Fatalf("page %d returned %d items, hasMore=%v", page, len(review.Items), review.HasMore)
		}
		for _, item := range review.Items {
			if item.IsDetached && item.Reason != "detached" || !item.IsDetached && item.Reason != "invalidRule" {
				t.Fatalf("missing indeterminate reason: %+v", item)
			}
		}
	}
}

func TestBlockCollectionReviewCleanupRollback(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "todo")); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	itemID := view.GetBlockValueByBoundID(fixture.sourceID).BlockID
	view.GetValue(keyID, itemID).Text.Content = "Keep on rollback"
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(blockCollectionTags(t, fixture.sourceID, "")); err != nil {
		t.Fatal(err)
	}
	review, err := ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Unmatched != 1 {
		t.Fatalf("review before rollback: %+v %v", review, err)
	}
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{collectionCleanupOperation(view.ID, review),
		{Action: "setAttrs", ID: ast.NewNodeID(), Data: `{"custom-state":"active"}`}}}); err == nil {
		t.Fatal("invalid follow-up operation did not fail")
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValue(itemID) == nil || view.GetValue(keyID, itemID).Text.Content != "Keep on rollback" {
		t.Fatal("failed cleanup transaction lost the original entry or fields")
	}
}
