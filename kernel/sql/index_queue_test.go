// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIndexQueueRenameRecovery(t *testing.T) {
	prepareIndexQueueTest(t)
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = oldDataDir })
	box := "20260915000000-hpath01"
	id := "20260915000001-hpath01"
	if err := os.MkdirAll(filepath.Join(util.DataDir, box), 0755); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(box, "/"+id+".sy", "/Latest", "Latest")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"rename", "rename_doc"} {
		entry := dbOpToIndexEntry(&dbQueueOperation{action: action, indexTree: tree})
		op, err := indexEntryToOp(*entry, lute.New(), "test rename recovery")
		if err != nil || op == nil || op.action != action || op.indexTree.HPath != "/Latest" {
			t.Fatalf("rename queue format did not recover: %s, %#v", action, op)
		}
	}

	RenameDocQueue(tree)
	latest := *tree
	latest.HPath = "/Newer"
	RenameDocQueue(&latest)
	other := *tree
	other.Box = "20260915000002-hpath02"
	RenameDocQueue(&other)
	ops, _ := getOperations()
	if len(ops) != 2 {
		t.Fatalf("unexpected coalesced operations: %d", len(ops))
	}
	byBox := map[string]*parse.Tree{}
	for _, op := range ops {
		byBox[op.indexTree.Box] = op.indexTree
	}
	if byBox[box].HPath != "/Newer" || byBox[other.Box].HPath != "/Latest" {
		t.Fatalf("rename coalescing crossed notebook boundaries: %#v", byBox)
	}
}

func TestIndexQueuePreservesOperationsAppendedDuringFlush(t *testing.T) {
	prepareIndexQueueTest(t)

	appendOperation(&dbQueueOperation{action: "delete_box", box: "first"})
	firstOps, firstSnapshot := getOperations()
	if 1 != len(firstOps) || "first" != firstOps[0].box {
		t.Fatalf("unexpected first queue snapshot: %#v", firstOps)
	}

	appendOperation(&dbQueueOperation{action: "delete_box", box: "second"})
	clearIndexQueue(firstSnapshot)

	entries := loadIndexQueue()
	if 1 != len(entries) || "second" != entries[0].Box {
		t.Fatalf("unexpected preserved index entries: %#v", entries)
	}

	secondOps, secondSnapshot := getOperations()
	if 1 != len(secondOps) || "second" != secondOps[0].box {
		t.Fatalf("unexpected pending queue operations: %#v", secondOps)
	}
	clearIndexQueue(secondSnapshot)
	if entries = loadIndexQueue(); 0 != len(entries) {
		t.Fatalf("unexpected remaining index entries: %#v", entries)
	}
}

func TestRecoverIndexQueueAfterRestart(t *testing.T) {
	prepareIndexQueueTest(t)

	appendOperation(&dbQueueOperation{action: "delete_box", box: "recovered"})
	dbQueueLock.Lock()
	operationQueue = nil
	dbQueueLock.Unlock()

	recoverIndexQueue()
	ops, snapshot := getOperations()
	if 1 != len(ops) || "recovered" != ops[0].box {
		t.Fatalf("unexpected recovered queue operations: %#v", ops)
	}
	clearIndexQueue(snapshot)
	if entries := loadIndexQueue(); 0 != len(entries) {
		t.Fatalf("unexpected remaining recovered entries: %#v", entries)
	}

	recoverIndexQueue()
	if ops, _ = getOperations(); 0 != len(ops) {
		t.Fatalf("unexpected repeated recovered operations: %#v", ops)
	}
}

