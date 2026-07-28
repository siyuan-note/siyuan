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

var avCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 1000,
	MaxCost:     1024 * 1024 * 200,
	BufferItems: 64,
})

var avCacheKeys = map[string]map[string]struct{}{}
var avCacheKeysLock sync.Mutex

var avSearchDataCache = map[string]any{}
var avSearchDataCacheLock sync.RWMutex

func avCacheKey(avID, boxID string) string {
	return boxID + "\x00" + avID
}

func GetAVData(avID string) (raw []byte, ok bool) {
	return GetAVDataInBox(avID, "")
}

func GetAVDataInBox(avID, boxID string) (raw []byte, ok bool) {
	v, _ := avCache.Get(avCacheKey(avID, boxID))
	if nil == v {
		return nil, false
	}
	return v.([]byte), true
}

func SetAVData(avID string, raw []byte) {
	SetAVDataInBox(avID, "", raw)
}

func SetAVDataInBox(avID, boxID string, raw []byte) {
	if raw == nil {
		return
	}
	key := avCacheKey(avID, boxID)
	avCache.Set(key, raw, int64(len(raw)))
	removeAVSearchDataByKey(key)

	avCacheKeysLock.Lock()
	defer avCacheKeysLock.Unlock()
	keys := avCacheKeys[avID]
	if keys == nil {
		keys = map[string]struct{}{}
		avCacheKeys[avID] = keys
	}
	keys[key] = struct{}{}
}

func RemoveAVDataInBox(avID, boxID string) {
	key := avCacheKey(avID, boxID)
	avCache.Del(key)
	removeAVSearchDataByKey(key)

	avCacheKeysLock.Lock()
	defer avCacheKeysLock.Unlock()
	if keys := avCacheKeys[avID]; keys != nil {
		delete(keys, key)
		if len(keys) == 0 {
			delete(avCacheKeys, avID)
		}
	}
}

func RemoveAVData(avID string) {
	avCacheKeysLock.Lock()
	keys := avCacheKeys[avID]
	delete(avCacheKeys, avID)
	avCacheKeysLock.Unlock()

	avCache.Del(avID)
	avCache.Del(avCacheKey(avID, ""))
	for key := range keys {
		avCache.Del(key)
		removeAVSearchDataByKey(key)
	}
	removeAVSearchDataByKey(avCacheKey(avID, ""))
}

func ClearAVCache() {
	avCacheKeysLock.Lock()
	avCacheKeys = map[string]map[string]struct{}{}
	avCacheKeysLock.Unlock()
	avCache.Clear()

	avSearchDataCacheLock.Lock()
	avSearchDataCache = map[string]any{}
	avSearchDataCacheLock.Unlock()
}

func GetAVSearchDataInBox[T any](avID, boxID string) (ret T, ok bool) {
	avSearchDataCacheLock.RLock()
	data := avSearchDataCache[avCacheKey(avID, boxID)]
	avSearchDataCacheLock.RUnlock()
	if data == nil {
		return
	}
	ret, ok = data.(T)
	return
}

func SetAVSearchDataInBox(avID, boxID string, data any) {
	if data == nil {
		return
	}
	avSearchDataCacheLock.Lock()
	avSearchDataCache[avCacheKey(avID, boxID)] = data
	avSearchDataCacheLock.Unlock()
}

func removeAVSearchDataByKey(key string) {
	avSearchDataCacheLock.Lock()
	delete(avSearchDataCache, key)
	avSearchDataCacheLock.Unlock()
}
