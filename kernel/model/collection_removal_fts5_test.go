// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func collectionRemovalDOM(id, content string) string {
	return fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">%s</div></div>`, id, content)
}

func collectionRemovalReference(id string) string {
	return fmt.Sprintf(`<span data-type="block-ref" data-id="%s" data-subtype="d">Target</span>`, id)
}

func collectionRemovalUpdate(t *testing.T, id, content string) *Transaction {
	t.Helper()
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.GetNodeInTree(tree, id)
	if node == nil {
		t.Fatal("missing source block", id)
	}
	return &Transaction{fromAPI: true,
		DoOperations:   []*Operation{{Action: "update", ID: id, Data: collectionRemovalDOM(id, content)}},
		UndoOperations: []*Operation{{Action: "update", ID: id, Data: util.NewLute().RenderNodeBlockDOM(node)}},
	}
}

func setupCollectionRemovalTest(t *testing.T) (*fileOperationTestFixture, *av.AttributeView, string) {
	t.Helper()
	fixture, view, keyID := setupBlockCollectionTest(t)
	view.Automations.Spec = 8
	view.Automations.Rules[0].BlockSource = &av.AutomationBlockSource{
		DocumentIDs: []string{fixture.sourceID}, ReferenceID: fixture.targetID,
	}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(collectionRemovalUpdate(t, fixture.childID, "Source "+collectionRemovalReference(fixture.targetID))); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValueByBoundID(fixture.childID) == nil {
		t.Fatal("reference fixture was not collected")
	}
	return fixture, view, keyID
}

func appendCollectionRemovalCleanup(tx *Transaction, groups []*apicontract.TagRemovalCollection) {
	for _, group := range groups {
		op := &Operation{Action: "cleanupAttrViewBlocks", AvID: group.AvID, Data: group.Cleanup}
		tx.DoOperations = append(tx.DoOperations, op)
		tx.UndoOperations = append(tx.UndoOperations, op)
	}
}

func collectionRemovalGroups(operations []*Operation, tags []*apicontract.TagRemovalChange) ([]*apicontract.TagRemovalCollection, error) {
	return collectionRemovalPreviewTransaction(&Transaction{DoOperations: operations}, tags)
}

func collectionRemovalPreviewTransaction(tx *Transaction, tags []*apicontract.TagRemovalChange) ([]*apicontract.TagRemovalCollection, error) {
	preview, err := PreviewCollectionRemoval(tx.DoOperations, tags)
	if err != nil {
		return nil, err
	}
	tx.CollectionRemovalSourceVersions = preview.SourceVersions
	return preview.Collections, nil
}

