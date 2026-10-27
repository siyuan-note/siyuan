// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cache

import (
	"bytes"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/dgraph-io/ristretto"
)

var avCache, _ = ristretto.NewCache(&ristretto.Config{
	NumCounters: AdmissionCounters,
	MaxCost:     DefaultMaxCostBytes,
	BufferItems: 64,
})

type avCacheEntry struct {
	raw        []byte
	version    uint64
	normalized []byte
}

type avSearchDataEntry struct {
	data    any
	version uint64
}

// 逻辑键与准入键由 avSearchDataCacheLock 一并保护；准入序号在清理后也不复用。
var avCacheKeys = map[string]map[string]uint64{}
var avCacheSequence uint64

var avDataVersion uint64

// 失效后的版本令牌保留到全量清理，以拒绝尚未完成的原始数据准入和搜索结果写入。
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
	avSearchDataCacheLock.RLock()
	defer avSearchDataCacheLock.RUnlock()
	key := avCacheKey(avID, boxID)
	v, _ := avCache.Get(avCacheKeys[avID][key])
	if nil == v {
		return
	}
	entry := v.(*avCacheEntry)
	if entry.version != avDataVersions[key] {
		return
	}
	return entry.raw, entry.version, true
}

// GetAVNormalizedDataInBox 读取同一数据版本的规范化副本，共用原始数据的容量及失效边界。
func GetAVNormalizedDataInBox(avID, boxID string, version uint64) (data []byte, ok bool) {
	avSearchDataCacheLock.RLock()
	defer avSearchDataCacheLock.RUnlock()
	key := avCacheKey(avID, boxID)
	value, found := avCache.Get(avCacheKeys[avID][key])
	if !found || value == nil || avDataVersions[key] != version {
		return
	}
	entry := value.(*avCacheEntry)
	if entry.version != version || entry.normalized == nil {
		return
	}
	return entry.normalized, true
}

// SetAVNormalizedDataInBox 仅接纳已认证、已校验数据的同版本派生副本，不改变原始缓存字节。
func SetAVNormalizedDataInBox(avID, boxID string, version uint64, raw, normalized []byte) bool {
	if raw == nil || normalized == nil || version == 0 {
		return false
	}
	avSearchDataCacheLock.Lock()
	defer avSearchDataCacheLock.Unlock()
	key := avCacheKey(avID, boxID)
	if avDataVersions[key] != version {
		return false
	}
	cost := int64(len(raw) + len(normalized))
	if bytes.Equal(raw, normalized) {
		normalized = raw
		cost = int64(len(raw))
	}
	if cost > avCache.MaxCost() {
		return false
	}
	return replaceAVCacheLocked(avID, key, &avCacheEntry{raw: raw, version: version, normalized: normalized}, cost)
}

// replaceAVCacheLocked 使用独立准入键，让增长的条目参与淘汰，并隔离旧条目的异步写入及删除。
// 调用方必须持有 avSearchDataCacheLock。
func replaceAVCacheLocked(avID, key string, entry *avCacheEntry, cost int64) bool {
	keys := avCacheKeys[avID]
	if keys == nil {
		keys = map[string]uint64{}
		avCacheKeys[avID] = keys
	}
	previous := keys[key]
	avCacheSequence++
	cacheKey := avCacheSequence
	keys[key] = cacheKey
	if previous != 0 {
		avCache.Del(previous)
	}
	return avCache.Set(cacheKey, entry, cost)
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

// AVDataReadVersion captures source-read admission without allocating key tombstones.
func AVDataReadVersion() uint64 {
	avSearchDataCacheLock.RLock()
	defer avSearchDataCacheLock.RUnlock()
	return avDataVersion
}

func SetAVDataFromReadInBox(avID, boxID string, raw []byte, version uint64) uint64 {
	return setAVDataFromReadInBox(avID, boxID, raw, &version)
}

func setAVDataInBox(avID, boxID string, raw []byte) (version uint64) {
	return setAVDataFromReadInBox(avID, boxID, raw, nil)
}

func setAVDataFromReadInBox(avID, boxID string, raw []byte, expected *uint64) (version uint64) {
	if raw == nil {
		return
	}
	avSearchDataCacheLock.Lock()
	defer avSearchDataCacheLock.Unlock()
	if expected != nil && *expected != avDataVersion {
		return 0
	}
	key := avCacheKey(avID, boxID)
	version = invalidateAVSearchDataByKeyLocked(key)
	replaceAVCacheLocked(avID, key, &avCacheEntry{raw: raw, version: version}, int64(len(raw)))
	return
}

func RemoveAVDataInBox(avID, boxID string) {
	avSearchDataCacheLock.Lock()
	defer avSearchDataCacheLock.Unlock()
	key := avCacheKey(avID, boxID)
	invalidateAVSearchDataByKeyLocked(key)
	if keys := avCacheKeys[avID]; keys != nil {
		avCache.Del(keys[key])
		delete(keys, key)
		if len(keys) == 0 {
			delete(avCacheKeys, avID)
		}
	}
}

func RemoveAVData(avID string) {
	avSearchDataCacheLock.Lock()
	defer avSearchDataCacheLock.Unlock()
	keys := avCacheKeys[avID]
	delete(avCacheKeys, avID)
	for key, cacheKey := range keys {
		avCache.Del(cacheKey)
		invalidateAVSearchDataByKeyLocked(key)
	}
	invalidateAVSearchDataByKeyLocked(avCacheKey(avID, ""))
}

func ClearAVCache() {
	avSearchDataCacheLock.Lock()
	defer avSearchDataCacheLock.Unlock()
	avDataVersion++
	avCacheGeneration.Add(1)
	clearAVOrderedIDs("")
	avCacheKeys = map[string]map[string]uint64{}
	avCache.Clear()
	avDataVersions = map[string]uint64{}
	avSearchDataCache = map[string]*avSearchDataEntry{}
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

func invalidateAVSearchDataByKeyLocked(key string) (version uint64) {
	avDataVersion++
	version = avDataVersion
	avDataVersions[key] = version
	delete(avSearchDataCache, key)
	_, avID, found := strings.Cut(key, "\x00")
	if found {
		clearAVOrderedIDs(avID)
	}
	return
}
