// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && sqlcipher

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentConversionEncryptedFailurePreservesCiphertext(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	var trees []*parse.Tree
	for _, id := range []string{fixture.sourceID, fixture.targetID} {
		tree, err := LoadTreeByBlockID(id)
		if err != nil {
			t.Fatal(err)
		}
		trees = append(trees, tree)
		treenode.RemoveBlockTreesByRootID(tree.Box, tree.ID)
	}
	boxID := fixture.box.ID
	key := bytes.Repeat([]byte{0x68}, 32)
	prepareUnlockedEncryptedBoxTest(t, boxID, key)
	encryptDocumentTestSources(t, key, trees...)
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	boxConf.BoxCrypt = &conf.BoxEncryption{Spec: boxEncryptionSpec}
	if err := encryptBoxMetadata(boxID, boxConf, key); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	mountedEncryptedBoxes.Store(boxID, true)
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	if err = sql.OpenEncryptedDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		sql.CloseEncryptedDB(boxID)
		treenode.CloseEncryptedBlockTreeDB(boxID)
		mountedEncryptedBoxes.Delete(boxID)
	})
	for _, tree := range trees {
		treenode.UpsertBlockTree(tree)
	}
	source, sourceBefore, err := loadBatchMutationTree(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	target, targetBefore, err := loadBatchMutationTree(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	if !util.IsCiphertext(sourceBefore) || !util.IsCiphertext(targetBefore) {
		t.Fatal("fixture was not encrypted")
	}
	injected := errors.New("encrypted destination write failure")
	err = commitDocumentConversion(source, target, sourceBefore, targetBefore, true, func(*parse.Tree) error { return injected })
	if !errors.Is(err, injected) {
		t.Fatal(err)
	}
	for p, want := range map[string][]byte{source.Path: sourceBefore, target.Path: targetBefore} {
		got, err := os.ReadFile(filepath.Join(util.DataDir, boxID, p))
		if err != nil || !bytes.Equal(got, want) {
			t.Fatal("ciphertext was not restored exactly", p, err)
		}
	}
}
