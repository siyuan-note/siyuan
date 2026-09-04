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
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/dgraph-io/ristretto"
	"github.com/jinzhu/copier"
	gcache "github.com/patrickmn/go-cache"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/search"
)

var cacheDisabled = true

func enableCache() {
	cacheDisabled = false
}

func disableCache() {
	cacheDisabled = true
}

var blockCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 100000,
	MaxCost:     10240,
	BufferItems: 64,
	OnExit: func(value any) {
		if entry, ok := value.(*blockCacheEntry); ok {
			removeBlockCacheKey(entry.block.ID, entry.key)
		}
	},
})

var blockCacheKeys = map[string]map[string]struct{}{}
var blockCacheKeysMu sync.Mutex

type blockCacheEntry struct {
	key   string
	block *Block
}

func encryptedBoxCacheUnavailable(boxID string) bool {
	return IsEncryptedBoxFn != nil && IsEncryptedBoxFn(boxID) &&
		(IsBoxUnlockedFn == nil || !IsBoxUnlockedFn(boxID))
}

// blockCacheKey 为加密笔记本使用 box 维度缓存键；普通笔记本保持原有全局键，避免影响既有查询路径。
func blockCacheKey(id, boxID string) string {
	if IsEncryptedBoxFn != nil && IsEncryptedBoxFn(boxID) {
		return boxID + "\x00" + id
	}
	return id
}

func ClearCache() {
	blockCache.Clear()
	blockCacheKeysMu.Lock()
	blockCacheKeys = map[string]map[string]struct{}{}
	blockCacheKeysMu.Unlock()
	clearRefCache()
}

func putBlockCache(block *Block) {
	if cacheDisabled || encryptedBoxCacheUnavailable(block.Box) {
		return
	}

	cloned := &Block{}
	if err := copier.Copy(cloned, block); err != nil {
		logging.LogErrorf("clone block failed: %v", err)
		return
	}
	cloned.Content = strings.ReplaceAll(cloned.Content, search.SearchMarkLeft, "")
	cloned.Content = strings.ReplaceAll(cloned.Content, search.SearchMarkRight, "")
	key := blockCacheKey(cloned.ID, cloned.Box)
	addBlockCacheKey(cloned.ID, key)
	if !blockCache.Set(key, &blockCacheEntry{key: key, block: cloned}, 1) {
		removeBlockCacheKey(cloned.ID, key)
	}
}

func getBlockCache(id string) (ret *Block) {
	return getBlockCacheInBox(id, "")
}

func getBlockCacheInBox(id, boxID string) (ret *Block) {
	if cacheDisabled || encryptedBoxCacheUnavailable(boxID) {
		return
	}

	b, _ := blockCache.Get(blockCacheKey(id, boxID))
	if nil != b {
		if entry, ok := b.(*blockCacheEntry); ok {
			ret = entry.block
		}
	}
	return
}

func removeBlockCache(id string) {
	blockCacheKeysMu.Lock()
	keys := blockCacheKeys[id]
	delete(blockCacheKeys, id)
	blockCacheKeysMu.Unlock()
	for key := range keys {
		blockCache.Del(key)
	}
	removeRefCacheByDefID(id)
}

func addBlockCacheKey(id, key string) {
	blockCacheKeysMu.Lock()
	defer blockCacheKeysMu.Unlock()
	keys := blockCacheKeys[id]
	if keys == nil {
		keys = map[string]struct{}{}
		blockCacheKeys[id] = keys
	}
	keys[key] = struct{}{}
}

func removeBlockCacheKey(id, key string) {
	blockCacheKeysMu.Lock()
	defer blockCacheKeysMu.Unlock()
	if keys := blockCacheKeys[id]; keys != nil {
		delete(keys, key)
		if len(keys) == 0 {
			delete(blockCacheKeys, id)
		}
	}
}

var (
	defIDRefsCache           = gcache.New(30*time.Minute, 5*time.Minute)
	refCacheMu               sync.RWMutex
	refCacheGlobalGeneration uint64
	refCacheGenerations      = map[string]uint64{}
)

type refCacheGeneration struct {
	global uint64
	scope  uint64
}

type refCacheEntry struct {
	refs     map[string]*Ref
	complete bool
}

// refCacheScopeBoxID 按加密边界规范化引用缓存范围：普通笔记本共享全局范围，加密笔记本保持独立范围。
func refCacheScopeBoxID(boxID string) string {
	if IsEncryptedBoxFn != nil && IsEncryptedBoxFn(boxID) {
		return boxID
	}
	return ""
}

func refCacheKey(defBlockID, boxID string) string {
	return refCacheScopeBoxID(boxID) + "\x00" + defBlockID
}

func GetRefsCacheByDefID(defID string) (ret []*Ref) {
	return GetRefsCacheByDefIDInBox(defID, "")
}

func GetRefsCacheByDefIDInBox(defID, boxID string) (ret []*Ref) {
	return getRefsCacheByDefIDInBox(defID, boxID, QueryRefsByDefIDInBox)
}

