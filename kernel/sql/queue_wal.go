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

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	walMu   sync.Mutex
	walSize atomic.Int64
)

type walEntry struct {
	Action string   `json:"action"`
	ID     string   `json:"id,omitempty"`
	IDs    []string `json:"ids,omitempty"`
	Box    string   `json:"box,omitempty"`
	Path   string   `json:"path,omitempty"`
	Hashes []string `json:"hashes,omitempty"`
}

func initQueueWAL() {
	walPath := filepath.Join(util.TempDir, "queue.wal")
	fi, err := os.Stat(walPath)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.LogErrorf("stat WAL file [%s] failed: %s", walPath, err)
		}
		return
	}
	walSize.Store(fi.Size())
}

func closeQueueWAL() {}

func appendToWAL(op *dbQueueOperation) {
	entry := dbOpToWALEntry(op)
	if nil == entry {
		return
	}

	data, err := json.Marshal(entry)
	if err != nil {
		logging.LogErrorf("marshal WAL entry failed: %s", err)
		return
	}
	data = append(data, '\n')

	walMu.Lock()
	defer walMu.Unlock()

	walPath := filepath.Join(util.TempDir, "queue.wal")
	f, err := os.OpenFile(walPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		logging.LogErrorf("open WAL for append failed: %s", err)
		return
	}
	n, err := f.Write(data)
	f.Close()
	if err != nil {
		logging.LogErrorf("write WAL failed: %s", err)
		return
	}
	walSize.Add(int64(n))
}

func dbOpToWALEntry(op *dbQueueOperation) *walEntry {
	switch op.action {
	case "upsert":
		return &walEntry{Action: "upsert", ID: op.upsertTree.ID, Box: op.upsertTree.Box, Path: op.upsertTree.Path}
	case "index":
		return &walEntry{Action: "index", ID: op.indexTree.ID, Box: op.indexTree.Box, Path: op.indexTree.Path}
	case "rename":
		return &walEntry{Action: "rename", ID: op.indexTree.ID, Box: op.indexTree.Box, Path: op.indexTree.Path}
	case "move":
		return &walEntry{Action: "move", ID: op.indexTree.ID, Box: op.indexTree.Box, Path: op.indexTree.Path}
	case "update_refs":
		return &walEntry{Action: "update_refs", ID: op.upsertTree.ID, Box: op.upsertTree.Box, Path: op.upsertTree.Path}
	case "delete_refs":
		return &walEntry{Action: "delete_refs", ID: op.upsertTree.ID, Box: op.upsertTree.Box, Path: op.upsertTree.Path}
	case "delete":
		return &walEntry{Action: "delete", Box: op.removeTreeBox, Path: op.removeTreePath}
	case "delete_id":
		return &walEntry{Action: "delete_id", ID: op.removeTreeID}
	case "delete_ids":
		return &walEntry{Action: "delete_ids", IDs: op.removeTreeIDs}
	case "delete_box":
		return &walEntry{Action: "delete_box", Box: op.box}
	case "delete_box_refs":
		return &walEntry{Action: "delete_box_refs", Box: op.box}
	case "delete_assets":
		return &walEntry{Action: "delete_assets", Hashes: op.removeAssetHashes}
	case "index_node":
		return &walEntry{Action: "index_node", ID: op.id}
	default:
		return nil
	}
}

func clearWAL(snapshotSize int64) {
	walMu.Lock()
	defer walMu.Unlock()

	walPath := filepath.Join(util.TempDir, "queue.wal")

	var preserved []walEntry
	currentSize := walSize.Load()
	if currentSize > snapshotSize {
		preserved = readWALEntriesFrom(walPath, snapshotSize)
	}

	f, err := os.Create(walPath)
	if err != nil {
		logging.LogErrorf("create WAL file failed: %s", err)
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
	walSize.Store(newSize)
}

func readWALEntriesFrom(walPath string, offset int64) (entries []walEntry) {
	f, err := os.Open(walPath)
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
		var entry walEntry
		if nil == json.Unmarshal(line, &entry) {
			entries = append(entries, entry)
		}
	}
	return
}

