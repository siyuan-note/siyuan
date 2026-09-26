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

package cache

import (
	"sync"

	"github.com/dgraph-io/ristretto"
)

type treeCacheEntry struct {
	raw        []byte
	generation uint64
}

var (
	treeCache, _ = ristretto.NewCache(&ristretto.Config{
		NumCounters: 100000,
		MaxCost:     1024 * 1024 * 200,
		BufferItems: 64,
	})
	treeCacheKeys       = map[string]map[string]uint64{}
	treeCacheKeysMu     sync.Mutex
	treeCacheGeneration uint64
)

func treeCacheKey(rootID, boxID string) string {
	return boxID + "\x00" + rootID
}

func GetTreeData(rootID string) (raw []byte, ok bool) {
	return GetTreeDataInBox(rootID, "")
}

func GetTreeDataInBox(rootID, boxID string) (raw []byte, ok bool) {
	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	key := treeCacheKey(rootID, boxID)
	v, _ := treeCache.Get(key)
	if nil == v {
		return nil, false
	}
	e := v.(*treeCacheEntry)
	// 异步准入可能保留较早的写入，只接受当前版本，否则交由调用方读取源文件。
	if e.generation != treeCacheKeys[rootID][key] {
		return nil, false
	}
	return e.raw, true
}

func SetTreeData(rootID string, raw []byte) {
	SetTreeDataInBox(rootID, "", raw)
}

func SetTreeDataInBox(rootID, boxID string, raw []byte) {
	if raw == nil {
		return
	}
	key := treeCacheKey(rootID, boxID)
	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	treeCacheGeneration++
	entry := &treeCacheEntry{raw: raw, generation: treeCacheGeneration}
	keys := treeCacheKeys[rootID]
	if keys == nil {
		keys = map[string]uint64{}
		treeCacheKeys[rootID] = keys
	}
	keys[key] = entry.generation
	treeCache.Set(key, entry, int64(len(raw)))
}

func RemoveTreeData(rootID string) {
	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	keys := treeCacheKeys[rootID]
	delete(treeCacheKeys, rootID)

	treeCache.Del(rootID)
	treeCache.Del(treeCacheKey(rootID, ""))
	for key := range keys {
		treeCache.Del(key)
	}
}

func RemoveTreeDataInBox(rootID, boxID string) {
	key := treeCacheKey(rootID, boxID)
	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	treeCache.Del(key)
	if keys := treeCacheKeys[rootID]; keys != nil {
		delete(keys, key)
		if len(keys) == 0 {
			delete(treeCacheKeys, rootID)
		}
	}
}

func ClearTreeCache() {
	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	treeCacheKeys = map[string]map[string]uint64{}
	treeCache.Clear()
}
