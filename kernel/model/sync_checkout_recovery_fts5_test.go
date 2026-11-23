// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncCheckoutDefersDuringLargeIndexRecovery(t *testing.T) {
	const childEnv = "SIYUAN_TEST_SYNC_CHECKOUT_INDEX_RECOVERY"
	if os.Getenv(childEnv) == "" {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSyncCheckoutDefersDuringLargeIndexRecovery$", "-test.timeout=45s", "-test.v")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("sync checkout recovery subprocess: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}

	checkout := prepareSyncCheckoutStateTest(t)
	previousBlockTreeDB := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	t.Cleanup(func() { util.BlockTreeDBPath = previousBlockTreeDB })
	setupNotebookDocumentImportDatabase(t)

	const box = "20261123000000-box0001"
	const first = "20261123000001-doc0001"
	tree := treenode.NewTree(box, "/"+first+".sy", "/Recovery", "Recovery")
	if err := os.MkdirAll(filepath.Join(util.DataDir, box), 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	const firstRecord = "{\"action\":\"upsert\",\"box\":\"" + box + "\",\"id\":\"" + first + "\",\"path\":\"/" + first + ".sy\"}\n"
	const assetRecord = "{\"action\":\"delete_assets\",\"hashes\":[\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"]}\n"
	journal := append([]byte(firstRecord), bytes.Repeat([]byte(assetRecord), 34999)...)
	if err := os.WriteFile(filepath.Join(util.QueueDir, "index.queue"), journal, 0644); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(false)

	writing, resume, flushed := make(chan struct{}), make(chan struct{}), make(chan struct{})
	handler := func(id string) {
		if id == first {
			close(writing)
			<-resume
		}
	}
	eventbus.Subscribe(eventbus.EvtEmbeddingDirty, handler)
	go func() {
		defer close(flushed)
		sql.FlushQueue()
	}()
	var resumeOnce sync.Once
	resumeRecovery := func() {
		resumeOnce.Do(func() { close(resume) })
		<-flushed
	}
	defer func() {
		util.IsExiting.Store(true)
		resumeRecovery()
		util.IsExiting.Store(false)
	}()
	select {
	case <-writing:
	case <-time.After(5 * time.Second):
		t.Fatal("index recovery did not reach the first commit")
	}

	done := make(chan error, 1)
	start := time.Now()
	go func() { done <- checkout.prepareApply() }()
	select {
	case err := <-done:
		if !errors.Is(err, errSyncCheckoutBusy) {
			t.Fatalf("checkout entered write protection during index recovery: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("checkout waited for the index execution lock")
	}
	if state := GetSyncCheckout("", "").Task; state.Phase != "background" || state.Blocking {
		t.Fatalf("deferred checkout blocked the editor: %+v", state)
	}
	if !dataImportAccess.TryRLock() {
		t.Fatal("deferred checkout excluded editor writes")
	}
	dataImportAccess.RUnlock()
	if !flushLock.TryLock() {
		t.Fatal("deferred checkout held the editing transaction lock")
	}
	flushLock.Unlock()
	t.Logf("checkout deferred in %s with 35000 recovery records", time.Since(start))

	if err := checkout.prepareWriteProtection(false); err != nil {
		t.Fatalf("full snapshot restore could not enter write protection: %v", err)
	}
	checkout.completeApply()

	resumeRecovery()
	if err := checkout.prepareApply(); err != nil {
		t.Fatalf("checkout did not resume after index recovery: %v", err)
	}
	checkout.completeApply()
	if state := GetSyncCheckout("", "").Task; state.Phase != "background" || state.Blocking {
		t.Fatalf("completed checkout retained write protection: %+v", state)
	}
}
