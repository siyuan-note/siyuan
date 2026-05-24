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
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/gofrs/flock"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	indexMu        sync.Mutex
	indexQueueSize atomic.Int64
	indexFlock     *flock.Flock
)

type indexEntry struct {
	Action string   `json:"action"`
	ID     string   `json:"id,omitempty"`
	IDs    []string `json:"ids,omitempty"`
	Box    string   `json:"box,omitempty"`
	Path   string   `json:"path,omitempty"`
	Hashes []string `json:"hashes,omitempty"`
}

func initIndexQueue() {
	indexQueuePath := filepath.Join(util.QueueDir, "index.queue")
	os.MkdirAll(util.QueueDir, 0755)
	indexFlock = flock.New(indexQueuePath + ".lock")
	fi, err := os.Stat(indexQueuePath)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.LogErrorf("stat index queue file [%s] failed: %s", indexQueuePath, err)
		}
		return
	}
	indexQueueSize.Store(fi.Size())
}

func closeIndexQueue() {
	os.Remove(filepath.Join(util.QueueDir, "index.queue.lock"))
}

func appendToIndexQueue(op *dbQueueOperation) {
	entry := dbOpToIndexEntry(op)
	if nil == entry {
		return
	}

	data, err := json.Marshal(entry)
	if err != nil {
		logging.LogErrorf("marshal index queue entry failed: %s", err)
		return
	}
	data = append(data, '\n')

	_ = indexFlock.Lock()
	defer func() { _ = indexFlock.Unlock() }()

	indexMu.Lock()
	defer indexMu.Unlock()

	indexQueuePath := filepath.Join(util.QueueDir, "index.queue")
	f, err := os.OpenFile(indexQueuePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		logging.LogErrorf("open index queue for append failed: %s", err)
		return
	}
	n, err := f.Write(data)
	f.Close()
	if err != nil {
		logging.LogErrorf("write index queue failed: %s", err)
		return
	}
	indexQueueSize.Add(int64(n))
}

func dbOpToIndexEntry(op *dbQueueOperation) *indexEntry {
	switch op.action {
	case "upsert":
		return &indexEntry{Action: "upsert", ID: op.upsertTree.ID, Box: op.upsertTree.Box, Path: op.upsertTree.Path}
	case "index":
		return &indexEntry{Action: "index", ID: op.indexTree.ID, Box: op.indexTree.Box, Path: op.indexTree.Path}
	case "rename":
		return &indexEntry{Action: "rename", ID: op.indexTree.ID, Box: op.indexTree.Box, Path: op.indexTree.Path}
	case "move":
		return &indexEntry{Action: "move", ID: op.indexTree.ID, Box: op.indexTree.Box, Path: op.indexTree.Path}
	case "update_refs":
		return &indexEntry{Action: "update_refs", ID: op.upsertTree.ID, Box: op.upsertTree.Box, Path: op.upsertTree.Path}
	case "delete_refs":
		return &indexEntry{Action: "delete_refs", ID: op.upsertTree.ID, Box: op.upsertTree.Box, Path: op.upsertTree.Path}
	case "delete":
		return &indexEntry{Action: "delete", Box: op.removeTreeBox, Path: op.removeTreePath}
	case "delete_id":
		return &indexEntry{Action: "delete_id", ID: op.removeTreeID}
	case "delete_ids":
		return &indexEntry{Action: "delete_ids", IDs: op.removeTreeIDs}
	case "delete_box":
		return &indexEntry{Action: "delete_box", Box: op.box}
	case "delete_box_refs":
		return &indexEntry{Action: "delete_box_refs", Box: op.box}
	case "delete_assets":
		return &indexEntry{Action: "delete_assets", Hashes: op.removeAssetHashes}
	case "index_node":
		return &indexEntry{Action: "index_node", ID: op.id}
	default:
		return nil
	}
}

func clearIndexQueue(snapshotSize int64) {
	_ = indexFlock.Lock()
	defer func() { _ = indexFlock.Unlock() }()

	indexMu.Lock()
	defer indexMu.Unlock()

	indexQueuePath := filepath.Join(util.QueueDir, "index.queue")

	var preserved []indexEntry
	fi, err := os.Stat(indexQueuePath)
	if err == nil && fi.Size() > snapshotSize {
		preserved = readIndexEntriesFrom(indexQueuePath, snapshotSize)
	}

	f, err := os.Create(indexQueuePath)
	if err != nil {
		logging.LogErrorf("create index queue file failed: %s", err)
		return
	}

	newSize := int64(0)
	for _, e := range preserved {
		data, _ := json.Marshal(e)
		data = append(data, '\n')
		n, _ := f.Write(data)
		newSize += int64(n)
	}
	f.Close()
	indexQueueSize.Store(newSize)
}

