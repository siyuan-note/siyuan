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

func TestListConversionEncryptedReplayAndHistory(t *testing.T) {
	fixture, view, tree, list := setupListConversionTest(t, "- Alpha\n- Beta\n", "item")
	boxID := fixture.box.ID
	markRuntimeEncryptedBox(boxID)
	dek := bytes.Repeat([]byte{0x63}, 32)
	setDEKForTest(boxID, dek)
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	boxConf.BoxCrypt = &conf.BoxEncryption{Spec: boxEncryptionSpec}
	if err := encryptBoxMetadata(boxID, boxConf, dek); err != nil {
		t.Fatal(err)
	}
	configData, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), configData, 0600); err != nil {
		t.Fatal(err)
	}
	mountedEncryptedBoxes.Store(boxID, true)
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
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
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
		t.Fatal(err)
	}
	av.SetAVBoxID(view.ID, boxID)
	cache.RemoveTreeDataInBox(tree.ID, boxID)
	cache.ClearAVCache()
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	plainPath := filepath.Join(util.DataDir, "storage", "av", view.ID+".json")
	if err = os.Remove(plainPath); err != nil {
		t.Fatal(err)
	}
	tx := listConversionTestTx(tree.ID, []string{list.ID}, "heading", false)
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	for _, operations := range [][]*Operation{tx.UndoOperations, tx.DoOperations, tx.UndoOperations, tx.DoOperations} {
		if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(operations), isReplay: true}); err != nil {
			t.Fatal(err)
		}
	}
	paths, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-format", boxID, tree.ID+".sy"))
	if err != nil || len(paths) != 1 {
		t.Fatalf("encrypted paired history missing: %v %v", paths, err)
	}
	historyDir := filepath.Dir(filepath.Dir(paths[0]))
	for _, path := range []string{paths[0], boundAttributeViewHistoryPath(historyDir, boxID, view.ID)} {
		data, readErr := os.ReadFile(path)
		if readErr != nil || !util.IsCiphertext(data) {
			t.Fatalf("history was not encrypted [%s]: %v", path, readErr)
		}
	}
	if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
		t.Fatal("conversion recreated plaintext database")
	}
	path := filepath.Join(util.DataDir, boxID, "storage", "av", view.ID+".json")
	ciphertext, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[len(ciphertext)-1] ^= 1
	if err = os.WriteFile(path, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	docPath := filepath.Join(util.DataDir, boxID, tree.Path)
	before, _ := os.ReadFile(docPath)
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err == nil {
		t.Fatal("undo accepted unauthenticated database")
	}
	if data, _ := os.ReadFile(path); !bytes.Equal(data, ciphertext) {
		t.Fatal("failed authentication changed ciphertext")
	}
	if data, _ := os.ReadFile(docPath); !bytes.Equal(data, before) {
		t.Fatal("failed authentication changed document")
	}
}
