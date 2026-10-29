// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cache

import (
	"strings"
	"sync"
)

const avOrderMaxBytes = 4 * 1024 * 1024
const avOrderSlots = 16
const avOrderMetadataBytes = avOrderSlots * 192

type avOrderEntry struct {
	key     [32]byte
	avID    string
	version uint64
	ids     string
	count   int
	used    uint64
}

var avOrders = struct {
	sync.Mutex
	entries [avOrderSlots]avOrderEntry
	bytes   int
	clock   uint64
}{bytes: avOrderMetadataBytes}

// GetAVOrderedIDs 返回普通数据库同版本的独立 ID 切片，不共享可变渲染对象。
func GetAVOrderedIDs(avID string, version, generation uint64, key [32]byte) ([]string, bool) {
	avSearchDataCacheLock.RLock()
	defer avSearchDataCacheLock.RUnlock()
	if version == 0 || avDataVersions[avCacheKey(avID, "")] != version || avCacheGeneration.Load() != generation {
		return nil, false
	}
	avOrders.Lock()
	defer avOrders.Unlock()
	for i := range avOrders.entries {
		entry := &avOrders.entries[i]
		if entry.used != 0 && entry.key == key && entry.avID == avID && entry.version == version {
			avOrders.clock++
			entry.used = avOrders.clock
			if entry.count == 0 {
				return []string{}, true
			}
			return strings.Split(entry.ids, "\x00"), true
		}
	}
	return nil, false
}

// SetAVOrderedIDs 限制保留字节和条目数，并拒绝失效前已开始的旧请求写回。
func SetAVOrderedIDs(avID string, version, generation uint64, key [32]byte, ids []string) bool {
	cost := len(avID)
	for _, id := range ids {
		if id == "" || strings.ContainsRune(id, 0) {
			return false
		}
		cost += len(id) + 1
		if cost > avOrderMaxBytes-avOrderMetadataBytes {
			return false
		}
	}
	avSearchDataCacheLock.RLock()
	defer avSearchDataCacheLock.RUnlock()
	if version == 0 || avDataVersions[avCacheKey(avID, "")] != version || avCacheGeneration.Load() != generation {
		return false
	}
	avOrders.Lock()
	defer avOrders.Unlock()
	for i := range avOrders.entries {
		entry := &avOrders.entries[i]
		if entry.used != 0 && entry.key == key {
			avOrders.bytes -= len(entry.avID) + len(entry.ids)
			*entry = avOrderEntry{}
		}
	}
	for {
		slot, oldest := -1, -1
		for i, entry := range avOrders.entries {
			if entry.used == 0 {
				slot = i
			} else if oldest < 0 || entry.used < avOrders.entries[oldest].used {
				oldest = i
			}
		}
		if slot >= 0 && avOrders.bytes+cost <= avOrderMaxBytes {
			payload := strings.Join(ids, "\x00")
			if len(ids) == 1 {
				payload = strings.Clone(payload)
			}
			avOrders.clock++
			avOrders.entries[slot] = avOrderEntry{key: key, avID: strings.Clone(avID), version: version, ids: payload, count: len(ids), used: avOrders.clock}
			avOrders.bytes += len(avID) + len(payload)
			return true
		}
		if oldest < 0 {
			return false
		}
		entry := &avOrders.entries[oldest]
		avOrders.bytes -= len(entry.avID) + len(entry.ids)
		*entry = avOrderEntry{}
	}
}

// 调用方持有 avSearchDataCacheLock，失效与准入使用一致的锁顺序。
func clearAVOrderedIDs(avID string) {
	avOrders.Lock()
	defer avOrders.Unlock()
	for i := range avOrders.entries {
		entry := &avOrders.entries[i]
		if avID == "" || entry.avID == avID {
			avOrders.bytes -= len(entry.avID) + len(entry.ids)
			*entry = avOrderEntry{}
		}
	}
}