func readIndexEntriesFrom(indexQueuePath string, offset int64) (entries []indexEntry) {
	f, err := os.Open(indexQueuePath)
	if err != nil {
		return
	}
	defer f.Close()

	if _, err = f.Seek(offset, 0); err != nil {
		return
	}

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if 0 == len(line) {
			continue
		}
		var entry indexEntry
		if nil == json.Unmarshal(line, &entry) {
			entries = append(entries, entry)
		}
	}
	return
}

func clearIndexQueueEntries() {
	indexMu.Lock()
	defer indexMu.Unlock()

	indexQueuePath := filepath.Join(util.QueueDir, "index.queue")
	if gulu.File.IsExist(indexQueuePath) {
		if err := os.Truncate(indexQueuePath, 0); err != nil {
			logging.LogErrorf("clear index queue failed: %s", err)
		}
	}
	indexQueueSize.Store(0)
}

func loadIndexQueue() (entries []indexEntry) {
	indexQueuePath := filepath.Join(util.QueueDir, "index.queue")
	f, err := os.Open(indexQueuePath)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.LogErrorf("open index queue for reading failed: %s", err)
		}
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if 0 == len(line) {
			continue
		}
		var entry indexEntry
		if err = json.Unmarshal(line, &entry); err != nil {
			logging.LogWarnf("skip corrupted index queue line: %s", err)
			continue
		}
		entries = append(entries, entry)
	}
	if err = scanner.Err(); err != nil {
		logging.LogErrorf("scan index queue failed: %s", err)
	}
	return
}

func recoverIndexQueue() {
	entries := loadIndexQueue()
	if 1 > len(entries) {
		return
	}

	logging.LogInfof("recovering [%d] index queue operations", len(entries))

	luteEngine := lute.New()
	dbQueueLock.Lock()
	for _, e := range entries {
		op := indexEntryToOp(e, luteEngine, "recover index queue")
		if nil == op {
			continue
		}
		operationQueue = append(operationQueue, op)
	}
	dbQueueLock.Unlock()

	eventbus.Publish(eventbus.EvtSQLIndexChanged)
	logging.LogInfof("recovered [%d] index queue operations, will be flushed soon", len(entries))
}

func indexEntryToOp(e indexEntry, luteEngine *lute.Lute, prefix string) *dbQueueOperation {
	switch e.Action {
	case "upsert":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logging.LogWarnf("%s upsert: load tree [%s/%s] failed: %s", prefix, e.Box, e.Path, err)
			return nil
		}
		return &dbQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "upsert"}
	case "index":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logging.LogWarnf("%s index: load tree [%s/%s] failed: %s", prefix, e.Box, e.Path, err)
			return nil
		}
		return &dbQueueOperation{indexTree: tree, inQueueTime: time.Now(), action: "index"}
	case "rename":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logging.LogWarnf("%s rename: load tree [%s/%s] failed: %s", prefix, e.Box, e.Path, err)
			return nil
		}
		return &dbQueueOperation{indexTree: tree, inQueueTime: time.Now(), action: "rename"}
	case "move":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logging.LogWarnf("%s move: load tree [%s/%s] failed: %s", prefix, e.Box, e.Path, err)
			return nil
		}
		return &dbQueueOperation{indexTree: tree, inQueueTime: time.Now(), action: "move"}
	case "update_refs":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logging.LogWarnf("%s update_refs: load tree [%s/%s] failed: %s", prefix, e.Box, e.Path, err)
			return nil
		}
		return &dbQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "update_refs"}
	case "delete_refs":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logging.LogWarnf("%s delete_refs: load tree [%s/%s] failed: %s", prefix, e.Box, e.Path, err)
			return nil
		}
		return &dbQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "delete_refs"}
	case "delete":
		return &dbQueueOperation{removeTreeBox: e.Box, removeTreePath: e.Path, inQueueTime: time.Now(), action: "delete"}
	case "delete_id":
		return &dbQueueOperation{removeTreeID: e.ID, inQueueTime: time.Now(), action: "delete_id"}
	case "delete_ids":
		return &dbQueueOperation{removeTreeIDs: e.IDs, inQueueTime: time.Now(), action: "delete_ids"}
	case "delete_box":
		return &dbQueueOperation{box: e.Box, inQueueTime: time.Now(), action: "delete_box"}
	case "delete_box_refs":
		return &dbQueueOperation{box: e.Box, inQueueTime: time.Now(), action: "delete_box_refs"}
	case "delete_assets":
		return &dbQueueOperation{removeAssetHashes: e.Hashes, inQueueTime: time.Now(), action: "delete_assets"}
	case "index_node":
		return &dbQueueOperation{id: e.ID, inQueueTime: time.Now(), action: "index_node"}
	}
	return nil
}
