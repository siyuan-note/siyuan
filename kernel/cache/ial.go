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

package cache

import (
	"maps"
	"sync"

	"github.com/dgraph-io/ristretto"
)

var docIALCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 100000,
	MaxCost:     1024 * 1024 * 200,
	BufferItems: 64,
})
var docIALCacheKeys = map[string]map[string]struct{}{}
var docIALCacheKeysMu sync.Mutex

func docIALCacheKey(p, boxID string) string {
	return boxID + "\x00" + p
}

func PutDocIALInBox(p, boxID string, ial map[string]string) {
	key := docIALCacheKey(p, boxID)
	docIALCache.Set(key, ial, 128)

	docIALCacheKeysMu.Lock()
	defer docIALCacheKeysMu.Unlock()
	keys := docIALCacheKeys[p]
	if keys == nil {
		keys = map[string]struct{}{}
		docIALCacheKeys[p] = keys
	}
	keys[key] = struct{}{}
}

func GetDocIALInBox(p, boxID string) (ret map[string]string) {
	ial, _ := docIALCache.Get(docIALCacheKey(p, boxID))
	if nil == ial {
		return
	}
	ret = map[string]string{}
	maps.Copy(ret, ial.(map[string]string))
	return
}

func RemoveDocIAL(p string) {
	docIALCacheKeysMu.Lock()
	keys := docIALCacheKeys[p]
	delete(docIALCacheKeys, p)
	docIALCacheKeysMu.Unlock()

	docIALCache.Del(p)
	docIALCache.Del(docIALCacheKey(p, ""))
	for key := range keys {
		docIALCache.Del(key)
	}
}

func RemoveDocIALInBox(p, boxID string) {
	key := docIALCacheKey(p, boxID)
	docIALCache.Del(key)

	docIALCacheKeysMu.Lock()
	defer docIALCacheKeysMu.Unlock()
	if keys := docIALCacheKeys[p]; keys != nil {
		delete(keys, key)
		if len(keys) == 0 {
			delete(docIALCacheKeys, p)
		}
	}
}

func ClearDocsIAL() {
	docIALCacheKeysMu.Lock()
	docIALCacheKeys = map[string]map[string]struct{}{}
	docIALCacheKeysMu.Unlock()
	docIALCache.Clear()
}

var blockIALCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 100000,
	MaxCost:     1024 * 1024 * 200,
	BufferItems: 64,
})
var blockIALCacheKeys = map[string]map[string]struct{}{}
var blockIALCacheKeysMu sync.Mutex

func blockIALCacheKey(id, boxID string) string {
	return boxID + "\x00" + id
}

func PutBlockIAL(id string, ial map[string]string) {
	PutBlockIALInBox(id, "", ial)
}

func PutBlockIALInBox(id, boxID string, ial map[string]string) {
	key := blockIALCacheKey(id, boxID)
	blockIALCache.Set(key, ial, 128)

	blockIALCacheKeysMu.Lock()
	defer blockIALCacheKeysMu.Unlock()
	keys := blockIALCacheKeys[id]
	if keys == nil {
		keys = map[string]struct{}{}
		blockIALCacheKeys[id] = keys
	}
	keys[key] = struct{}{}
}

func GetBlockIAL(id string) (ret map[string]string) {
	return GetBlockIALInBox(id, "")
}

func GetBlockIALInBox(id, boxID string) (ret map[string]string) {
	ial, _ := blockIALCache.Get(blockIALCacheKey(id, boxID))
	if nil == ial {
		return
	}
	return ial.(map[string]string)
}

// GetBlockIALWithBoxFallback 先查 box-aware key，未命中再回退到 bare key。
//
// 写入端存在两套键命名空间：部分路径写 box-aware key（PutBlockIALInBox，用于加密笔记本隔离），
// 部分历史路径仍写 bare key（PutBlockIAL）。读取端若只查其一会漏掉另一侧的更新，因此这里按
// box-aware 优先、bare key 回退的顺序查询，与 treenode.GetDynamicRefText 的回退策略保持一致。
func GetBlockIALWithBoxFallback(id, boxID string) (ret map[string]string) {
	if "" != boxID {
		if ret = GetBlockIALInBox(id, boxID); nil != ret {
			return
		}
	}
	return GetBlockIAL(id)
}

func RemoveBlockIAL(id string) {
	blockIALCacheKeysMu.Lock()
	keys := blockIALCacheKeys[id]
	delete(blockIALCacheKeys, id)
	blockIALCacheKeysMu.Unlock()

	blockIALCache.Del(id)
	blockIALCache.Del(blockIALCacheKey(id, ""))
	for key := range keys {
		blockIALCache.Del(key)
	}
}

func RemoveBlockIALInBox(id, boxID string) {
	key := blockIALCacheKey(id, boxID)
	blockIALCache.Del(key)

	blockIALCacheKeysMu.Lock()
	defer blockIALCacheKeysMu.Unlock()
	if keys := blockIALCacheKeys[id]; keys != nil {
		delete(keys, key)
		if len(keys) == 0 {
			delete(blockIALCacheKeys, id)
		}
	}
}

func ClearBlocksIAL() {
	blockIALCacheKeysMu.Lock()
	blockIALCacheKeys = map[string]map[string]struct{}{}
	blockIALCacheKeysMu.Unlock()
	blockIALCache.Clear()
}
