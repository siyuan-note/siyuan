//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockCollectionEncryptedSourceAndRecovery(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	boxID := fixture.box.ID
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	markRuntimeEncryptedBox(boxID)
	key := bytes.Repeat([]byte{0x58}, 32)
	setDEKForTest(boxID, key)
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
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	view.Automations.Rules[0].BlockSource.Tags = nil
	view.Automations.Rules[0].BlockSource.Attributes = []*av.AutomationBlockAttribute{{Name: "custom-state", Operator: "equals", Value: "active"}}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	plainPath := filepath.Join(util.DataDir, "storage", "av", view.ID+".json")
	if err = os.Remove(plainPath); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	op := &Operation{Action: "setAttrs", ID: tree.ID, Data: `{"custom-state":"active"}`}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{{Action: "setAttrs", ID: tree.ID, Data: `{"custom-state":""}`}}}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	stored, err := av.ParseAttributeViewForIndexInBox(view.ID, boxID)
	if err != nil || stored.GetBlockValueByBoundID(tree.ID) == nil {
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
		if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "setAttrs", ID: tree.ID, Data: `{"custom-state":"inactive"}`}}}); err == nil {
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