func collectionRemovalFile(t *testing.T, filename string) []byte {
	t.Helper()
	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestCollectionRemovalPreviewAndAtomicReplay(t *testing.T) {
	fixture, view, keyID := setupCollectionRemovalTest(t)
	itemID := view.GetBlockValueByBoundID(fixture.childID).BlockID
	view.GetValue(keyID, itemID).Text.Content = "Edited field"
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	docPath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	viewPath, _ := view.StoragePath()
	beforeDoc, beforeView := collectionRemovalFile(t, docPath), collectionRemovalFile(t, viewPath)
	tx := collectionRemovalUpdate(t, fixture.childID, "Source without reference")
	groups, err := collectionRemovalPreviewTransaction(tx, nil)
	if err != nil || len(groups) != 1 || groups[0].AvID != view.ID || len(groups[0].Cleanup.Items) != 1 {
		t.Fatalf("preview: %+v, %v", groups, err)
	}
	cleanup := groups[0].Cleanup
	hash := sha256.Sum256(beforeDoc)
	if !cleanup.AutomaticOnly || cleanup.Items[0].ItemID != itemID || cleanup.Items[0].BlockID != fixture.childID ||
		tx.CollectionRemovalSourceVersions[fixture.sourceID] != hex.EncodeToString(hash[:]) {
		t.Fatalf("preview did not bind the exact automatic row and authenticated source: %+v", cleanup)
	}
	if !bytes.Equal(beforeDoc, collectionRemovalFile(t, docPath)) || !bytes.Equal(beforeView, collectionRemovalFile(t, viewPath)) {
		t.Fatal("preview modified the source or database")
	}
	appendCollectionRemovalCleanup(tx, groups)
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValue(itemID) != nil {
		t.Fatal("confirmed row was retained")
	}
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil || len(collectionBlockReferences(tree)[fixture.childID]) != 0 {
		t.Fatal("reference removal did not commit", err)
	}
	undo := &Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations), UndoOperations: cloneOperations(tx.DoOperations)}
	if err = PerformTxSync(undo); err != nil {
		t.Fatal(err)
	}
	tree, err = LoadTreeByBlockID(fixture.sourceID)
	view = readAttributeViewItemsTest(t, view.ID)
	if err != nil || !collectionBlockReferences(tree)[fixture.childID][fixture.targetID] || view.GetBlockValue(itemID) == nil ||
		view.GetValue(keyID, itemID).Text.Content != "Edited field" {
		t.Fatal("undo lost the reference, row identity or edited fields", err)
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(undo.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValue(itemID) != nil {
		t.Fatal("redo did not remove the original row")
	}
}

func TestCollectionRemovalProtectsRemainingMatches(t *testing.T) {
	for _, mode := range []string{"duplicate", "otherRule", "manual", "detached", "unknownRule", "missingTarget", "wholeBlock", "anchorOnly", "sameDocumentTarget", "differentTarget"} {
		t.Run(mode, func(t *testing.T) {
			fixture, view, _ := setupCollectionRemovalTest(t)
			content := "Source without reference"
			switch mode {
			case "duplicate":
				ref := collectionRemovalReference(fixture.targetID)
				if err := PerformTxSync(collectionRemovalUpdate(t, fixture.childID, "Source "+ref+ref)); err != nil {
					t.Fatal(err)
				}
				view = readAttributeViewItemsTest(t, view.ID)
				content = "Source " + ref
			case "otherRule", "unknownRule":
				rule := *view.Automations.Rules[0]
				rule.ID = ast.NewNodeID()
				rule.BlockSource = &av.AutomationBlockSource{DocumentIDs: []string{fixture.sourceID}, Types: []string{"p"}}
				if mode == "unknownRule" {
					rule.BlockSource.Attributes = []*av.AutomationBlockAttribute{{Name: "[", NameOperator: "regex", Operator: "exists"}}
				}
				view.Automations.Rules = append(view.Automations.Rules, &rule)
			case "manual":
				view.GetBlockValueByBoundID(fixture.childID).Block.CollectionRuleID = ""
			case "detached":
				view.GetBlockValueByBoundID(fixture.childID).IsDetached = true
			case "missingTarget":
				treenode.RemoveBlockTreesByRootID(fixture.box.ID, fixture.targetID)
			case "anchorOnly":
				content = fmt.Sprintf(`Source <span data-type="block-ref" data-id="%s" data-subtype="s">Renamed anchor</span>`, fixture.targetID)
			case "sameDocumentTarget":
				target, err := LoadTreeByBlockID(fixture.targetID)
				if err != nil {
					t.Fatal(err)
				}
				content = "Source " + collectionRemovalReference(target.Root.FirstChild.ID)
			case "differentTarget":
				content = "Source " + collectionRemovalReference(fixture.sourceID)
			}
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			tx := collectionRemovalUpdate(t, fixture.childID, content)
			if mode == "wholeBlock" {
				tx.DoOperations = []*Operation{{Action: "delete", ID: fixture.childID}}
			}
			groups, err := collectionRemovalPreviewTransaction(tx, nil)
			want := 0
			if mode == "differentTarget" {
				want = 1
			}
			if err != nil || len(groups) != want {
				t.Fatalf("preview should contain %d groups: %+v, %v", want, groups, err)
			}
		})
	}
}

func TestCollectionRemovalUsesFinalTransactionState(t *testing.T) {
	fixture, view, _ := setupCollectionRemovalTest(t)
	remove := collectionRemovalUpdate(t, fixture.childID, "Source without reference")
	restore := &Operation{Action: "update", ID: fixture.childID,
		Data: collectionRemovalDOM(fixture.childID, "Source "+collectionRemovalReference(fixture.targetID))}
	groups, err := collectionRemovalGroups(append(remove.DoOperations, restore), nil)
	if err != nil || len(groups) != 0 {
		t.Fatalf("intermediate mismatch escaped the final transaction: %+v, %v", groups, err)
	}
	groups, err = collectionRemovalGroups(append([]*Operation{restore}, remove.DoOperations...), nil)
	if err != nil || len(groups) != 1 || groups[0].AvID != view.ID {
		t.Fatalf("final mismatch was missed: %+v, %v", groups, err)
	}
}

func TestCollectionRemovalMapsBacklinkParents(t *testing.T) {
	for _, typ := range []ast.NodeType{ast.NodeBlockquote, ast.NodeHeading} {
		t.Run(typ.String(), func(t *testing.T) {
			fixture, view, _ := setupBlockCollectionTest(t)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			parent := &ast.Node{Type: typ, ID: ast.NewNodeID(), HeadingLevel: 1}
			parent.SetIALAttr("id", parent.ID)
			first, second := collectionTestReference(fixture.targetID, true), collectionTestReference(fixture.targetID, false)
			first.FirstChild.Unlink()
			second.LastChild.Unlink()
			tree.Root.AppendChild(parent)
			if typ == ast.NodeHeading {
				parent.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Heading")})
				tree.Root.AppendChild(first)
				tree.Root.AppendChild(second)
			} else {
				parent.AppendChild(first)
				parent.AppendChild(second)
			}
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			view.Automations.Spec = 8
			view.Automations.Rules[0].BlockSource = &av.AutomationBlockSource{DocumentIDs: []string{fixture.sourceID}, ReferenceID: fixture.targetID}
			if err = av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			insert := collectionRemovalUpdate(t, first.ID, collectionRemovalReference(fixture.targetID))
			insert.DoOperations = append(insert.DoOperations, collectionRemovalUpdate(t, second.ID, "Source "+collectionRemovalReference(fixture.targetID)).DoOperations...)
			if err = PerformTxSync(insert); err != nil {
				t.Fatal(err)
			}
			view = readAttributeViewItemsTest(t, view.ID)
			if view.GetBlockValueByBoundID(parent.ID) == nil {
				t.Fatal("backlink parent fixture was not collected")
			}
			removeSecond := collectionRemovalUpdate(t, second.ID, "Source")
			groups, err := collectionRemovalGroups(removeSecond.DoOperations, nil)
			if err != nil || len(groups) != 0 {
				t.Fatalf("another parent source still matches: %+v, %v", groups, err)
			}
			removeFirst := collectionRemovalUpdate(t, first.ID, "Removed")
			groups, err = collectionRemovalGroups(append(removeSecond.DoOperations, removeFirst.DoOperations...), nil)
			if err != nil || len(groups) != 1 || len(groups[0].Cleanup.Items) != 1 || groups[0].Cleanup.Items[0].BlockID != parent.ID {
				t.Fatalf("last parent source removal: %+v, %v", groups, err)
			}
		})
	}
}

func TestCollectionRemovalDeduplicatesTagsAndReferences(t *testing.T) {
	fixture, view, _ := setupCollectionRemovalTest(t)
	view.Automations.Rules[0].BlockSource.Tags = []string{"todo"}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	content := `Source <span data-type="tag">todo</span> ` + collectionRemovalReference(fixture.targetID)
	if err := PerformTxSync(collectionRemovalUpdate(t, fixture.childID, content)); err != nil {
		t.Fatal(err)
	}
	tx := collectionRemovalUpdate(t, fixture.childID, "Source")
	changes := []*apicontract.TagRemovalChange{{ID: fixture.childID, Tags: []string{"todo", "todo"}}}
	groups, err := collectionRemovalPreviewTransaction(tx, changes)
	if err != nil || len(groups) != 1 || len(groups[0].Cleanup.Items) != 1 || groups[0].Cleanup.Items[0].BlockID != fixture.childID {
		t.Fatalf("mixed removal duplicated or missed the row: %+v, %v", groups, err)
	}
}

func TestCollectionRemovalLimitsRenamedTagsToChangedSources(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	second := treenode.NewParagraph(ast.NewNodeID())
	tree.Root.AppendChild(second)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	view.Automations.Rules[0].BlockSource.Types = []string{"p"}
	view.Automations.Rules[0].BlockSource.Tags = []string{"y"}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	for _, label := range []string{"y", "x"} {
		for _, id := range []string{fixture.childID, second.ID} {
			if err = PerformTxSync(collectionRemovalUpdate(t, id, `Source <span data-type="tag">`+label+`</span>`)); err != nil {
				t.Fatal(err)
			}
		}
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValueByBoundID(fixture.childID) == nil || view.GetBlockValueByBoundID(second.ID) == nil {
		t.Fatal("renamed tag fixture did not preserve both automatic rows")
	}
	tx := collectionRemovalUpdate(t, fixture.childID, "Source")
	groups, err := collectionRemovalPreviewTransaction(tx, []*apicontract.TagRemovalChange{{ID: fixture.childID, Tags: []string{"x"}}})
	if err != nil || len(groups) != 1 || len(groups[0].Cleanup.Items) != 1 || groups[0].Cleanup.Items[0].BlockID != fixture.childID {
		t.Fatalf("renamed tag cleanup escaped its changed source: %+v, %v", groups, err)
	}
}

func TestCollectionRemovalRechecksConfirmation(t *testing.T) {
	for _, mode := range []string{"sourceChanged", "rulesChanged", "manual", "referenceKept", "unknownTarget"} {
		t.Run(mode, func(t *testing.T) {
			fixture, view, _ := setupCollectionRemovalTest(t)
			tx := collectionRemovalUpdate(t, fixture.childID, "Source")
			groups, err := collectionRemovalPreviewTransaction(tx, nil)
			if err != nil || len(groups) != 1 {
				t.Fatalf("preview: %+v, %v", groups, err)
			}
			appendCollectionRemovalCleanup(tx, groups)
			switch mode {
			case "sourceChanged":
				tree, readErr := LoadTreeByBlockID(fixture.sourceID)
				if readErr != nil {
					t.Fatal(readErr)
				}
				tree.Root.SetIALAttr("custom-latest", "Preserve")
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
			case "rulesChanged":
				view.Automations.Rules[0].Name = "Changed after confirmation"
			case "manual":
				view.GetBlockValueByBoundID(fixture.childID).Block.CollectionRuleID = ""
			case "referenceKept":
				tx.DoOperations[0].Data = collectionRemovalDOM(fixture.childID, "Source "+collectionRemovalReference(fixture.targetID))
			case "unknownTarget":
				treenode.RemoveBlockTreesByRootID(fixture.box.ID, fixture.targetID)
			}
			if err = av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			docPath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
			beforeDoc := collectionRemovalFile(t, docPath)
			err = PerformTxSync(tx)
			mustReject := mode == "sourceChanged" || mode == "rulesChanged"
			if mustReject && err == nil {
				t.Fatal("stale confirmation committed")
			}
			if !mustReject && mode != "unknownTarget" && err != nil {
				t.Fatal(err)
			}
			if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(fixture.childID) == nil {
				t.Fatal("confirmation recheck removed a protected row")
			}
			if mustReject && !bytes.Equal(beforeDoc, collectionRemovalFile(t, docPath)) {
				t.Fatal("rejected cleanup changed source bytes")
			}
		})
	}
}

func TestCollectionRemovalRechecksDeletedOperationSources(t *testing.T) {
	for _, mode := range []string{"changedDocument", "missingDocumentIndex"} {
		t.Run(mode, func(t *testing.T) {
			fixture, view, _ := setupCollectionRemovalTest(t)
			target, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			deleted := target.Root.FirstChild
			tx := collectionRemovalUpdate(t, fixture.childID, "Source")
			tx.DoOperations = append(tx.DoOperations, &Operation{Action: "delete", ID: deleted.ID})
			groups, err := collectionRemovalPreviewTransaction(tx, nil)
			if err != nil || len(groups) != 1 || len(tx.CollectionRemovalSourceVersions) != 2 || tx.CollectionRemovalSourceVersions[target.ID] == "" {
				t.Fatalf("preview did not watch both operation sources: %+v, %v", groups, err)
			}
			appendCollectionRemovalCleanup(tx, groups)
			deleted.Unlink()
			target.Root.SetIALAttr("custom-latest", "Preserve concurrent target edit")
			if _, err = filesys.WriteTree(target); err != nil {
				t.Fatal(err)
			}
			treenode.RemoveBlockTreesByRootID(target.Box, target.ID)
			if mode == "changedDocument" {
				treenode.UpsertBlockTree(target)
			}
			if treenode.GetBlockTree(deleted.ID) != nil {
				t.Fatal("deleted target is still indexed")
			}
			sourcePath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
			targetPath := filepath.Join(util.DataDir, target.Box, target.Path)
			viewPath, _ := view.StoragePath()
			beforeSource, beforeTarget := collectionRemovalFile(t, sourcePath), collectionRemovalFile(t, targetPath)
			beforeView := collectionRemovalFile(t, viewPath)
			if err = PerformTxSync(tx); err == nil {
				t.Fatal("missing delete target bypassed its document snapshot check")
			}
			if !bytes.Equal(beforeSource, collectionRemovalFile(t, sourcePath)) || !bytes.Equal(beforeTarget, collectionRemovalFile(t, targetPath)) ||
				!bytes.Equal(beforeView, collectionRemovalFile(t, viewPath)) {
				t.Fatal("stale multi-document cleanup changed documents or database")
			}
		})
	}
}

func TestCollectionRemovalWithoutCandidatesKeepsSourceVersions(t *testing.T) {
	for _, mode := range []string{"unchanged", "changed", "missingSourceIndex"} {
		t.Run(mode, func(t *testing.T) {
			fixture, view, _ := setupCollectionRemovalTest(t)
			tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "delete", ID: fixture.childID}}}
			preview, err := PreviewCollectionRemoval(tx.DoOperations, nil)
			if err != nil || len(preview.Collections) != 0 || len(preview.SourceVersions) != 1 || preview.SourceVersions[fixture.sourceID] == "" {
				t.Fatalf("no-candidate preview lost source protection: %+v, %v", preview, err)
			}
			tx.CollectionRemovalSourceVersions = preview.SourceVersions
			sourcePath := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
			if mode == "unchanged" {
				if err = PerformTxSync(tx); err != nil {
					t.Fatal("valid source-only transaction was rejected", err)
				}
				return
			}
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			tree.Root.SetIALAttr("custom-latest", "Preserve no-candidate update")
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			if mode == "missingSourceIndex" {
				treenode.RemoveBlockTreesByRootID(tree.Box, tree.ID)
			}
			viewPath, _ := view.StoragePath()
			beforeDoc, beforeView := collectionRemovalFile(t, sourcePath), collectionRemovalFile(t, viewPath)
			if err = PerformTxSync(tx); err == nil {
				t.Fatal("source-only transaction accepted a stale confirmation")
			}
			if !bytes.Equal(beforeDoc, collectionRemovalFile(t, sourcePath)) || !bytes.Equal(beforeView, collectionRemovalFile(t, viewPath)) {
				t.Fatal("rejected source-only transaction changed stored bytes")
			}
		})
	}
}

