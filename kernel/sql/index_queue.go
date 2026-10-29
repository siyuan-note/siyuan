// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/gofrs/flock"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	indexMu               sync.Mutex
	indexQueueSize        atomic.Int64
	indexFlock            *flock.Flock
	indexQueueWriteFailed atomic.Bool

	// HPathRefreshLock 在重建索引前阻止路径任务写回；锁顺序为路径任务锁、数据库初始化锁、索引队列锁。
	HPathRefreshLock sync.Mutex
	// ResetHPathRefreshQueue 由模型层注入，在持有 HPathRefreshLock 时同步清理普通索引的路径恢复记录。
	ResetHPathRefreshQueue func() error
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

func appendToIndexQueue(op *dbQueueOperation) error {
	entry := dbOpToIndexEntry(op)
	if nil == entry {
		return nil
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("marshal index queue entry: %w", err)
	}
	data = append(data, '\n')

	if err = indexFlock.Lock(); err != nil {
		return fmt.Errorf("lock index queue: %w", err)
	}
	defer func() { _ = indexFlock.Unlock() }()

	indexMu.Lock()
	defer indexMu.Unlock()

	indexQueuePath := filepath.Join(util.QueueDir, "index.queue")
	f, err := os.OpenFile(indexQueuePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("open index queue for append: %w", err)
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return fmt.Errorf("stat index queue: %w", err)
	}
	if err = writeIndexQueueRecord(f, data); err != nil {
		// A partial append must not merge into the next JSON record. Preserve
		// the previous records; the in-memory operation remains executable.
		truncateErr := os.Truncate(indexQueuePath, info.Size())
		if truncateErr == nil {
			indexQueueSize.Store(info.Size())
		} else if current, statErr := os.Stat(indexQueuePath); statErr == nil {
			indexQueueSize.Store(current.Size())
		}
		return fmt.Errorf("write index queue: %w", errors.Join(err, truncateErr))
	}
	indexQueueSize.Store(info.Size() + int64(len(data)))
	return nil
}

func writeIndexQueueRecord(file io.WriteCloser, data []byte) error {
	n, writeErr := file.Write(data)
	if writeErr == nil && n != len(data) {
		writeErr = io.ErrShortWrite
	}
	return errors.Join(writeErr, file.Close())
}

func recordIndexOperation(op *dbQueueOperation) {
	if err := appendToIndexQueue(op); err != nil {
		logging.LogErrorf("persist index recovery operation failed: %s", err)
		if !indexQueueWriteFailed.Swap(true) {
			util.PushErrMsg(util.Langs[util.Lang][444], 0)
		}
		return
	}
	indexQueueWriteFailed.Store(false)
}

