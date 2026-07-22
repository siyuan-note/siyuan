// SiYuan - Refactor your thinking
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
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

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