func TestRecoverIndexQueueLoadsTreesOnlyWhenExecuted(t *testing.T) {
	prepareIndexQueueTest(t)
	var data bytes.Buffer
	for range 4380 {
		entry := indexEntry{Action: "index", ID: "20260922000000-index01", Box: "20260922000000-index02", Path: "/20260922000000-index01.sy"}
		if err := json.NewEncoder(&data).Encode(entry); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(util.QueueDir, "index.queue"), data.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	initIndexQueue()
	recoverIndexQueue()
	if len(operationQueue) != 4380 {
		t.Fatalf("recovery lost descriptors before their documents could be read: %d", len(operationQueue))
	}
	for _, op := range operationQueue {
		if op.recoveryEntry == nil || op.indexTree != nil || op.upsertTree != nil {
			t.Fatal("recovery retained a document tree")
		}
	}

	// 新编辑保留在恢复任务之后，不能覆盖恢复操作或解引用尚未加载的文档树。
	tree := &parse.Tree{ID: "20260922000000-index01", Box: "20260922000000-index02", Path: "/20260922000000-index01.sy"}
	IndexTreeQueue(tree)
	IndexTreeQueue(tree)
	if len(operationQueue) != 4381 || operationQueue[4380].indexTree != tree {
		t.Fatal("live indexing was coalesced into a recovery descriptor")
	}
}

func TestEmbedContentQueueRecoveryDescriptors(t *testing.T) {
	prepareIndexQueueTest(t)
	block := &Block{ID: "20261008000001-embed01", Box: "20261008000000-embed01", Content: "private derived content"}
	UpdateBlockContentQueue(block)
	entries := loadIndexQueue()
	if len(entries) != 1 || entries[0].Action != "update_block_content" || entries[0].ID != block.ID || entries[0].Box != block.Box {
		t.Fatalf("missing embed recovery descriptor: %#v", entries)
	}
	data, err := os.ReadFile(filepath.Join(util.QueueDir, "index.queue"))
	if err != nil || bytes.Contains(data, []byte(block.Content)) {
		t.Fatalf("derived content leaked to global recovery queue: %s, %v", data, err)
	}
	operationQueue = nil
	recoverIndexQueue()
	UpdateBlockContentQueue(block)
	latest := *block
	latest.Content = "new result"
	UpdateBlockContentQueue(&latest)
	other := *block
	other.Box = "20261008000000-embed02"
	UpdateBlockContentQueue(&other)
	if len(operationQueue) != 3 || operationQueue[0].recoveryEntry == nil || operationQueue[1].block.Content != latest.Content || operationQueue[2].block.Box != other.Box {
		t.Fatal("live embed update overwrote recovery or crossed notebook boundaries")
	}
}

func TestClearIndexQueuePreservesRawTail(t *testing.T) {
	prepareIndexQueueTest(t)
	appendOperation(&dbQueueOperation{action: "delete_box", box: "committed"})
	_, snapshot := getOperations()
	queuePath := filepath.Join(util.QueueDir, "index.queue")
	tail := []byte(`{"action":"future_action","extra":"` + strings.Repeat("x", 70000) + `"}` + "\n")
	f, err := os.OpenFile(queuePath, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write(tail); err != nil {
		t.Fatal(err)
	}
	f.Close()
	indexQueueSize.Add(int64(len(tail)))
	clearIndexQueue(snapshot)
	got, err := os.ReadFile(queuePath)
	if err != nil || !bytes.Equal(got, tail) || indexQueueSize.Load() != int64(len(tail)) {
		t.Fatalf("checkpoint changed pending bytes: %v", err)
	}
}

func TestIndexQueueRecoversLargeAndMalformedRecords(t *testing.T) {
	prepareIndexQueueTest(t)
	ids := make([]string, 5000)
	for i := range ids {
		ids[i] = "20261026000000-large01"
	}
	BatchRemoveTreeQueue(ids)
	queuePath := filepath.Join(util.QueueDir, "index.queue")
	f, err := os.OpenFile(queuePath, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	// A malformed record must not hide the valid records following it, and an
	// interrupted final append must not prevent recovery of earlier records.
	if _, err = f.WriteString("{invalid}\n"); err != nil {
		t.Fatal(err)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	BatchRemoveAssetsQueue([]string{strings.Repeat("a", 70000)})
	DeleteBoxQueue("last-valid-box")
	f, err = os.OpenFile(queuePath, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.WriteString(`{"action":`); err != nil {
		t.Fatal(err)
	}
	f.Close()
	before, err := os.ReadFile(queuePath)
	if err != nil {
		t.Fatal(err)
	}
	operationQueue = nil
	initIndexQueue()
	recoverIndexQueue()
	if len(operationQueue) != 3 {
		t.Fatalf("large or malformed record stopped recovery: %d operations", len(operationQueue))
	}
	first, second, last := operationQueue[0].recoveryEntry, operationQueue[1].recoveryEntry, operationQueue[2].recoveryEntry
	if first == nil || first.Action != "delete_ids" || len(first.IDs) != len(ids) ||
		second == nil || second.Action != "delete_assets" || len(second.Hashes[0]) != 70000 ||
		last == nil || last.Box != "last-valid-box" {
		t.Fatalf("recovery changed record contents: %#v", operationQueue)
	}
	after, err := os.ReadFile(queuePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("loading changed original recovery bytes: %v", err)
	}
}

func TestIndexQueueCoalescedLocationsArePersisted(t *testing.T) {
	for name, enqueue := range map[string]func(*parse.Tree){
		"index": IndexTreeQueue, "move": MoveTreeQueue, "rename": RenameDocQueue,
		"update_refs": UpdateRefsTreeQueue, "delete_refs": DeleteRefsTreeQueue,
	} {
		t.Run(name, func(t *testing.T) {
			prepareIndexQueueTest(t)
			first := &parse.Tree{ID: "20261026000000-move001", Box: "20261026000000-box0001", Path: "/first.sy"}
			latest := *first
			latest.Path = "/latest.sy"
			enqueue(first)
			enqueue(&latest)
			enqueue(&latest)
			if len(operationQueue) != 1 || len(loadIndexQueue()) != 2 {
				t.Fatal("coalescing lost a new location or duplicated an unchanged descriptor")
			}
			operationQueue = nil
			recoverIndexQueue()
			if len(operationQueue) != 2 || operationQueue[1].recoveryEntry.Path != latest.Path {
				t.Fatal("restart did not retain latest coalesced location")
			}
		})
	}
}

type indexQueueFailingWriter struct {
	bytes.Buffer
	writeErr, closeErr error
	short, closed      bool
}

func (w *indexQueueFailingWriter) Write(data []byte) (int, error) {
	if w.short {
		return len(data) - 1, w.writeErr
	}
	if w.writeErr != nil {
		return 0, w.writeErr
	}
	return w.Buffer.Write(data)
}

func (w *indexQueueFailingWriter) Close() error {
	w.closed = true
	return w.closeErr
}

func TestIndexQueueRecordReportsWriteAndCloseFailures(t *testing.T) {
	writeErr, closeErr := errors.New("write failed"), errors.New("close failed")
	for _, writer := range []*indexQueueFailingWriter{{writeErr: writeErr}, {closeErr: closeErr},
		{writeErr: writeErr, closeErr: closeErr}, {short: true}, {}} {
		err := writeIndexQueueRecord(writer, []byte("record\n"))
		if !writer.closed || !errors.Is(err, writer.writeErr) && writer.writeErr != nil ||
			!errors.Is(err, writer.closeErr) && writer.closeErr != nil || writer.short && !errors.Is(err, io.ErrShortWrite) {
			t.Fatalf("write/close failure was lost: %+v, %v", writer, err)
		}
		if writer.writeErr == nil && writer.closeErr == nil && !writer.short && err != nil {
			t.Fatalf("successful append failed: %v", err)
		}
	}
}

func TestIndexQueueAppendFailureKeepsLiveOperation(t *testing.T) {
	prepareIndexQueueTest(t)
	previousFailure := indexQueueWriteFailed.Load()
	t.Cleanup(func() { indexQueueWriteFailed.Store(previousFailure) })
	queuePath := filepath.Join(util.QueueDir, "index.queue")
	if err := os.Mkdir(queuePath, 0755); err != nil {
		t.Fatal(err)
	}
	op := &dbQueueOperation{action: "delete_box", box: "retained"}
	if err := appendToIndexQueue(op); err == nil {
		t.Fatal("journal open failure was not returned")
	}
	appendOperation(op)
	if len(operationQueue) != 1 || operationQueue[0] != op || !indexQueueWriteFailed.Load() {
		t.Fatal("journal failure lost live operation or warning state")
	}
	if err := os.Remove(queuePath); err != nil {
		t.Fatal(err)
	}
	appendOperation(&dbQueueOperation{action: "delete_box", box: "next"})
	if indexQueueWriteFailed.Load() || len(loadIndexQueue()) != 1 || len(operationQueue) != 2 {
		t.Fatal("journal recovery did not reset warning or preserve memory work")
	}
}

func prepareIndexQueueTest(t *testing.T) {
	t.Helper()

	oldQueueDir := util.QueueDir
	oldIndexFlock := indexFlock
	oldIndexQueueSize := indexQueueSize.Load()

	dbQueueLock.Lock()
	oldOperationQueue := operationQueue
	operationQueue = nil
	dbQueueLock.Unlock()

	util.QueueDir = t.TempDir()
	initIndexQueue()
	t.Cleanup(func() {
		dbQueueLock.Lock()
		operationQueue = oldOperationQueue
		dbQueueLock.Unlock()
		util.QueueDir = oldQueueDir
		indexFlock = oldIndexFlock
		indexQueueSize.Store(oldIndexQueueSize)
	})
}
