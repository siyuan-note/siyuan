// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type dynamicRefTextRetryKey struct {
	boxID   string
	blockID string
}

var dynamicRefTextRetries = struct {
	sync.Mutex
	pending    map[dynamicRefTextRetryKey]time.Time
	loadedPath string
}{pending: map[dynamicRefTextRetryKey]time.Time{}}

type dynamicRefTextRetryJournal struct {
	Spec    int                        `json:"spec"`
	Pending []dynamicRefTextRetryEntry `json:"pending"`
}

type dynamicRefTextRetryEntry struct {
	BoxID   string `json:"box"`
	BlockID string `json:"id"`
}

// Caller holds dynamicRefTextRetries. Unknown/corrupt journals are never
// replaced with an empty queue, and no document content is stored here.
func loadDynamicRefTextRetriesLocked() error {
	filename := filepath.Join(util.QueueDir, "ref-text-retry.json")
	if dynamicRefTextRetries.loadedPath == filename {
		return nil
	}
	data, err := os.ReadFile(filename)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	var journal dynamicRefTextRetryJournal
	if err == nil {
		if err = json.Unmarshal(data, &journal); err != nil {
			return err
		}
		if journal.Spec != 1 {
			return fmt.Errorf("unknown dynamic reference retry journal format: %d", journal.Spec)
		}
		for _, entry := range journal.Pending {
			if !ast.IsNodeIDPattern(entry.BoxID) || !ast.IsNodeIDPattern(entry.BlockID) {
				return errors.New("invalid dynamic reference retry identifier")
			}
		}
	}
	for _, entry := range journal.Pending {
		key := dynamicRefTextRetryKey{entry.BoxID, entry.BlockID}
		if _, exists := dynamicRefTextRetries.pending[key]; !exists {
			dynamicRefTextRetries.pending[key] = time.Time{}
		}
	}
	dynamicRefTextRetries.loadedPath = filename
	return nil
}

func saveDynamicRefTextRetriesLocked() error {
	if err := loadDynamicRefTextRetriesLocked(); err != nil {
		return err
	}
	journal := dynamicRefTextRetryJournal{Spec: 1, Pending: []dynamicRefTextRetryEntry{}}
	for key := range dynamicRefTextRetries.pending {
		if !ast.IsNodeIDPattern(key.boxID) || !ast.IsNodeIDPattern(key.blockID) {
			return errors.New("invalid dynamic reference retry identifier")
		}
		journal.Pending = append(journal.Pending, dynamicRefTextRetryEntry{key.boxID, key.blockID})
	}
	sort.Slice(journal.Pending, func(i, j int) bool {
		a, b := journal.Pending[i], journal.Pending[j]
		return a.BoxID < b.BoxID || a.BoxID == b.BoxID && a.BlockID < b.BlockID
	})
	data, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(util.QueueDir, 0755); err != nil {
		return err
	}
	return gulu.File.WriteFileSafer(dynamicRefTextRetries.loadedPath, data, 0644)
}

// 重试只记录定义块标识，不保留过期树或加密笔记本的明文内容。
func queueDynamicRefTextRetries(defs map[string]*ast.Node, trees map[string]*parse.Tree, err error) {
	logging.LogErrorf("refresh dynamic reference text failed, retry pending: %s", err)
	dynamicRefTextRetries.Lock()
	loadErr := loadDynamicRefTextRetriesLocked()
	notify := len(dynamicRefTextRetries.pending) == 0
	for id, node := range defs {
		key := dynamicRefTextRetryKey{updatedNodeBoxID(node, trees), id}
		if _, exists := dynamicRefTextRetries.pending[key]; !exists {
			dynamicRefTextRetries.pending[key] = time.Now().Add(3 * time.Second)
		}
	}
	if loadErr == nil {
		loadErr = saveDynamicRefTextRetriesLocked()
	}
	dynamicRefTextRetries.Unlock()
	if loadErr != nil {
		logging.LogErrorf("persist dynamic reference retry failed: %s", loadErr)
	}
	if notify {
		util.PushErrMsg(util.I18nTerm(Conf.Lang, "dynamicRefTextRefreshRetry"), 7000)
	}
}

func flushDynamicRefTextRetries() {
	if util.IsExiting.Load() || util.ReadOnly {
		return
	}
	dynamicRefTextRetries.Lock()
	if err := loadDynamicRefTextRetriesLocked(); err != nil {
		dynamicRefTextRetries.Unlock()
		logging.LogErrorf("load dynamic reference retry journal failed: %s", err)
		return
	}
	var keys []dynamicRefTextRetryKey
	for key, next := range dynamicRefTextRetries.pending {
		if !time.Now().Before(next) {
			keys = append(keys, key)
			dynamicRefTextRetries.pending[key] = time.Now().Add(30 * time.Second)
			if len(keys) == 32 {
				break
			}
		}
	}
	dynamicRefTextRetries.Unlock()
	if len(keys) == 0 {
		return
	}
	// 与编辑事务串行，重读最新定义和引用文档，防止重试覆盖后续编辑。
	flushLock.Lock()
	isFlushing.Store(true)
	defer func() {
		isFlushing.Store(false)
		flushLock.Unlock()
	}()
	sql.FlushQueue()
	for _, key := range keys {
		if util.IsExiting.Load() {
			return
		}
		if retryDynamicRefText(key) {
			dynamicRefTextRetries.Lock()
			delete(dynamicRefTextRetries.pending, key)
			if err := saveDynamicRefTextRetriesLocked(); err != nil {
				// Replaying a completed definition is safe. Retain it in memory
				// too so a failed checkpoint is retried without requiring restart.
				dynamicRefTextRetries.pending[key] = time.Now().Add(30 * time.Second)
				logging.LogErrorf("checkpoint dynamic reference retry failed: %s", err)
			}
			dynamicRefTextRetries.Unlock()
		}
	}
}

func retryDynamicRefText(key dynamicRefTextRetryKey) bool {
	if err := AcquireEncryptedBoxOperation(key.boxID); err != nil {
		return false
	}
	defer ReleaseEncryptedBoxOperation(key.boxID)
	tree, err := loadTreeByBlockIDInBox(key.blockID, key.boxID)
	if err != nil {
		return errors.Is(err, ErrTreeNotFound)
	}
	node := treenode.GetNodeInTree(tree, key.blockID)
	if node == nil {
		return true
	}
	_, failed := refreshDynamicRefTextsWithWriter(map[string]*ast.Node{node.ID: node},
		map[string]*parse.Tree{tree.ID: tree}, writeTreeUpsertQueue)
	if !failed {
		IncSync()
	}
	return !failed
}
