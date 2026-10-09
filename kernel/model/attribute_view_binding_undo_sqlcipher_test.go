//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewBindingEncryptedReplay(t *testing.T) {
	fixture, before, tx := setupAttributeViewBindingUndoTest(t, true)
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
	// 对已有公历日期先按支持的密文格式写入，再验证历法设置不改变时间戳或认证读写。
	lunarKey := av.NewKey("20261009120000-lunare1", "Birthday", "", av.KeyTypeDate)
	lunarKey.DateFormat = av.DateDisplayFormatFull
	lunarTimestamp := time.Date(2025, 7, 25, 14, 7, 35, 123000000, time.Local).UnixMilli()
	before.KeyValues = append(before.KeyValues, &av.KeyValues{Key: lunarKey, Values: []*av.Value{
		{ID: "20261009120000-lunare2", KeyID: lunarKey.ID, Type: av.KeyTypeDate,
			Date: &av.ValueDate{Content: lunarTimestamp, IsNotEmpty: true}},
	}})
	if err := av.SaveAttributeView(before); err != nil {
		t.Fatal(err)
	}
	for _, format := range []av.DateDisplayFormat{av.DateDisplayFormatLunar, av.DateDisplayFormatFull} {
		if err = setAttributeViewColDateFormat(&Operation{AvID: before.ID, ID: lunarKey.ID, Typ: "date", Format: string(format)}); err != nil {
			t.Fatal(err)
		}
		cache.ClearAVCache()
		stored, readErr := av.ParseAttributeView(before.ID)
		if readErr != nil {
			t.Fatal(readErr)
		}
		field := stored.KeyValues[len(stored.KeyValues)-1]
		if field.Key.DateFormat != format || field.Values[0].Date.Content != lunarTimestamp {
			t.Fatal("encrypted calendar switch changed the stored date")
		}
	}
	key := before.KeyValues[2].Key
	if err := setAttrViewColAttributePanelVisibility(&Operation{AvID: before.ID, ID: key.ID, Data: "hide"}); err != nil {
		t.Fatal(err)
	}
	key.AttributePanelVisibility = "hide"
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
	cache.ClearAVCache()
	persisted, err := av.ParseAttributeView(before.ID)
	if err != nil {
		t.Fatal(err)
	}
	persistedKey, err := persisted.GetKey(key.ID)
	if err != nil || persistedKey.AttributePanelVisibility != "hide" {
		t.Fatalf("encrypted replay lost field visibility: %+v, %v", persistedKey, err)
	}
	path := filepath.Join(util.DataDir, boxID, "storage", "av", before.ID+".json")
	ciphertext, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(ciphertext) {
		t.Fatalf("binding replay did not preserve encryption: %v", err)
	}
	if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
		t.Fatalf("binding replay produced plaintext: %v", err)
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
			if err = setAttrViewColAttributePanelVisibility(&Operation{AvID: before.ID, ID: key.ID, Data: "always"}); err == nil {
				t.Fatal("field visibility accepted inaccessible encrypted data")
			}
			if err = setAttributeViewColDateFormat(&Operation{AvID: before.ID, ID: lunarKey.ID, Typ: "date", Format: "lunar"}); err == nil {
				t.Fatal("calendar setting accepted inaccessible encrypted data")
			}
			if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err == nil {
				t.Fatal("binding replay accepted inaccessible encrypted data")
			}
			preserved, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(ciphertext, preserved) {
				t.Fatalf("failed replay changed encrypted data: %v", readErr)
			}
		})
	}
}
