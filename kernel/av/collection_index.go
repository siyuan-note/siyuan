// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"encoding/json"
	"fmt"
	"iter"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type collectionBoxIndex struct {
	loaded   bool
	views    map[string][]*AutomationBlockSource
	snapshot *BlockCollectionIndex
}

// 索引只保留收集范围，不保留属性条件、赋值或正文；加密笔记本锁定时清理其范围。
var collectionIndex = struct {
	sync.RWMutex
	directory  string
	generation uint64
	boxes      map[string]*collectionBoxIndex
}{boxes: map[string]*collectionBoxIndex{}}

// BlockCollectionIndex 是按加密边界共享的不可变范围快照，事务可复用到缓存失效或范围改变。
type BlockCollectionIndex struct {
	boxID  string
	ids    []string
	scopes map[string][]*AutomationBlockSource
}

func collectionIndexCurrentLocked() bool {
	return collectionIndex.directory == util.DataDir && collectionIndex.generation == cache.GetAVCacheGeneration()
}

func resetCollectionIndexLocked() {
	if !collectionIndexCurrentLocked() {
		collectionIndex.directory, collectionIndex.generation = util.DataDir, cache.GetAVCacheGeneration()
		collectionIndex.boxes = map[string]*collectionBoxIndex{}
	}
}

// ClearBlockCollectionIndex 在持有笔记本写锁时移除已解密的范围，避免锁定后保留文档 ID。
func ClearBlockCollectionIndex(boxID string) {
	collectionIndex.Lock()
	defer collectionIndex.Unlock()
	delete(collectionIndex.boxes, boxID)
}

// BlockCollectionIndexKnownEmpty 只确认当前代次已经扫描过的空索引，未知状态仍需首次扫描。
func BlockCollectionIndexKnownEmpty(boxID string) bool {
	collectionIndex.RLock()
	defer collectionIndex.RUnlock()
	box := collectionIndex.boxes[boxID]
	return collectionIndexCurrentLocked() && box != nil && box.loaded && len(box.snapshot.ids) == 0
}

func (index *BlockCollectionIndex) Current() bool {
	collectionIndex.RLock()
	defer collectionIndex.RUnlock()
	box := collectionIndex.boxes[index.boxID]
	return collectionIndexCurrentLocked() && box != nil && box.snapshot == index
}

func (index *BlockCollectionIndex) Empty() bool { return len(index.ids) == 0 }

func (index *BlockCollectionIndex) MatchesView(id, notebookID, documentID, documentPath string) bool {
	for _, scope := range index.scopes[id] {
		if scope == nil || scope.MatchesDocument(notebookID, documentID, documentPath) {
			return true
		}
	}
	return false
}

func (index *BlockCollectionIndex) MatchesDocument(notebookID, documentID, documentPath string) bool {
	for _, id := range index.ids {
		if index.MatchesView(id, notebookID, documentID, documentPath) {
			return true
		}
	}
	return false
}

// ViewIDsForDocument 只遍历范围匹配的数据库，不为每个文档复制、排序 ID。
func (index *BlockCollectionIndex) ViewIDsForDocument(notebookID, documentID, documentPath string) iter.Seq[string] {
	return func(yield func(string) bool) {
		for _, id := range index.ids {
			if index.MatchesView(id, notebookID, documentID, documentPath) && !yield(id) {
				return
			}
		}
	}
}

func collectionScopes(config *AutomationConfig) (ret []*AutomationBlockSource) {
	if config == nil {
		return
	}
	unknownSpec := config.ValidateSpec() != nil
	for _, rule := range config.Rules {
		if rule == nil || !rule.Enabled || rule.Trigger != "block" {
			continue
		}
		// 未知语义不能按已知范围排除，交给完整读取器报告兼容性错误。
		if unknownSpec || rule.BlockSource == nil {
			return []*AutomationBlockSource{nil}
		}
		source := rule.BlockSource
		scope := &AutomationBlockSource{NotebookIDs: slices.Clone(source.NotebookIDs), DocumentIDs: slices.Clone(source.DocumentIDs)}
		if source.DocumentDepth != nil {
			depth := *source.DocumentDepth
			scope.DocumentDepth = &depth
		}
		if source.IncludeSelectedDocuments != nil {
			include := *source.IncludeSelectedDocuments
			scope.IncludeSelectedDocuments = &include
		}
		ret = append(ret, scope)
	}
	return
}