func TestCollectionRemovalPreservesUnknownTargetAfterContainerUpdate(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	container := &ast.Node{Type: ast.NodeBlockquote, ID: ast.NewNodeID()}
	container.SetIALAttr("id", container.ID)
	target, source := treenode.NewParagraph(ast.NewNodeID()), treenode.NewParagraph(ast.NewNodeID())
	target.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Target")})
	source.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Source")})
	container.AppendChild(target)
	container.AppendChild(source)
	tree.Root.AppendChild(container)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	view.Automations.Spec = 8
	view.Automations.Rules[0].BlockSource = &av.AutomationBlockSource{DocumentIDs: []string{fixture.sourceID}, ReferenceID: target.ID}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(collectionRemovalUpdate(t, source.ID, "Source "+collectionRemovalReference(target.ID))); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValueByBoundID(container.ID) == nil {
		t.Fatal("container fixture was not collected")
	}
	tree, err = LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	container = treenode.GetNodeInTree(tree, container.ID)
	treenode.GetNodeInTree(tree, target.ID).Unlink()
	source = treenode.GetNodeInTree(tree, source.ID)
	for source.FirstChild != nil {
		source.FirstChild.Unlink()
	}
	source.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Source")})
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: container.ID, Data: util.NewLute().RenderNodeBlockDOM(container)}}}
	groups, err := collectionRemovalPreviewTransaction(tx, nil)
	if err != nil || len(groups) != 0 {
		t.Fatalf("unknown target was treated as a proven mismatch: %+v, %v", groups, err)
	}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(container.ID) == nil {
		t.Fatal("container update discarded the unknown row")
	}
}

