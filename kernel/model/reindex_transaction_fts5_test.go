// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFullReindexTransactionBoundary(t *testing.T) {
	const childEnv = "SIYUAN_TEST_REINDEX_TRANSACTION_BOUNDARY"
	if os.Getenv(childEnv) == "" {
		command := exec.Command(os.Args[0], "-test.run=^TestFullReindexTransactionBoundary$", "-test.timeout=60s", "-test.v")
		command.Env = append(os.Environ(), childEnv+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("reindex transaction regression failed: %v\n%s", err, output)
		}
		return
	}
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	system := conf.NewSystem()
	system.ID = "reindex-test"
	Conf.System.Store(system)
	Conf.Flashcard.Store(conf.NewFlashcard())
	util.TempDir = t.TempDir()
	t.Cleanup(closeFlashcardV2Store)
	util.HistoryDir = filepath.Join(t.TempDir(), "history")
	cache.PutDocIALInBox(fixture.sourcePath, fixture.box.ID, map[string]string{"test": "before-rebuild"})
	filename := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	filelock.Lock(filename)
	locked := true
	finished := make(chan struct{})
	go func() { defer close(finished); fullReindex() }()
	defer func() {
		if locked {
			filelock.Unlock(filename)
		}
		<-finished
	}()
	deadline := time.Now().Add(5 * time.Second)
	for cache.GetDocIALInBox(fixture.sourcePath, fixture.box.ID) != nil {
		if time.Now().After(deadline) {
			t.Fatal("rebuild did not clear the source cache")
		}
		time.Sleep(time.Millisecond)
	}
	if flushLock.TryLock() {
		flushLock.Unlock()
		t.Fatal("rebuild cleared source caches without the transaction execution lock")
	}
	queued := &Transaction{DoOperations: []*Operation{{Action: "setAttrs", ID: fixture.childID, Data: `{"custom-test-queued":"saved"}`}}}
	transactions := []*Transaction{queued}
	PerformTransactions(&transactions)
	queuedDone := waitForTransactionInTest(queued)
	synchronous := make(chan error, 1)
	go func() {
		synchronous <- PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "setAttrs", ID: fixture.targetID, Data: `{"custom-test-sync":"saved"}`}}})
	}()
	requireTransactionWaiting(t, queuedDone)
	select {
	case err := <-synchronous:
		t.Fatalf("synchronous transaction entered an unfinished rebuild: %v", err)
	case <-time.After(30 * time.Millisecond):
	}
	filelock.Unlock(filename)
	locked = false
	select {
	case <-finished:
	case <-time.After(15 * time.Second):
		t.Fatal("rebuild did not finish after source read resumed")
	}
	requireTransactionFinished(t, queuedDone)
	select {
	case err := <-synchronous:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("synchronous transaction did not resume after rebuild")
	}
	sql.FlushQueue()
	for _, check := range []struct{ path, id, attribute string }{
		{fixture.sourcePath, fixture.childID, "custom-test-queued"},
		{fixture.targetPath, fixture.targetID, "custom-test-sync"},
	} {
		tree, _, err := filesys.ReadTreeSnapshot(fixture.box.ID, check.path)
		if err != nil {
			t.Fatal(err)
		}
		node := treenode.GetNodeInTree(tree, check.id)
		if node == nil || node.IALAttr(check.attribute) != "saved" {
			t.Fatalf("transaction edit was not retained after rebuild: %s", check.attribute)
		}
	}
	for _, scenario := range []struct {
		name string
		busy bool
	}{
		{"snapshot-restore", false},
		{"nested-busy-state", true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			flushLock.Lock()
			defer flushLock.Unlock()
			isFlushing.Store(scenario.busy)
			defer isFlushing.Store(false)
			cache.PutDocIALInBox(fixture.sourcePath, fixture.box.ID, map[string]string{"test": "before-rebuild"})
			filelock.Lock(filename)
			locked := true
			finished := make(chan struct{})
			var flushed chan struct{}
			go func() { defer close(finished); fullReindexWithTxFlush(false) }()
			defer func() {
				if locked {
					filelock.Unlock(filename)
				}
				<-finished
				isFlushing.Store(false)
				if flushed != nil {
					<-flushed
				}
			}()
			deadline := time.Now().Add(5 * time.Second)
			for cache.GetDocIALInBox(fixture.sourcePath, fixture.box.ID) != nil {
				if time.Now().After(deadline) {
					t.Fatal("already-locked rebuild did not clear the source cache")
				}
				time.Sleep(time.Millisecond)
			}
			if !isFlushing.Load() {
				t.Fatal("already-locked rebuild did not mark transactions busy")
			}
			flushed = make(chan struct{})
			go func() { FlushTxQueue(); close(flushed) }()
			select {
			case <-flushed:
				t.Fatal("transaction wait completed before snapshot restoration was indexed")
			case <-time.After(30 * time.Millisecond):
			}
			filelock.Unlock(filename)
			locked = false
			select {
			case <-finished:
			case <-time.After(15 * time.Second):
				t.Fatal("already-locked rebuild acquired the transaction lock again")
			}
			if isFlushing.Load() != scenario.busy {
				t.Fatal("already-locked rebuild changed the caller's busy state")
			}
			isFlushing.Store(false)
			select {
			case <-flushed:
			case <-time.After(time.Second):
				t.Fatal("transaction wait did not complete after snapshot restoration")
			}
			for _, check := range []struct{ id, attribute string }{
				{fixture.childID, "custom-test-queued"},
				{fixture.targetID, "custom-test-sync"},
			} {
				block := sql.GetBlock(check.id)
				if block == nil || !strings.Contains(block.IAL, check.attribute+`="saved"`) {
					t.Fatalf("restored block attributes were not indexed: %s, %+v", check.id, block)
				}
			}
		})
	}
}
