//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewDeletedBlockEncryptedReplay(t *testing.T) {
	fixture, before, tx := setupAttributeViewDeletedBlockTest(t, "container")
	boxID := fixture.box.ID
	var trees []*parse.Tree
	for _, id := range []string{fixture.sourceID, fixture.targetID} {
		tree, err := LoadTreeByBlockID(id)
		if err != nil {
			t.Fatal(err)
		}
		trees = append(trees, tree)
	}
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
	})
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
		t.Fatal(err)
	}
	av.SetAVBoxID(before.ID, boxID)
	t.Cleanup(func() {
		mountedEncryptedBoxes.Delete(boxID)
		av.SetAVBoxID(before.ID, "")
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	for _, tree := range trees {
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	if err := av.SaveAttributeView(before); err != nil {
		t.Fatal(err)
	}
	plainPath := filepath.Join(util.DataDir, "storage", "av", before.ID+".json")
	if err := os.Remove(plainPath); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	for _, operations := range [][]*Operation{cloneOperations(tx.UndoOperations), cloneOperations(tx.DoOperations)} {
		if err := PerformTxSync(&Transaction{DoOperations: operations, isReplay: true}); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(util.DataDir, boxID, "storage", "av", before.ID+".json")
	ciphertext, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(ciphertext) {
		t.Fatalf("block deletion replay did not preserve encryption: %v", err)
	}
	if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
		t.Fatalf("block deletion replay produced plaintext: %v", err)
	}
	for _, failure := range []string{"locked", "corrupted"} {
		t.Run(failure, func(t *testing.T) {
			if failure == "locked" {
				cachedDEKsLock.Lock()
				delete(cachedDEKs, boxID)
				cachedDEKsLock.Unlock()
				defer setDEKForTest(boxID, bytes.Repeat([]byte{0x63}, 32))
			} else {
				ciphertext[len(ciphertext)-1] ^= 1
				if err = os.WriteFile(path, ciphertext, 0600); err != nil {
					t.Fatal(err)
				}
			}
			cache.ClearAVCache()
			if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err == nil {
				t.Fatal("block deletion replay accepted inaccessible encrypted data")
			}
			preserved, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(ciphertext, preserved) {
				t.Fatalf("failed replay changed encrypted data: %v", readErr)
			}
		})
	}
}