type collectionRemovalBindingTest struct {
	fixture *fileOperationTestFixture
	view    *av.AttributeView
	keyID   string
	blockID string
	itemID  string
	tx      *Transaction
	changes []*apicontract.TagRemovalChange
}

func setupCollectionRemovalBindingTest(t *testing.T, source string, attribute *av.AutomationBlockAttribute, enabled bool) *collectionRemovalBindingTest {
	t.Helper()
	ret := &collectionRemovalBindingTest{}
	if source == "reference" {
		ret.fixture, ret.view, ret.keyID = setupCollectionRemovalTest(t)
		ret.blockID = ret.fixture.childID
	} else {
		ret.fixture, ret.view, ret.keyID = setupBlockCollectionTest(t)
		ret.blockID = ret.fixture.sourceID
		if err := PerformTxSync(blockCollectionTags(t, ret.blockID, "todo")); err != nil {
			t.Fatal(err)
		}
		ret.view = readAttributeViewItemsTest(t, ret.view.ID)
	}
	typ := "p"
	if source == "tag" {
		typ = "d"
	}
	ret.view.Automations.Spec = 8
	ret.view.Automations.Rules = append(ret.view.Automations.Rules, &av.AutomationRule{
		ID: ast.NewNodeID(), Name: "Binding condition", Enabled: enabled, Trigger: "block",
		BlockSource: &av.AutomationBlockSource{DocumentIDs: []string{ret.fixture.sourceID}, Types: []string{typ},
			Attributes: []*av.AutomationBlockAttribute{attribute}},
		Actions: ret.view.Automations.Rules[0].Actions,
	})
	ret.itemID = ret.view.GetBlockValueByBoundID(ret.blockID).BlockID
	ret.view.GetValue(ret.keyID, ret.itemID).Text.Content = "User edited field"
	if err := av.SaveAttributeView(ret.view); err != nil {
		t.Fatal(err)
	}
	tree, err := LoadTreeByBlockID(ret.blockID)
	if err != nil {
		t.Fatal(err)
	}
	if node := treenode.GetNodeInTree(tree, ret.blockID); node == nil || node.IALAttr(av.NodeAttrNameAvs) != ret.view.ID {
		t.Fatal("source must be bound only to the reviewed database")
	}
	if source == "reference" {
		ret.tx = collectionRemovalUpdate(t, ret.blockID, "Source without reference")
	} else {
		ret.tx = blockCollectionTags(t, ret.blockID, "")
		ret.changes = []*apicontract.TagRemovalChange{{ID: ret.blockID, Tags: []string{"todo"}}}
	}
	return ret
}

