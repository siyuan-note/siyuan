// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentReadBoundaryEncryptedSourceAuthenticationAndLock(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Editor.Store(conf.NewEditor())
	Conf.Export.Store(conf.NewExport())
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	boxID := fixture.box.ID
	key := bytes.Repeat([]byte{0x69}, 32)
	prepareUnlockedEncryptedBoxTest(t, boxID, key)
	encryptDocumentTestSources(t, key, tree)
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() {
		FlushTxQueue()
		backgroundRefreshWaitGroup.Wait()
		sql.ClearQueue()
		sql.CloseEncryptedDB(boxID)
		treenode.CloseEncryptedBlockTreeDB(boxID)
		cache.RemoveTreeDataInBox(tree.ID, boxID)
		util.TempDir = oldTempDir
	})
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	if err = sql.OpenEncryptedDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	transaction := documentBoundaryUpdate(fixture.childID, "authenticated source")
	queued := []*Transaction{transaction}
	PerformTransactions(&queued)
	_, content, _, _, rootID, _, _, _, gotBox, _, _, _, _, _, err := GetDocInBox(
		"", "", fixture.childID, 0, "", nil, nil, 0, 0, 102400, false, map[string]string{}, true, false, boxID)
	if err != nil || !strings.Contains(content, "authenticated source") || rootID != tree.ID || gotBox != boxID {
		t.Fatalf("encrypted document did not capture its committed source: %v", err)
	}
	requireTransactionFinished(t, waitForTransactionInTest(transaction))
	// 生命周期等待沿用完整加载路径，不得占住全局事务锁而阻塞其他文档写入。
	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocking)
	readDone := make(chan struct{})
	var waitingReadErr error
	go func() {
		_, waitingReadErr = loadDocumentAtTransactionBoundary(fixture.childID, boxID, nil)
		close(readDone)
	}()
	func() {
		defer setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
		requireTransactionWaiting(t, readDone)
		writeDone := make(chan struct{})
		go func() { _ = PerformTxSync(&Transaction{}); close(writeDone) }()
		requireTransactionFinished(t, writeDone)
	}()
	requireTransactionFinished(t, readDone)
	if waitingReadErr != nil {
		t.Fatalf("encrypted read did not resume after its lifecycle transition: %v", waitingReadErr)
	}
	path := filepath.Join(util.DataDir, boxID, tree.Path)
	original, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(original) {
		t.Fatalf("read boundary did not preserve encrypted source storage: %v", err)
	}
	tampered := bytes.Clone(original)
	tampered[len(tampered)-1] ^= 1
	if err = os.WriteFile(path, tampered, 0600); err != nil {
		t.Fatal(err)
	}
	cache.RemoveTreeDataInBox(tree.ID, boxID)
	if _, err = loadDocumentAtTransactionBoundary(fixture.childID, boxID, nil); err == nil {
		t.Fatal("read boundary accepted unauthenticated ciphertext")
	}
	if unchanged, readErr := os.ReadFile(path); readErr != nil || !bytes.Equal(unchanged, tampered) {
		t.Fatalf("authentication failure changed source ciphertext: %v", readErr)
	}
	if err = os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	if err = AcquireEncryptedBoxOperation(boxID); err != nil {
		t.Fatal(err)
	}
	if _, err = loadDocumentAtTransactionBoundary(fixture.childID, boxID, nil); err != nil {
		ReleaseEncryptedBoxOperation(boxID)
		t.Fatal(err)
	}
	locked := make(chan struct{})
	go func() { LockBox(boxID); close(locked) }()
	requireTransactionWaiting(t, locked)
	ReleaseEncryptedBoxOperation(boxID)
	requireTransactionFinished(t, locked)
	if _, err = loadDocumentAtTransactionBoundary(fixture.childID, boxID, nil); err == nil {
		t.Fatal("locked notebook exposed its captured source through a cache")
	}
	if unchanged, readErr := os.ReadFile(path); readErr != nil || !bytes.Equal(unchanged, original) {
		t.Fatalf("locking changed the persisted encrypted document: %v", readErr)
	}
}
