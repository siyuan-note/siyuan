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
	if cacheDisabled {
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
	if cacheDisabled {
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

var defIDRefsCache = gcache.New(30*time.Minute, 5*time.Minute)

func refCacheKey(defBlockID, boxID string) string {
	return boxID + "\x00" + defBlockID
}

func GetRefsCacheByDefID(defID string) (ret []*Ref) {
	return GetRefsCacheByDefIDInBox(defID, "")
}

func GetRefsCacheByDefIDInBox(defID, boxID string) (ret []*Ref) {
	key := refCacheKey(defID, boxID)
	for k, refs := range defIDRefsCache.Items() {
		if k == key {
			for _, ref := range refs.Object.(map[string]*Ref) {
				ret = append(ret, ref)
			}
		}
	}
	if 1 > len(ret) {
		allRefs := QueryRefsByDefID(defID, false)
		for _, ref := range allRefs {
			// 按 box 过滤：boxID 非空时只选同 box 的 Ref，boxID 为空时全部保留
			if boxID == "" || ref.Box == boxID {
				ret = append(ret, ref)
				putRefCache(boxID, ref)
			}
		}
	}
	return
}

func CacheRef(tree *parse.Tree, refNode *ast.Node) {
	ref := buildRef(tree, refNode)
	putRefCache(tree.Box, ref)
}

func putRefCache(boxID string, ref *Ref) {
	key := refCacheKey(ref.DefBlockID, boxID)
	defBlockRefs, ok := defIDRefsCache.Get(key)
	if !ok {
		defBlockRefs = map[string]*Ref{}
	}
	defBlockRefs.(map[string]*Ref)[ref.BlockID] = ref
	defIDRefsCache.SetDefault(key, defBlockRefs)
}

func removeRefCacheByDefID(defID string) {
	defIDRefsCache.Delete(refCacheKey(defID, ""))
}

func clearRefCache() {
	defIDRefsCache.Flush()
}