func TestCollectionRemovalProtectsBindingSensitiveRules(t *testing.T) {
	cases := []struct {
		name, nameOperator, attribute string
		disabled, unrelated           bool
	}{
		{name: "default exact", attribute: "custom-avs"},
		{name: "explicit exact", nameOperator: "equals", attribute: "custom-avs"},
		{name: "contains binding suffix", nameOperator: "contains", attribute: "avs"},
		{name: "contains custom prefix", nameOperator: "contains", attribute: "custom-"},
		{name: "exact expression", nameOperator: "regex", attribute: "^custom-avs$"},
		{name: "broad expression", nameOperator: "regex", attribute: ".*"},
		{name: "disabled binding rule", attribute: "custom-avs", disabled: true},
		{name: "unrelated exact", attribute: "custom-state", unrelated: true},
		{name: "unrelated contains", nameOperator: "contains", attribute: "state", unrelated: true},
		{name: "unrelated expression", nameOperator: "regex", attribute: "^custom-state$", unrelated: true},
	}
	for _, source := range []string{"reference", "tag"} {
		t.Run(source, func(t *testing.T) {
			for _, test := range cases {
				t.Run(test.name, func(t *testing.T) {
					operator := "notExists"
					if test.unrelated {
						operator = "exists"
					}
					fixture := setupCollectionRemovalBindingTest(t, source, &av.AutomationBlockAttribute{
						Name: test.attribute, NameOperator: test.nameOperator, Operator: operator,
					}, !test.disabled)
					docPath := filepath.Join(util.DataDir, fixture.fixture.box.ID, fixture.fixture.sourcePath)
					viewPath, _ := fixture.view.StoragePath()
					beforeDoc, beforeView := collectionRemovalFile(t, docPath), collectionRemovalFile(t, viewPath)
					groups, err := collectionRemovalPreviewTransaction(fixture.tx, fixture.changes)
					want := 0
					if test.disabled || test.unrelated {
						want = 1
					}
					if err != nil || len(groups) != want || len(fixture.tx.CollectionRemovalSourceVersions) != 1 {
						t.Fatalf("binding-sensitive preview: %+v, %v", groups, err)
					}
					if source == "tag" {
						legacy, legacyErr := PreviewTagRemoval(apicontract.TagRemovalPreviewRequest{Changes: fixture.changes})
						if legacyErr != nil || len(legacy) != want {
							t.Fatalf("legacy tag preview bypassed binding protection: %+v, %v", legacy, legacyErr)
						}
					}
					if !bytes.Equal(beforeDoc, collectionRemovalFile(t, docPath)) || !bytes.Equal(beforeView, collectionRemovalFile(t, viewPath)) {
						t.Fatal("binding-sensitive preview modified stored data")
					}
					if want == 1 {
						appendCollectionRemovalCleanup(fixture.tx, groups)
						if err = PerformTxSync(fixture.tx); err != nil {
							t.Fatal(err)
						}
						if readAttributeViewItemsTest(t, fixture.view.ID).GetBlockValue(fixture.itemID) != nil {
							t.Fatal("disabled or unrelated rule blocked confirmed cleanup")
						}
					} else {
						review, reviewErr := ReviewAttributeViewCollection(fixture.view.ID, 1, "")
						if reviewErr != nil {
							t.Fatal(reviewErr)
						}
						appendCollectionRemovalCleanup(fixture.tx, []*apicontract.TagRemovalCollection{{AvID: fixture.view.ID,
							Cleanup: apicontract.AVCollectionCleanup{RuleVersion: review.RuleVersion, AutomaticOnly: true,
								Items: []*apicontract.AVCollectionCleanupItem{{ItemID: fixture.itemID, BlockID: fixture.blockID}}}}})
						if err = PerformTxSync(fixture.tx); err != nil {
							t.Fatal("binding matcher blocked the source edit", err)
						}
						view := readAttributeViewItemsTest(t, fixture.view.ID)
						row := view.GetBlockValueByBoundID(fixture.blockID)
						if row == nil || row.BlockID != fixture.itemID || view.GetValue(fixture.keyID, fixture.itemID).Text.Content != "User edited field" {
							t.Fatal("automatic cleanup bypassed binding matcher protection")
						}
					}
				})
			}
		})
	}
}

