// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBacklinkDatabaseEncryptedScope(t *testing.T) {
	setupAttributeViewValidationTest(t)
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search.Store(conf.NewSearch())
	source, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	target, err := LoadTreeByBlockID(fixture.targetID)
	if err != nil {
		t.Fatal(err)
	}
	boxID := fixture.box.ID
	dek := bytes.Repeat([]byte{0x73}, 32)
	markRuntimeEncryptedBox(boxID)
	prepareUnlockedEncryptedBoxTest(t, boxID, dek)
	encryptDocumentTestSources(t, dek, source, target)
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted, boxConf.BoxCrypt = true, &conf.BoxEncryption{Spec: boxEncryptionSpec}
	if err := encryptBoxMetadata(boxID, boxConf, dek); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(boxConf)
	if err := os.WriteFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	mountedEncryptedBoxes.Store(boxID, true)
	if err := treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
		t.Fatal(err)
	}
	if err := sql.OpenEncryptedDB(boxID, dek); err != nil {
		t.Fatal(err)
	}
	view := av.NewAttributeView(ast.NewNodeID())
	av.SetAVBoxID(view.ID, boxID)
	t.Cleanup(func() {
		ClearGlobalBacklinkSnapshots(boxID)
		sql.CloseEncryptedDB(boxID)
		treenode.CloseEncryptedBlockTreeDB(boxID)
		mountedEncryptedBoxes.Delete(boxID)
		av.SetAVBoxID(view.ID, "")
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	for target.Root.FirstChild != nil {
		target.Root.FirstChild.Unlink()
	}
	paragraph := treenode.NewParagraph(ast.NewNodeID())
	paragraph.SetIALAttr(av.NodeAttrNameAvs, view.ID)
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Task ")})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: source.ID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Topic"})
	target.Root.AppendChild(paragraph)
	for _, tree := range []*parse.Tree{source, target} {
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
		sql.UpdateRefsTreeQueue(tree)
	}
	view.KeyValues[0].Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: view.GetBlockKey().ID,
		BlockID: ast.NewNodeID(), Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: paragraph.ID, Content: "Task"}}}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	cache.ClearAVCache()
	filter := &BacklinkSourceFilter{Database: &BacklinkDatabaseFilter{AvID: view.ID}}
	if err := ValidateBacklinkDatabaseFilter(filter, boxID); err != nil {
		t.Fatal(err)
	}
	if err := ValidateBacklinkDatabaseFilter(filter, ""); err == nil {
		t.Fatal("ordinary queries reached encrypted database fields")
	}
	_, _, _, count, _ := GetBacklink2InBoxWithOptions(source.ID, "", "", 0, 0, false, boxID, filter, false, true)
	if count != 1 {
		t.Fatalf("encrypted filtered count: %d", count)
	}
	contexts, _ := GetBacklinkDocInBox(source.ID, target.ID, "", false, false, boxID, filter)
	if len(contexts) != 1 || contexts[0].ID != paragraph.ID {
		t.Fatal("encrypted list/context mismatch")
	}
	candidates, err := GetBacklinkDatabases(source.ID, "", boxID, false, nil)
	if err != nil || len(candidates) != 1 || candidates[0].ID != view.ID {
		t.Fatalf("encrypted metadata: %+v %v", candidates, err)
	}
	_, _, total, _, expired, err := GetGlobalBacklinks(GlobalBacklinkQuery{ID: source.ID, Notebook: boxID, Sort: 1, SourceFilter: filter}, "", 0, "", func(string) bool { return true })
	if err != nil || expired || total != 1 {
		t.Fatalf("encrypted virtual list: %d %v %v", total, expired, err)
	}
	path := filepath.Join(util.DataDir, boxID, "storage", "av", view.ID+".json")
	original, err := os.ReadFile(path)
	if err != nil || json.Valid(original) {
		t.Fatal("encrypted source became plaintext", err)
	}
	cache.ClearAVCache()
	corrupt := append([]byte(nil), original...)
	corrupt[len(corrupt)-1] ^= 1
	if err := os.WriteFile(path, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if err := ValidateBacklinkDatabaseFilter(filter, boxID); err == nil {
		t.Fatal("authentication failure bypassed")
	}
	preserved, _ := os.ReadFile(path)
	if !bytes.Equal(preserved, corrupt) {
		t.Fatal("failed authenticated read modified the original ciphertext")
	}
}
