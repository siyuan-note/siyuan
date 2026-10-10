//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewMapSettingsUndoAndEncryptedReplay(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		name := "ordinary"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			_, database, _, _ := setupAttributeViewItemsTest(t, false)
			util.AttrViewLangs["en"]["map"] = "Map"
			view := database.Views[0]
			if err := changeAttrViewLayout(database, view, av.LayoutTypeMap); err != nil {
				t.Fatal(err)
			}
			boxID := ""
			plainPath := filepath.Join(util.DataDir, "storage", "av", database.ID+".json")
			if encrypted {
				boxID = ast.NewNodeID()
				markRuntimeEncryptedBox(boxID)
				setDEKForTest(boxID, bytes.Repeat([]byte{0x61}, 32))
				av.SetAVBoxID(database.ID, boxID)
				t.Cleanup(func() {
					av.SetAVBoxID(database.ID, "")
					forgetRuntimeEncryptedBox(boxID)
					encryptedBoxLifecycles.Delete(boxID)
					cachedDEKsLock.Lock()
					delete(cachedDEKs, boxID)
					cachedDEKsLock.Unlock()
				})
			}
			if err := av.SaveAttributeView(database); err != nil {
				t.Fatal(err)
			}
			if encrypted {
				if err := os.Remove(plainPath); err != nil {
					t.Fatal(err)
				}
			}
			before := view.Map.Settings
			after := av.MapSettings{LocationKeyID: ast.NewNodeID(), Height: 800}
			operation := func(settings av.MapSettings) *Operation {
				return &Operation{Action: "setAttrViewMap", AvID: database.ID, ViewID: view.ID, Data: settings}
			}
			tx := &Transaction{DoOperations: []*Operation{operation(after)}, UndoOperations: []*Operation{operation(before)}, fromAPI: true}
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			for _, replay := range []struct {
				operations []*Operation
				settings   av.MapSettings
			}{{tx.DoOperations, after}, {tx.UndoOperations, before}, {tx.DoOperations, after}} {
				if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(replay.operations), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				cache.ClearAVCache()
				stored, err := av.ParseAttributeViewForIndexInBox(database.ID, boxID)
				if err != nil || stored.Spec != av.MapSpec || stored.Views[0].Map.Settings != replay.settings {
					t.Fatalf("map settings replay: %v", err)
				}
			}
			if encrypted {
				path := filepath.Join(util.DataDir, boxID, "storage", "av", database.ID+".json")
				ciphertext, err := os.ReadFile(path)
				if err != nil || !util.IsCiphertext(ciphertext) {
					t.Fatal("map settings did not retain encrypted storage")
				}
				if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
					t.Fatal("map settings recreated plaintext storage")
				}
				ciphertext[len(ciphertext)-1] ^= 1
				if err = os.WriteFile(path, ciphertext, 0644); err != nil {
					t.Fatal(err)
				}
				cache.ClearAVCache()
				if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err == nil {
					t.Fatal("map replay accepted unauthenticated data")
				}
				preserved, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(ciphertext, preserved) {
					t.Fatal("failed map replay modified ciphertext")
				}
			}
		})
	}
}
