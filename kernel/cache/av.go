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
	"sync/atomic"

	"github.com/dgraph-io/ristretto"
)

var avCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: 1000,
	MaxCost:     1024 * 1024 * 200,
	BufferItems: 64,
})

type avCacheEntry struct {
	raw     []byte
	version uint64
}

type avSearchDataEntry struct {
	data    any
	version uint64
}

var avCacheKeys = map[string]map[string]struct{}{}
var avCacheKeysLock sync.Mutex

var avDataVersion uint64
var avDataVersions = map[string]uint64{}
var avSearchDataCache = map[string]*avSearchDataEntry{}
var avSearchDataCacheLock sync.RWMutex
var avCacheGeneration atomic.Uint64

func avCacheKey(avID, boxID string) string {
	return boxID + "\x00" + avID
}

func GetAVData(avID string) (raw []byte, ok bool) {
	return GetAVDataInBox(avID, "")
}

func GetAVDataInBox(avID, boxID string) (raw []byte, ok bool) {
	raw, _, ok = GetAVDataWithVersionInBox(avID, boxID)
	return
}

func GetAVDataWithVersionInBox(avID, boxID string) (raw []byte, version uint64, ok bool) {
	v, _ := avCache.Get(avCacheKey(avID, boxID))
	if nil == v {
		return
	}
	entry := v.(*avCacheEntry)
	return entry.raw, entry.version, true
}

func EnsureAVDataVersionInBox(avID, boxID string) (version uint64) {
	avSearchDataCacheLock.Lock()
	defer avSearchDataCacheLock.Unlock()
	key := avCacheKey(avID, boxID)
	version = avDataVersions[key]
	if version == 0 {
		avDataVersion++
		version = avDataVersion
		avDataVersions[key] = version
	}
	return
}

func SetAVData(avID string, raw []byte) {
	SetAVDataInBox(avID, "", raw)
}

func SetAVDataInBox(avID, boxID string, raw []byte) {
	setAVDataInBox(avID, boxID, raw)
}

func SetAVDataWithVersionInBox(avID, boxID string, raw []byte) uint64 {
	return setAVDataInBox(avID, boxID, raw)
}

func setAVDataInBox(avID, boxID string, raw []byte) (version uint64) {
	if raw == nil {
		return
	}
	key := avCacheKey(avID, boxID)
	version = invalidateAVSearchDataByKey(key)
	avCache.Set(key, &avCacheEntry{raw: raw, version: version}, int64(len(raw)))

	avCacheKeysLock.Lock()
	defer avCacheKeysLock.Unlock()
	keys := avCacheKeys[avID]
	if keys == nil {
		keys = map[string]struct{}{}
		avCacheKeys[avID] = keys
	}
	keys[key] = struct{}{}
	return
}

func RemoveAVDataInBox(avID, boxID string) {
	key := avCacheKey(avID, boxID)
	avCache.Del(key)
	invalidateAVSearchDataByKey(key)

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
		invalidateAVSearchDataByKey(key)
	}
	invalidateAVSearchDataByKey(avCacheKey(avID, ""))
}

func ClearAVCache() {
	avCacheGeneration.Add(1)
	avCacheKeysLock.Lock()
	avCacheKeys = map[string]map[string]struct{}{}
	avCacheKeysLock.Unlock()
	avCache.Clear()

	avSearchDataCacheLock.Lock()
	avDataVersions = map[string]uint64{}
	avSearchDataCache = map[string]*avSearchDataEntry{}
	avSearchDataCacheLock.Unlock()
}

func GetAVCacheGeneration() uint64 {
	return avCacheGeneration.Load()
}

func GetAVSearchDataInBox[T any](avID, boxID string) (ret T, ok bool) {
	avSearchDataCacheLock.RLock()
	key := avCacheKey(avID, boxID)
	entry := avSearchDataCache[key]
	version := avDataVersions[key]
	avSearchDataCacheLock.RUnlock()
	if entry == nil || entry.version != version {
		return
	}
	ret, ok = entry.data.(T)
	return
}

func SetAVSearchDataInBox(avID, boxID string, version uint64, data any) (ok bool) {
	if data == nil || version == 0 {
		return
	}
	avSearchDataCacheLock.Lock()
	defer avSearchDataCacheLock.Unlock()
	key := avCacheKey(avID, boxID)
	if avDataVersions[key] != version {
		return
	}
	avSearchDataCache[key] = &avSearchDataEntry{data: data, version: version}
	return true
}

func invalidateAVSearchDataByKey(key string) (version uint64) {
	avSearchDataCacheLock.Lock()
	avDataVersion++
	version = avDataVersion
	avDataVersions[key] = version
	delete(avSearchDataCache, key)
	avSearchDataCacheLock.Unlock()
	return
}
