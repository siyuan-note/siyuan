//go:build fts5

// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewConditionalColorsUndoAndEncryptedReplay(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		name := "ordinary"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			_, original, _, _ := setupAttributeViewItemsTest(t, false)
			util.AttrViewLangs["en"]["calendar"] = "Calendar"
			if err := changeAttrViewLayout(original, original.Views[0], av.LayoutTypeCalendar); err != nil {
				t.Fatal(err)
			}
			boxID := ""
			plainPath := filepath.Join(util.DataDir, "storage", "av", original.ID+".json")
			if encrypted {
				boxID = ast.NewNodeID()
				markRuntimeEncryptedBox(boxID)
				setDEKForTest(boxID, bytes.Repeat([]byte{0x63}, 32))
				av.SetAVBoxID(original.ID, boxID)
				t.Cleanup(func() {
					av.SetAVBoxID(original.ID, "")
					forgetRuntimeEncryptedBox(boxID)
					encryptedBoxLifecycles.Delete(boxID)
					cachedDEKsLock.Lock()
					delete(cachedDEKs, boxID)
					cachedDEKsLock.Unlock()
				})
			}
			if err := av.SaveAttributeView(original); err != nil {
				t.Fatal(err)
			}
			if encrypted {
				if err := os.Remove(plainPath); err != nil {
					t.Fatal(err)
				}
			}

			before := []*av.ConditionalColorRule{}
			after := []*av.ConditionalColorRule{{ID: ast.NewNodeID(), Target: "item", Color: &av.ValueSelect{Color: "3"}, Filter: &av.ViewFilter{Column: original.KeyValues[0].Key.ID, Operator: av.FilterOperatorIsNotEmpty}}}
			operation := func(rules []*av.ConditionalColorRule) *Operation {
				return &Operation{Action: "setAttrViewConditionalColors", AvID: original.ID, ViewID: original.Views[0].ID, Data: rules}
			}
			tx := &Transaction{DoOperations: []*Operation{operation(after)}, UndoOperations: []*Operation{operation(before)}, fromAPI: true}
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			for _, step := range []struct {
				operations []*Operation
				expected   []*av.ConditionalColorRule
			}{{tx.DoOperations, after}, {tx.UndoOperations, before}, {tx.DoOperations, after}} {
				if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(step.operations), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				cache.ClearAVCache()
				stored, err := av.ParseAttributeViewForIndexInBox(original.ID, boxID)
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(stored.Views[0].ConditionalColors, step.expected) {
					t.Fatalf("rules replay: %+v", stored.Views[0].ConditionalColors)
				}
			}
			if encrypted {
				path := filepath.Join(util.DataDir, boxID, "storage", "av", original.ID+".json")
				ciphertext, err := os.ReadFile(path)
				if err != nil || !util.IsCiphertext(ciphertext) {
					t.Fatal("conditional colors did not retain encrypted storage")
				}
				if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
					t.Fatal("conditional colors produced a plaintext copy")
				}
				ciphertext[len(ciphertext)-1] ^= 1
				if err = os.WriteFile(path, ciphertext, 0600); err != nil {
					t.Fatal(err)
				}
				cache.ClearAVCache()
				if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err == nil {
					t.Fatal("conditional colors replay accepted unauthenticated data")
				}
				preserved, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(ciphertext, preserved) {
					t.Fatal("failed conditional colors replay modified ciphertext")
				}
			}
		})
	}
}