func getRefsCacheByDefIDInBox(defID, boxID string,
	query func(defBlockID string, containChildren bool, boxID string) []*Ref) (ret []*Ref) {
	if encryptedBoxCacheUnavailable(boxID) {
		return
	}
	boxID = refCacheScopeBoxID(boxID)
	key := refCacheKey(defID, boxID)
	refCacheMu.RLock()
	generation := currentRefCacheGeneration(boxID)
	partial := map[string]*Ref{}
	if cached, ok := defIDRefsCache.Get(key); ok {
		if entry, valid := cached.(*refCacheEntry); valid {
			for blockID, ref := range entry.refs {
				ret = append(ret, ref)
				partial[blockID] = ref
			}
			if entry.complete {
				refCacheMu.RUnlock()
				return
			}
		}
	}
	refCacheMu.RUnlock()
	allRefs := query(defID, false, boxID)
	merged := map[string]*Ref{}
	var cacheable []*Ref
	for _, ref := range allRefs {
		// 按 box 过滤：boxID 非空时只选同 box 的 Ref，boxID 为空时全部保留
		if boxID == "" || ref.Box == boxID {
			merged[ref.BlockID] = ref
			cacheable = append(cacheable, ref)
		}
	}
	for blockID, ref := range partial {
		merged[blockID] = ref
	}
	ret = ret[:0]
	for _, ref := range merged {
		ret = append(ret, ref)
	}
	putRefCacheIfGeneration(defID, boxID, generation, cacheable)
	return
}

func CacheRef(tree *parse.Tree, refNode *ast.Node) {
	ref := buildRef(tree, refNode)
	putRefCache(tree.Box, ref)
}

func putRefCache(boxID string, ref *Ref) {
	if encryptedBoxCacheUnavailable(boxID) {
		return
	}
	refCacheMu.Lock()
	defer refCacheMu.Unlock()
	boxID = refCacheScopeBoxID(boxID)
	refCacheGenerations[boxID]++
	putRefCacheLocked(boxID, ref)
}

func putRefCacheIfGeneration(defID, boxID string, generation refCacheGeneration, refs []*Ref) {
	if encryptedBoxCacheUnavailable(boxID) {
		return
	}
	boxID = refCacheScopeBoxID(boxID)
	refCacheMu.Lock()
	defer refCacheMu.Unlock()
	if generation != currentRefCacheGeneration(boxID) {
		return
	}
	complete := make(map[string]*Ref, len(refs))
	for _, ref := range refs {
		if nil != ref {
			complete[ref.BlockID] = ref
		}
	}
	key := refCacheKey(defID, boxID)
	if cached, ok := defIDRefsCache.Get(key); ok {
		if entry, valid := cached.(*refCacheEntry); valid {
			for blockID, ref := range entry.refs {
				complete[blockID] = ref
			}
		}
	}
	defIDRefsCache.SetDefault(key, &refCacheEntry{refs: complete, complete: true})
}

func putRefCacheLocked(boxID string, ref *Ref) {
	if nil == ref {
		return
	}
	key := refCacheKey(ref.DefBlockID, boxID)
	entry := &refCacheEntry{refs: map[string]*Ref{}}
	if cached, ok := defIDRefsCache.Get(key); ok {
		if existing, valid := cached.(*refCacheEntry); valid {
			entry = existing
		}
	}
	entry.refs[ref.BlockID] = ref
	entry.complete = false
	defIDRefsCache.SetDefault(key, entry)
}

func removeRefCacheByDefID(defID string) {
	refCacheMu.Lock()
	defer refCacheMu.Unlock()
	refCacheGlobalGeneration++
	suffix := "\x00" + defID
	for key := range defIDRefsCache.Items() {
		if strings.HasSuffix(key, suffix) {
			defIDRefsCache.Delete(key)
		}
	}
}

func removeRefCacheByPath(boxID, path string) {
	refCacheMu.Lock()
	defer refCacheMu.Unlock()
	refCacheGenerations[refCacheScopeBoxID(boxID)]++
	for key, item := range defIDRefsCache.Items() {
		entry, ok := item.Object.(*refCacheEntry)
		if !ok {
			continue
		}
		for _, ref := range entry.refs {
			if nil != ref && ref.Box == boxID && ref.Path == path {
				defIDRefsCache.Delete(key)
				break
			}
		}
	}
}

func clearRefCache() {
	refCacheMu.Lock()
	defer refCacheMu.Unlock()
	refCacheGlobalGeneration++
	refCacheGenerations = map[string]uint64{}
	defIDRefsCache.Flush()
}

func getRefCacheGeneration(boxID string) refCacheGeneration {
	refCacheMu.RLock()
	defer refCacheMu.RUnlock()
	return currentRefCacheGeneration(refCacheScopeBoxID(boxID))
}

// currentRefCacheGeneration 返回当前引用缓存代数，调用方必须持有 refCacheMu。
func currentRefCacheGeneration(boxID string) refCacheGeneration {
	return refCacheGeneration{global: refCacheGlobalGeneration, scope: refCacheGenerations[boxID]}
}
