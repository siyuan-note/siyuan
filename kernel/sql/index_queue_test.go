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
	"os"
	"path/filepath"
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
		op := indexEntryToOp(*entry, lute.New(), "test rename recovery")
		if op == nil || op.action != action || op.indexTree.HPath != "/Latest" {
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