func TestCollectionRemovalBindingProtectionPreservesEditsAndUndo(t *testing.T) {
	for _, source := range []string{"reference", "tag"} {
		t.Run(source, func(t *testing.T) {
			for _, forced := range []bool{false, true} {
				t.Run(fmt.Sprintf("forcedCleanup=%v", forced), func(t *testing.T) {
					fixture := setupCollectionRemovalBindingTest(t, source, &av.AutomationBlockAttribute{
						Name: "custom-avs", Operator: "notExists",
					}, true)
					groups, err := collectionRemovalPreviewTransaction(fixture.tx, fixture.changes)
					if err != nil || len(groups) != 0 {
						t.Fatalf("sensitive row was offered for cleanup: %+v, %v", groups, err)
					}
					if forced {
						review, reviewErr := ReviewAttributeViewCollection(fixture.view.ID, 1, "")
						if reviewErr != nil {
							t.Fatal(reviewErr)
						}
						appendCollectionRemovalCleanup(fixture.tx, []*apicontract.TagRemovalCollection{{AvID: fixture.view.ID,
							Cleanup: apicontract.AVCollectionCleanup{RuleVersion: review.RuleVersion, AutomaticOnly: true,
								Items: []*apicontract.AVCollectionCleanupItem{{ItemID: fixture.itemID, BlockID: fixture.blockID}}}}})
					}
					if err = PerformTxSync(fixture.tx); err != nil {
						t.Fatal("binding protection blocked the source edit", err)
					}
					assertRow := func() {
						t.Helper()
						view := readAttributeViewItemsTest(t, fixture.view.ID)
						row := view.GetBlockValueByBoundID(fixture.blockID)
						if row == nil || row.BlockID != fixture.itemID || view.GetValue(fixture.keyID, fixture.itemID).Text.Content != "User edited field" {
							t.Fatal("cleanup recollected the row with a new identity or default fields")
						}
					}
					assertRow()
					tree, err := LoadTreeByBlockID(fixture.blockID)
					if err != nil {
						t.Fatal(err)
					}
					if source == "reference" && len(collectionBlockReferences(tree)[fixture.blockID]) != 0 ||
						source == "tag" && tree.Root.IALAttr("tags") != "" {
						t.Fatal("source removal did not commit")
					}
					review, err := ReviewAttributeViewCollection(fixture.view.ID, 1, "")
					if err != nil || review.Unmatched != 1 || review.Unknown != 0 {
						t.Fatalf("ordinary review lost its proven mismatch: %+v, %v", review, err)
					}
					undo := &Transaction{isReplay: true, DoOperations: cloneOperations(fixture.tx.UndoOperations), UndoOperations: cloneOperations(fixture.tx.DoOperations)}
					if err = PerformTxSync(undo); err != nil {
						t.Fatal(err)
					}
					assertRow()
					tree, err = LoadTreeByBlockID(fixture.blockID)
					if err != nil {
						t.Fatal(err)
					}
					if source == "reference" && !collectionBlockReferences(tree)[fixture.blockID][fixture.fixture.targetID] ||
						source == "tag" && tree.Root.IALAttr("tags") != "todo" {
						t.Fatal("undo did not restore the source")
					}
				})
			}
		})
	}
}

func TestCollectionRemovalBindingProtectionLeavesManualCleanupAvailable(t *testing.T) {
	fixture := setupCollectionRemovalBindingTest(t, "reference", &av.AutomationBlockAttribute{
		Name: "custom-avs", Operator: "notExists",
	}, true)
	if err := PerformTxSync(fixture.tx); err != nil {
		t.Fatal(err)
	}
	review, err := ReviewAttributeViewCollection(fixture.view.ID, 1, "unmatched")
	if err != nil || review.Unmatched != 1 || len(review.Items) != 1 {
		t.Fatalf("manual review: %+v, %v", review, err)
	}
	op := collectionCleanupOperation(fixture.view.ID, review)
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{op}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, fixture.view.ID).GetBlockValue(fixture.itemID) != nil {
		t.Fatal("automatic protection prevented explicitly reviewed manual cleanup")
	}
}