func equalCollectionScopes(left, right []*AutomationBlockSource) bool {
	return slices.EqualFunc(left, right, func(a, b *AutomationBlockSource) bool {
		if a == nil || b == nil {
			return a == b
		}
		return slices.Equal(a.NotebookIDs, b.NotebookIDs) && slices.Equal(a.DocumentIDs, b.DocumentIDs) &&
			(a.IncludeSelectedDocuments == nil || *a.IncludeSelectedDocuments) == (b.IncludeSelectedDocuments == nil || *b.IncludeSelectedDocuments) &&
			(a.DocumentDepth == nil && b.DocumentDepth == nil || a.DocumentDepth != nil && b.DocumentDepth != nil && *a.DocumentDepth == *b.DocumentDepth)
	})
}

func collectionSnapshot(boxID string, views map[string][]*AutomationBlockSource) *BlockCollectionIndex {
	ret := &BlockCollectionIndex{boxID: boxID, scopes: map[string][]*AutomationBlockSource{}}
	for id, scopes := range views {
		if len(scopes) > 0 {
			ret.ids = append(ret.ids, id)
			ret.scopes[id] = scopes
		}
	}
	sort.Strings(ret.ids)
	return ret
}

func rememberCollectionView(view *AttributeView, boxID string) {
	scopes := collectionScopes(view.Automations)
	collectionIndex.Lock()
	defer collectionIndex.Unlock()
	resetCollectionIndexLocked()
	box := collectionIndex.boxes[boxID]
	if box == nil {
		box = &collectionBoxIndex{views: map[string][]*AutomationBlockSource{}}
		collectionIndex.boxes[boxID] = box
	}
	previous := box.views[view.ID]
	box.views[view.ID] = scopes
	if box.loaded && !equalCollectionScopes(previous, scopes) {
		box.snapshot = collectionSnapshot(boxID, box.views)
	}
}

// BlockCollectionIndexInBox 首次完整读取并认证数据库，此后保存数据库直接更新范围快照。
func BlockCollectionIndexInBox(boxID string) (*BlockCollectionIndex, error) {
	for {
		release, err := holdAVBoxReadLock(boxID)
		if err != nil {
			return nil, err
		}
		collectionIndex.Lock()
		resetCollectionIndexLocked()
		box := collectionIndex.boxes[boxID]
		if box == nil {
			box = &collectionBoxIndex{views: map[string][]*AutomationBlockSource{}}
			collectionIndex.boxes[boxID] = box
		}
		generation, directory := collectionIndex.generation, collectionIndex.directory
		snapshot := box.snapshot
		collectionIndex.Unlock()
		release()
		if snapshot != nil {
			return snapshot, nil
		}

		entries, readErr := os.ReadDir(filepath.Join(directory, boxID, "storage", "av"))
		if readErr != nil && !os.IsNotExist(readErr) {
			return nil, readErr
		}
		views := map[string][]*AutomationBlockSource{}
		for _, entry := range entries {
			id := strings.TrimSuffix(entry.Name(), ".json")
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || !ast.IsNodeIDPattern(id) {
				continue
			}
			data, readErr := ReadAttributeViewDataInBox(id, boxID)
			if readErr != nil {
				return nil, fmt.Errorf("read attribute view [%s] in box [%s] failed: %w", id, boxID, readErr)
			}
			var header struct {
				Spec        int               `json:"spec"`
				Automations *AutomationConfig `json:"automations"`
			}
			if readErr = json.Unmarshal(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")), &header); readErr != nil {
				return nil, fmt.Errorf("parse attribute view [%s] in box [%s] failed: %w", id, boxID, readErr)
			}
			views[id] = collectionScopes(header.Automations)
			if header.Spec > CurrentSpec && len(views[id]) > 0 {
				views[id] = []*AutomationBlockSource{nil}
			}
		}
		// 读取期间不递归持有笔记本读锁；发布时再次检查锁定状态和缓存代次。
		release, err = holdAVBoxReadLock(boxID)
		if err != nil {
			return nil, err
		}
		collectionIndex.Lock()
		resetCollectionIndexLocked()
		if generation != collectionIndex.generation || directory != collectionIndex.directory || collectionIndex.boxes[boxID] != box {
			collectionIndex.Unlock()
			release()
			continue
		}
		maps.Copy(views, box.views)
		box.views, box.loaded = views, true
		if box.snapshot == nil {
			box.snapshot = collectionSnapshot(boxID, views)
		}
		snapshot = box.snapshot
		collectionIndex.Unlock()
		release()
		return snapshot, nil
	}
}
