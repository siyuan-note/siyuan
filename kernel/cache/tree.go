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
	"sync"

	"github.com/dgraph-io/ristretto"
)

type treeCacheEntry struct {
	raw []byte
}

var (
	treeCache, _ = ristretto.NewCache(&ristretto.Config{
		NumCounters: 100000,
		MaxCost:     1024 * 1024 * 200,
		BufferItems: 64,
	})
	treeCacheKeys   = map[string]map[string]struct{}{}
	treeCacheKeysMu sync.Mutex
)

func treeCacheKey(rootID, boxID string) string {
	return boxID + "\x00" + rootID
}

func GetTreeData(rootID string) (raw []byte, ok bool) {
	return GetTreeDataInBox(rootID, "")
}

func GetTreeDataInBox(rootID, boxID string) (raw []byte, ok bool) {
	v, _ := treeCache.Get(treeCacheKey(rootID, boxID))
	if nil == v {
		return nil, false
	}
	e := v.(*treeCacheEntry)
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
	entry := &treeCacheEntry{raw: raw}
	treeCache.Set(key, entry, int64(len(raw)))

	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	keys := treeCacheKeys[rootID]
	if keys == nil {
		keys = map[string]struct{}{}
		treeCacheKeys[rootID] = keys
	}
	keys[key] = struct{}{}
}

func RemoveTreeData(rootID string) {
	treeCacheKeysMu.Lock()
	keys := treeCacheKeys[rootID]
	delete(treeCacheKeys, rootID)
	treeCacheKeysMu.Unlock()

	treeCache.Del(rootID)
	treeCache.Del(treeCacheKey(rootID, ""))
	for key := range keys {
		treeCache.Del(key)
	}
}

func RemoveTreeDataInBox(rootID, boxID string) {
	key := treeCacheKey(rootID, boxID)
	treeCache.Del(key)

	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	if keys := treeCacheKeys[rootID]; keys != nil {
		delete(keys, key)
		if len(keys) == 0 {
			delete(treeCacheKeys, rootID)
		}
	}
}

func ClearTreeCache() {
	treeCacheKeysMu.Lock()
	treeCacheKeys = map[string]map[string]struct{}{}
	treeCacheKeysMu.Unlock()
	treeCache.Clear()
}
