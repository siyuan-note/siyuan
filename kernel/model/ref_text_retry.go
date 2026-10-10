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

package model

import (
	"errors"
	"sync"
	"time"

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
	pending map[dynamicRefTextRetryKey]time.Time
}{pending: map[dynamicRefTextRetryKey]time.Time{}}

// 重试只记录定义块标识，不保留过期树或加密笔记本的明文内容。
func queueDynamicRefTextRetries(defs map[string]*ast.Node, trees map[string]*parse.Tree, err error) {
	logging.LogErrorf("refresh dynamic reference text failed, retry pending: %s", err)
	dynamicRefTextRetries.Lock()
	notify := len(dynamicRefTextRetries.pending) == 0
	for id, node := range defs {
		key := dynamicRefTextRetryKey{updatedNodeBoxID(node, trees), id}
		if _, exists := dynamicRefTextRetries.pending[key]; !exists {
			dynamicRefTextRetries.pending[key] = time.Now().Add(3 * time.Second)
		}
	}
	dynamicRefTextRetries.Unlock()
	if notify {
		util.PushErrMsg(util.I18nTerm(Conf.Lang, "dynamicRefTextRefreshRetry"), 7000)
	}
}

func flushDynamicRefTextRetries() {
	if util.IsExiting.Load() || util.ReadOnly {
		return
	}
	dynamicRefTextRetries.Lock()
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
