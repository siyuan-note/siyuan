//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockCollectionEncryptedSourceAndRecovery(t *testing.T) {
	for _, target := range []string{"", "block", "container"} {
		name := target
		if name == "" {
			name = "default"
		}
		t.Run(name, func(t *testing.T) { testBlockCollectionEncryptedSourceAndRecovery(t, target) })
	}
}

func testBlockCollectionEncryptedSourceAndRecovery(t *testing.T, target string) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	boxID := fixture.box.ID
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	markRuntimeEncryptedBox(boxID)
	key := bytes.Repeat([]byte{0x58}, 32)
	prepareUnlockedEncryptedBoxTest(t, boxID, key)
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted, boxConf.BoxCrypt = true, &conf.BoxEncryption{Spec: boxEncryptionSpec}
	if err = encryptBoxMetadata(boxID, boxConf, key); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(boxConf)
	if err = os.WriteFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	mountedEncryptedBoxes.Store(boxID, true)
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	av.SetAVBoxID(view.ID, boxID)
	t.Cleanup(func() {
		treenode.CloseEncryptedBlockTreeDB(boxID)
		util.TempDir = oldTempDir
		mountedEncryptedBoxes.Delete(boxID)
		av.SetAVBoxID(view.ID, "")
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	sourceID := tree.ID
	if target != "" {
		view.Automations.Spec = 4
		view.Automations.Rules[0].BlockSource.TagTarget = target
		paragraph := treenode.NewParagraph("")
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "todo"})
		if target == "container" {
			quote := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeBlockquote}
			quote.SetIALAttr("id", quote.ID)
			quote.AppendChild(&ast.Node{Type: ast.NodeBlockquoteMarker, Tokens: []byte(">")})
			tree.Root.AppendChild(quote)
			quote.AppendChild(paragraph)
			sourceID = quote.ID
			view.Automations.Rules[0].BlockSource.Types = []string{"b"}
		} else {
			tree.Root.AppendChild(paragraph)
			sourceID = paragraph.ID
			view.Automations.Rules[0].BlockSource.Types = []string{"p"}
		}
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	if target == "" {
		view.Automations.Rules[0].BlockSource.Tags = nil
	}
	view.Automations.Rules[0].BlockSource.Attributes = []*av.AutomationBlockAttribute{{Name: "custom-state", Operator: "equals", Value: "active"}}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	plainPath := filepath.Join(util.DataDir, "storage", "av", view.ID+".json")
	if err = os.Remove(plainPath); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	op := &Operation{Action: "setAttrs", ID: sourceID, Data: `{"custom-state":"active"}`}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{{Action: "setAttrs", ID: sourceID, Data: `{"custom-state":""}`}}}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	stored, err := av.ParseAttributeViewForIndexInBox(view.ID, boxID)
	if err != nil || stored.GetBlockValueByBoundID(sourceID) == nil {
		t.Fatal("encrypted source was not collected", err)
	}
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.DoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewAttributeViewCollection(view.ID, view.Automations.Rules[0].ID, 1)
	if err != nil || len(preview.Blocks) != 1 || !preview.Blocks[0].Collected {
		t.Fatal("encrypted preview failed", err)
	}
	review, err := ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Matched != 1 || review.Unmatched != 0 {
		t.Fatalf("encrypted review failed: %+v %v", review, err)
	}
	itemID := stored.GetBlockValueByBoundID(sourceID).BlockID
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "setAttrs", ID: sourceID,
		Data: `{"custom-state":"inactive"}`}}}); err != nil {
		t.Fatal(err)
	}
	review, err = ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Unmatched != 1 || review.Items[0].ItemID != itemID {
		t.Fatalf("encrypted mismatch did not preserve the collected entry: %+v %v", review, err)
	}
	cleanupOp := collectionCleanupOperation(view.ID, review)
	cleanupTx := &Transaction{fromAPI: true, DoOperations: []*Operation{cleanupOp}, UndoOperations: []*Operation{cleanupOp}}
	if err = PerformTxSync(cleanupTx); err != nil {
		t.Fatal(err)
	}
	stored, err = av.ParseAttributeViewForIndexInBox(view.ID, boxID)
	if err != nil || stored.GetBlockValue(itemID) != nil {
		t.Fatal("encrypted cleanup failed", err)
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(cleanupTx.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	stored, err = av.ParseAttributeViewForIndexInBox(view.ID, boxID)
	if err != nil || stored.GetBlockValue(itemID) == nil {
		t.Fatal("encrypted cleanup undo did not restore the original entry", err)
	}
	if target == "" {
		for _, detached := range []bool{false, true} {
			rowID, source := ast.NewNodeID(), ast.NewNodeID()
			stored.GetBlockKeyValues().Values = append(stored.GetBlockKeyValues().Values, &av.Value{
				KeyID: stored.GetBlockKeyValues().Key.ID, BlockID: rowID, Type: av.KeyTypeBlock, IsDetached: detached,
				Block: &av.ValueBlock{ID: source, Content: "Retained entry"}})
			values, _ := stored.GetKeyValues(keyID)
			values.Values = append(values.Values, &av.Value{KeyID: keyID, BlockID: rowID, Type: av.KeyTypeText,
				Text: &av.ValueText{Content: "Edited field"}})
			if err = av.SaveAttributeView(stored); err != nil {
				t.Fatal(err)
			}
			review, err = ReviewAttributeViewCollection(view.ID, 1, "unknown")
			if err != nil || len(review.Items) != 1 || review.Items[0].ItemID != rowID {
				t.Fatalf("unknown encrypted review: %+v %v", review, err)
			}
			remove := &Operation{Action: "removeAttrViewBlock", AvID: view.ID, SrcIDs: []string{rowID}}
			undo := &Operation{Action: "insertAttrViewBlock", AvID: view.ID,
				Srcs: []map[string]any{{"itemID": rowID, "id": source, "isDetached": detached}}}
			manual := &Transaction{fromAPI: true, DoOperations: []*Operation{remove}, UndoOperations: []*Operation{undo}}
			if err = PerformTxSync(manual); err != nil {
				t.Fatal(err)
			}
			if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(manual.UndoOperations)}); err != nil {
				t.Fatal(err)
			}
			stored, err = av.ParseAttributeViewForIndexInBox(view.ID, boxID)
			if err != nil || stored.GetBlockValue(rowID) == nil || stored.GetValue(keyID, rowID).Text.Content != "Edited field" {
				t.Fatal("unknown encrypted undo lost entry fields", err)
			}
			if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(manual.DoOperations)}); err != nil {
				t.Fatal(err)
			}
			stored, err = av.ParseAttributeViewForIndexInBox(view.ID, boxID)
			if err != nil || stored.GetBlockValue(rowID) != nil {
				t.Fatal("unknown encrypted redo failed", err)
			}
		}
	}
	avPath := filepath.Join(util.DataDir, boxID, "storage", "av", view.ID+".json")
	docPath := filepath.Join(util.DataDir, boxID, tree.Path)
	for _, path := range []string{avPath, docPath} {
		data, err = os.ReadFile(path)
		if err != nil || !util.IsCiphertext(data) {
			t.Fatal("collection wrote plaintext", err)
		}
	}
	if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
		t.Fatal("collection recreated a plaintext database")
	}
	beforeDoc, _ := os.ReadFile(docPath)
	beforeView, _ := os.ReadFile(avPath)
	if target == "" {
		corruptDoc := append([]byte(nil), beforeDoc...)
		corruptDoc[len(corruptDoc)-1] ^= 1
		if err = os.WriteFile(docPath, corruptDoc, 0600); err != nil {
			t.Fatal(err)
		}
		cache.ClearAVCache()
		cache.RemoveTreeDataInBox(tree.ID, boxID)
		review, err = ReviewAttributeViewCollection(view.ID, 1, "unknown")
		if err != nil || len(review.Items) != 1 || review.Items[0].Reason != "unreadable" {
			t.Fatalf("unreadable encrypted source: %+v %v", review, err)
		}
		manual := &Transaction{fromAPI: true,
			DoOperations: []*Operation{{Action: "removeAttrViewBlock", AvID: view.ID, SrcIDs: []string{itemID}}},
			UndoOperations: []*Operation{{Action: "insertAttrViewBlock", AvID: view.ID,
				Srcs: []map[string]any{{"itemID": itemID, "id": sourceID, "isDetached": false}}}}}
		if err = PerformTxSync(manual); err == nil {
			t.Fatal("manual removal accepted unauthenticated source content")
		}
		preserved, readErr := os.ReadFile(avPath)
		if readErr != nil || !bytes.Equal(beforeView, preserved) {
			t.Fatal("failed manual removal modified the database", readErr)
		}
		preserved, readErr = os.ReadFile(docPath)
		if readErr != nil || !bytes.Equal(corruptDoc, preserved) {
			t.Fatal("failed manual removal modified source ciphertext", readErr)
		}
		if err = os.WriteFile(docPath, beforeDoc, 0600); err != nil {
			t.Fatal(err)
		}
		cache.RemoveTreeDataInBox(tree.ID, boxID)
	}
	for _, failure := range []string{"locked", "corrupt"} {
		if failure == "locked" {
			cachedDEKsLock.Lock()
			delete(cachedDEKs, boxID)
			cachedDEKsLock.Unlock()
		} else {
			beforeView[len(beforeView)-1] ^= 1
			if err = os.WriteFile(avPath, beforeView, 0600); err != nil {
				t.Fatal(err)
			}
		}
		cache.ClearAVCache()
		if _, err = PreviewAttributeViewCollection(view.ID, view.Automations.Rules[0].ID, 1); err == nil {
			t.Fatal("preview accepted inaccessible ciphertext")
		}
		if _, err = ReviewAttributeViewCollection(view.ID, 1, ""); err == nil {
			t.Fatal("review accepted inaccessible ciphertext")
		}
		if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{cleanupOp}}); err == nil {
			t.Fatal("cleanup accepted inaccessible ciphertext")
		}
		if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "setAttrs", ID: sourceID, Data: `{"custom-state":"inactive"}`}}}); err == nil {
			t.Fatal("collection accepted inaccessible ciphertext")
		}
		for path, before := range map[string][]byte{avPath: beforeView, docPath: beforeDoc} {
			after, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(before, after) {
				t.Fatal("failed collection changed recovery material", readErr)
			}
		}
		setDEKForTest(boxID, key)
	}
}
