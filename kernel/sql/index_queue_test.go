// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package sql

import (
	"bytes"
	"encoding/json"
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
