// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cache

import (
	"bytes"
	"sync"

	"github.com/dgraph-io/ristretto"
	"github.com/klauspost/compress/zstd"
)

type treeCacheEntry struct {
	raw        []byte
	compressed bool
	rawSize    int
	generation uint64
}

const treeCacheMaxCost = DefaultMaxCostBytes

var (
	treeCacheEncoder, _ = zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.SpeedFastest),
		zstd.WithEncoderConcurrency(1), zstd.WithWindowSize(512*1024))
	treeCacheDecoder, _ = zstd.NewReader(nil, zstd.WithDecoderConcurrency(1),
		zstd.WithDecoderMaxMemory(treeCacheMaxCost), zstd.WithDecodeAllCapLimit(true))
	treeCache, _ = ristretto.NewCache(&ristretto.Config{
		NumCounters: AdmissionCounters,
		MaxCost:     treeCacheMaxCost,
		BufferItems: 64,
	})
	treeCacheKeys       = map[string]map[string]uint64{}
	treeCacheKeysMu     sync.Mutex
	treeCacheGeneration uint64
)

func treeCacheKey(rootID, boxID string) string {
	return boxID + "\x00" + rootID
}

func GetTreeDataInBox(rootID, boxID string) (raw []byte, ok bool) {
	treeCacheKeysMu.Lock()
	key := treeCacheKey(rootID, boxID)
	v, _ := treeCache.Get(key)
	if nil == v {
		treeCacheKeysMu.Unlock()
		return nil, false
	}
	e := v.(*treeCacheEntry)
	// 异步准入可能保留较早的写入，只接受当前版本，否则交由调用方读取源文件。
	if e.generation != treeCacheKeys[rootID][key] {
		treeCacheKeysMu.Unlock()
		return nil, false
	}
	treeCacheKeysMu.Unlock()
	if e.compressed {
		var err error
		raw, err = treeCacheDecoder.DecodeAll(e.raw, make([]byte, 0, e.rawSize))
		if err != nil || len(raw) != e.rawSize {
			return nil, false
		}
	} else {
		raw = bytes.Clone(e.raw)
	}
	// 解码期间可能发生写入或笔记本锁定，返回前再次检查当前版本。
	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	if e.generation != treeCacheKeys[rootID][key] {
		return nil, false
	}
	return raw, true
}

func SetTreeDataInBox(rootID, boxID string, raw []byte) {
	setTreeDataInBox(rootID, boxID, raw, nil)
}

// TreeDataReadVersion captures the mutation boundary before reading source bytes.
// A global clock avoids retaining per-document tombstones for in-flight reads.
func TreeDataReadVersion() uint64 {
	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	return treeCacheGeneration
}

func SetTreeDataFromReadInBox(rootID, boxID string, raw []byte, version uint64) bool {
	return setTreeDataInBox(rootID, boxID, raw, &version)
}

func setTreeDataInBox(rootID, boxID string, raw []byte, expected *uint64) bool {
	if raw == nil {
		return false
	}
	if len(raw) >= treeCacheMaxCost {
		if expected == nil {
			RemoveTreeDataInBox(rootID, boxID)
		}
		return false
	}
	entry := &treeCacheEntry{rawSize: len(raw)}
	// 小文档不压缩；只有实际减少驻留字节时才保存压缩结果。
	if len(raw) >= 1024 && treeCacheEncoder != nil && treeCacheDecoder != nil {
		compressed := treeCacheEncoder.EncodeAll(raw, nil)
		if len(compressed) < len(raw) {
			entry.raw = bytes.Clone(compressed)
			entry.compressed = true
		}
	}
	if !entry.compressed {
		entry.raw = bytes.Clone(raw)
	}
	key := treeCacheKey(rootID, boxID)
	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	if expected != nil && *expected != treeCacheGeneration {
		return false
	}
	treeCacheGeneration++
	entry.generation = treeCacheGeneration
	keys := treeCacheKeys[rootID]
	if keys == nil {
		keys = map[string]uint64{}
		treeCacheKeys[rootID] = keys
	}
	keys[key] = entry.generation
	return treeCache.Set(key, entry, int64(cap(entry.raw))+64)
}

func RemoveTreeData(rootID string) {
	treeCacheKeysMu.Lock()
	defer treeCacheKeysMu.Unlock()
	treeCacheGeneration++
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
	treeCacheGeneration++
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
	treeCacheGeneration++
	treeCacheKeys = map[string]map[string]uint64{}
	treeCache.Clear()
}