func clearWALEntries() {
	walMu.Lock()
	defer walMu.Unlock()

	walPath := filepath.Join(util.TempDir, "queue.wal")
	if err := os.Truncate(walPath, 0); err != nil {
		logging.LogErrorf("clear WAL failed: %s", err)
	}
	walSize.Store(0)
}

func loadWAL() (entries []walEntry) {
	walPath := filepath.Join(util.TempDir, "queue.wal")
	f, err := os.Open(walPath)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.LogErrorf("open WAL for reading failed: %s", err)
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
		var entry walEntry
		if err = json.Unmarshal(line, &entry); err != nil {
			logging.LogWarnf("skip corrupted WAL line: %s", err)
			continue
		}
		entries = append(entries, entry)
	}
	if err = scanner.Err(); err != nil {
		logging.LogErrorf("scan WAL failed: %s", err)
	}
	return
}

func recoverWAL() {
	entries := loadWAL()
	if 1 > len(entries) {
		return
	}

	logging.LogInfof("recovering [%d] WAL operations", len(entries))

	luteEngine := lute.New()

	for _, e := range entries {
		switch e.Action {
		case "upsert":
			tree, err := loadTreeFromDisk(e.Box, e.Path, luteEngine)
			if err != nil {
				logging.LogWarnf("recover WAL upsert: load tree [%s/%s] failed: %s", e.Box, e.Path, err)
				continue
			}
			UpsertTreeQueue(tree)
		case "index":
			tree, err := loadTreeFromDisk(e.Box, e.Path, luteEngine)
			if err != nil {
				logging.LogWarnf("recover WAL index: load tree [%s/%s] failed: %s", e.Box, e.Path, err)
				continue
			}
			IndexTreeQueue(tree)
		case "rename":
			tree, err := loadTreeFromDisk(e.Box, e.Path, luteEngine)
			if err != nil {
				logging.LogWarnf("recover WAL rename: load tree [%s/%s] failed: %s", e.Box, e.Path, err)
				continue
			}
			RenameTreeQueue(tree)
		case "move":
			tree, err := loadTreeFromDisk(e.Box, e.Path, luteEngine)
			if err != nil {
				logging.LogWarnf("recover WAL move: load tree [%s/%s] failed: %s", e.Box, e.Path, err)
				continue
			}
			MoveTreeQueue(tree)
		case "update_refs":
			tree, err := loadTreeFromDisk(e.Box, e.Path, luteEngine)
			if err != nil {
				logging.LogWarnf("recover WAL update_refs: load tree [%s/%s] failed: %s", e.Box, e.Path, err)
				continue
			}
			UpdateRefsTreeQueue(tree)
		case "delete_refs":
			tree, err := loadTreeFromDisk(e.Box, e.Path, luteEngine)
			if err != nil {
				logging.LogWarnf("recover WAL delete_refs: load tree [%s/%s] failed: %s", e.Box, e.Path, err)
				continue
			}
			DeleteRefsTreeQueue(tree)
		case "delete":
			RemoveTreePathQueue(e.Box, e.Path)
		case "delete_id":
			RemoveTreeQueue(e.ID)
		case "delete_ids":
			BatchRemoveTreeQueue(e.IDs)
		case "delete_box":
			DeleteBoxQueue(e.Box)
		case "delete_box_refs":
			DeleteBoxRefsQueue(e.Box)
		case "delete_assets":
			BatchRemoveAssetsQueue(e.Hashes)
		case "index_node":
			IndexNodeQueue(e.ID)
		}
	}

	logging.LogInfof("recovered [%d] WAL operations, will be flushed soon", len(entries))
}

func loadTreeFromDisk(box, p string, luteEngine *lute.Lute) (tree *parse.Tree, err error) {
	filePath := filepath.Join(util.DataDir, box, p)
	data, err := filelock.ReadFile(filePath)
	if err != nil {
		return
	}

	tree, _, err = dataparser.ParseJSON(data, luteEngine.ParseOptions)
	if err != nil {
		return
	}
	tree.Box = box
	tree.Path = p
	return
}
