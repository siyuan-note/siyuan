// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewColumnOrderEncrypted(t *testing.T) {
	_, original, _, _ := setupAttributeViewItemsTest(t, false)
	boxID := ast.NewNodeID()
	markRuntimeEncryptedBox(boxID)
	prepareUnlockedEncryptedBoxTest(t, boxID, bytes.Repeat([]byte{0x71}, 32))
	av.SetAVBoxID(original.ID, boxID)
	t.Cleanup(func() {
		av.SetAVBoxID(original.ID, "")
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	view := original.Views[0]
	before := AttributeViewViewFieldIDs(view)
	if len(before) < 2 {
		t.Fatal("fixture needs two columns")
	}
	if err := av.SaveAttributeView(original); err != nil {
		t.Fatal(err)
	}
	plainPath := filepath.Join(util.DataDir, "storage", "av", original.ID+".json")
	if err := os.Remove(plainPath); err != nil {
		t.Fatal(err)
	}
	if err := SortAttributeViewViewKey(original.ID, view.ID, before[0], before[len(before)-1]); err != nil {
		t.Fatal(err)
	}
	stored, err := av.ParseAttributeViewForIndexInBox(original.ID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	want := append(slices.Clone(before[1:]), before[0])
	if !slices.Equal(AttributeViewViewFieldIDs(stored.GetView(view.ID)), want) {
		t.Fatal("encrypted order was not saved")
	}
	if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
		t.Fatal("move created plaintext data")
	}
	path := filepath.Join(util.DataDir, boxID, "storage", "av", original.ID+".json")
	ciphertext, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	cachedDEKsLock.Lock()
	delete(cachedDEKs, boxID)
	cachedDEKsLock.Unlock()
	if err = SortAttributeViewViewKey(original.ID, view.ID, before[0], ""); err == nil {
		t.Fatal("locked notebook accepted a move")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(ciphertext, after) {
		t.Fatal("rejected move changed ciphertext")
	}
}