func dbOpToIndexEntry(op *dbQueueOperation) *indexEntry {
	if op.recoveryEntry != nil {
		return op.recoveryEntry
	}
	switch op.action {
	case "upsert":
		return &indexEntry{Action: "upsert", ID: op.upsertTree.ID, Box: op.upsertTree.Box, Path: op.upsertTree.Path}
	case "index":
		return &indexEntry{Action: "index", ID: op.indexTree.ID, Box: op.indexTree.Box, Path: op.indexTree.Path}
	case "rename", "rename_doc":
		return &indexEntry{Action: op.action, ID: op.indexTree.ID, Box: op.indexTree.Box, Path: op.indexTree.Path}
	case "move":
		return &indexEntry{Action: "move", ID: op.indexTree.ID, Box: op.indexTree.Box, Path: op.indexTree.Path}
	case "update_refs":
		return &indexEntry{Action: "update_refs", ID: op.upsertTree.ID, Box: op.upsertTree.Box, Path: op.upsertTree.Path}
	case "delete_refs":
		return &indexEntry{Action: "delete_refs", ID: op.upsertTree.ID, Box: op.upsertTree.Box, Path: op.upsertTree.Path}
	case "delete":
		return &indexEntry{Action: "delete", Box: op.removeTreeBox, Path: op.removeTreePath}
	case "delete_id":
		return &indexEntry{Action: "delete_id", ID: op.removeTreeID, Box: op.removeTreeBox}
	case "delete_ids":
		return &indexEntry{Action: "delete_ids", IDs: op.removeTreeIDs}
	case "delete_box":
		return &indexEntry{Action: "delete_box", Box: op.box}
	case "delete_box_refs":
		return &indexEntry{Action: "delete_box_refs", Box: op.box}
	case "delete_assets":
		return &indexEntry{Action: "delete_assets", Hashes: op.removeAssetHashes}
	case "refresh_def_refs":
		return &indexEntry{Action: op.action, Box: op.box, IDs: op.refreshDefIDs}
	case "index_node":
		return &indexEntry{Action: "index_node", ID: op.id, Box: op.box}
	case "update_block_content":
		return &indexEntry{Action: op.action, ID: op.block.ID, Box: op.block.Box}
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

	data, err := os.ReadFile(indexQueuePath)
	if err != nil {
		if os.IsNotExist(err) && snapshotSize == 0 {
			return
		}
		logging.LogErrorf("read index queue file failed: %s", err)
		return
	}
	if snapshotSize < 0 || snapshotSize > int64(len(data)) {
		logging.LogErrorf("invalid index queue snapshot [%d/%d]", snapshotSize, len(data))
		return
	}
	// 安全移除已提交的前缀，保留刷新期间追加的原始记录，写入失败时原队列仍可恢复。
	remaining := data[snapshotSize:]
	if err = gulu.File.WriteFileSafer(indexQueuePath, remaining, 0644); err != nil {
		logging.LogErrorf("save index queue failed: %s", err)
		return
	}
	indexQueueSize.Store(int64(len(remaining)))
}

func clearIndexQueueEntries() {
	// 调用方持有 HPathRefreshLock；普通队列刷新只清理自身快照，不会进入这里。
	if ResetHPathRefreshQueue != nil {
		if err := ResetHPathRefreshQueue(); err != nil {
			logging.LogErrorf("clear hpath refresh queue failed: %s", err)
		}
	}
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

	reader := bufio.NewReader(f)
	for {
		// Batch operations have no fixed record-size limit. Read one complete line
		// instead of stopping recovery at Scanner's default 64 KiB token limit.
		line, readErr := reader.ReadBytes('\n')
		if readErr != nil && readErr != io.EOF {
			logging.LogErrorf("read index queue failed: %s", readErr)
			return
		}
		if len(line) > 0 && string(line) != "\n" && string(line) != "\r\n" {
			var entry indexEntry
			if err = json.Unmarshal(line, &entry); err != nil {
				logging.LogWarnf("skip corrupted index queue line: %s", err)
			} else {
				entries = append(entries, entry)
			}
		}
		if readErr == io.EOF {
			return
		}
	}
}

func recoverIndexQueue() {
	entries := loadIndexQueue()
	if 1 > len(entries) {
		return
	}

	logging.LogInfof("recovering [%d] index queue operations", len(entries))

	dbQueueLock.Lock()
	for _, e := range entries {
		// 只恢复操作描述，执行时再读取文档，避免启动时同时持有所有文档树。
		entry := e
		operationQueue = append(operationQueue, &dbQueueOperation{
			action: e.Action, box: e.Box, id: e.ID, recoveryEntry: &entry, inQueueTime: time.Now(),
		})
	}
	dbQueueLock.Unlock()

	eventbus.Publish(eventbus.EvtSQLIndexChanged)
	logging.LogInfof("recovered [%d] index queue operations, will be flushed soon", len(entries))
}

func indexEntryToOp(e indexEntry, luteEngine *lute.Lute, prefix string) (*dbQueueOperation, error) {
	switch e.Action {
	case "upsert":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logIndexEntryLoadError(prefix, "upsert", e, err)
			return nil, err
		}
		return &dbQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "upsert"}, nil
	case "index":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logIndexEntryLoadError(prefix, "index", e, err)
			return nil, err
		}
		return &dbQueueOperation{indexTree: tree, inQueueTime: time.Now(), action: "index", recoveredIndex: true}, nil
	case "rename", "rename_doc":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logIndexEntryLoadError(prefix, "rename", e, err)
			return nil, err
		}
		return &dbQueueOperation{indexTree: tree, inQueueTime: time.Now(), action: e.Action}, nil
	case "move":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logIndexEntryLoadError(prefix, "move", e, err)
			return nil, err
		}
		return &dbQueueOperation{indexTree: tree, inQueueTime: time.Now(), action: "move"}, nil
	case "update_refs":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logIndexEntryLoadError(prefix, "update_refs", e, err)
			return nil, err
		}
		return &dbQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "update_refs"}, nil
	case "delete_refs":
		tree, err := filesys.LoadTree(e.Box, e.Path, luteEngine)
		if err != nil {
			logIndexEntryLoadError(prefix, "delete_refs", e, err)
			return nil, err
		}
		return &dbQueueOperation{upsertTree: tree, inQueueTime: time.Now(), action: "delete_refs"}, nil
	case "delete":
		return &dbQueueOperation{removeTreeBox: e.Box, removeTreePath: e.Path, inQueueTime: time.Now(), action: "delete"}, nil
	case "delete_id":
		return &dbQueueOperation{removeTreeBox: e.Box, removeTreeID: e.ID, inQueueTime: time.Now(), action: "delete_id"}, nil
	case "delete_ids":
		return &dbQueueOperation{removeTreeIDs: e.IDs, inQueueTime: time.Now(), action: "delete_ids"}, nil
	case "delete_box":
		return &dbQueueOperation{box: e.Box, inQueueTime: time.Now(), action: "delete_box"}, nil
	case "delete_box_refs":
		return &dbQueueOperation{box: e.Box, inQueueTime: time.Now(), action: "delete_box_refs"}, nil
	case "delete_assets":
		return &dbQueueOperation{removeAssetHashes: e.Hashes, inQueueTime: time.Now(), action: "delete_assets"}, nil
	case "refresh_def_refs":
		return &dbQueueOperation{box: e.Box, refreshDefIDs: e.IDs, inQueueTime: time.Now(), action: e.Action}, nil
	case "index_node":
		return &dbQueueOperation{id: e.ID, box: e.Box, inQueueTime: time.Now(), action: "index_node"}, nil
	case "update_block_content":
		bt := treenode.GetBlockTreeInBox(e.ID, e.Box)
		if bt == nil || bt.BoxID != e.Box {
			return nil, os.ErrNotExist
		}
		tree, err := filesys.LoadTree(e.Box, bt.Path, luteEngine)
		if err != nil {
			logIndexEntryLoadError(prefix, e.Action, e, err)
			return nil, err
		}
		node := treenode.GetNodeInTree(tree, e.ID)
		if node == nil || node.Type != ast.NodeBlockQueryEmbed {
			return nil, os.ErrNotExist
		}
		block, _ := buildBlockFromNode(node, tree)
		// 只持久化块定位信息；恢复时重新计算派生内容，不能把查询脚本当作搜索内容。
		block.Content, _ = CalculateEmbedBlockContent(block)
		return &dbQueueOperation{block: block, inQueueTime: time.Now(), action: e.Action}, nil
	}
	return nil, fmt.Errorf("unknown index queue action [%s]", e.Action)
}

func logIndexEntryLoadError(prefix, action string, entry indexEntry, err error) {
	if !os.IsNotExist(err) {
		logging.LogWarnf("%s %s: load tree [%s/%s] failed: %s", prefix, action, entry.Box, entry.Path, err)
	}
}
