// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cache

import (
	"crypto/sha256"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestAVOrderedIDsPreserveIsolationAndRejectStaleWrites(t *testing.T) {
	ClearAVCache()
	t.Cleanup(ClearAVCache)
	const id = "av-order-test"
	version := SetAVDataWithVersionInBox(id, "", []byte(`{}`))
	generation := GetAVCacheGeneration()
	key := sha256.Sum256([]byte("view definition and scope"))
	input := []string{"first", "second"}
	if !SetAVOrderedIDs(id, version, generation, key, input) {
		t.Fatal("valid source version was rejected")
	}
	input[0] = "changed input"
	got, ok := GetAVOrderedIDs(id, version, generation, key)
	if !ok || len(got) != 2 || got[0] != "first" {
		t.Fatal("input mutation changed the cached order")
	}
	got[0] = "changed result"
	again, _ := GetAVOrderedIDs(id, version, generation, key)
	if again[0] != "first" {
		t.Fatal("returned slices shared mutable state")
	}
	RemoveAVData(id)
	if _, ok = GetAVOrderedIDs(id, version, generation, key); ok || SetAVOrderedIDs(id, version, generation, key, input) {
		t.Fatal("invalidated source accepted an old read or write")
	}
	version = SetAVDataWithVersionInBox(id, "", []byte(`{"changed":true}`))
	if !SetAVOrderedIDs(id, version, generation, key, []string{}) {
		t.Fatal("empty result set was rejected")
	}
	if ids, hit := GetAVOrderedIDs(id, version, generation, key); !hit || len(ids) != 0 {
		t.Fatal("empty result set was confused with a cache miss")
	}
	ClearAVCache()
	if SetAVOrderedIDs(id, version, generation, key, input) || avOrders.bytes != avOrderMetadataBytes {
		t.Fatal("global invalidation retained payloads or admitted an old request")
	}
	scopedVersion := SetAVDataWithVersionInBox(id, "encrypted-box", []byte(`{}`))
	if SetAVOrderedIDs(id, scopedVersion, GetAVCacheGeneration(), key, input) {
		t.Fatal("scoped encrypted data entered the ordinary-source order cache")
	}
}

func TestAVOrderedIDsByteBudgetAndEviction(t *testing.T) {
	ClearAVCache()
	t.Cleanup(ClearAVCache)
	version := SetAVDataWithVersionInBox("av", "", []byte(`{}`))
	generation := GetAVCacheGeneration()
	for i := range 24 {
		key := sha256.Sum256([]byte(fmt.Sprint(i)))
		if !SetAVOrderedIDs("av", version, generation, key, []string{strings.Repeat("x", 512*1024)}) {
			t.Fatal("bounded entry was rejected")
		}
		if avOrders.bytes > avOrderMaxBytes {
			t.Fatalf("retained bytes exceeded budget: %d", avOrders.bytes)
		}
	}
	if _, ok := GetAVOrderedIDs("av", version, generation, sha256.Sum256([]byte("0"))); ok {
		t.Fatal("oldest entry was not evicted")
	}
	if _, ok := GetAVOrderedIDs("av", version, generation, sha256.Sum256([]byte("23"))); !ok {
		t.Fatal("newest entry was lost")
	}
	if SetAVOrderedIDs("av", version, generation, [32]byte{}, []string{strings.Repeat("x", avOrderMaxBytes)}) {
		t.Fatal("oversized entry exceeded the byte budget")
	}
}

func TestAVOrderedIDsConcurrentInvalidationAndAdmission(t *testing.T) {
	ClearAVCache()
	t.Cleanup(ClearAVCache)
	const id = "concurrent-order"
	generation := GetAVCacheGeneration()
	key := sha256.Sum256([]byte("concurrent view"))
	var workers sync.WaitGroup
	var invalid atomic.Bool
	for range 4 {
		workers.Go(func() {
			for range 100 {
				version := EnsureAVDataVersionInBox(id, "")
				SetAVOrderedIDs(id, version, generation, key, []string{"first", "second"})
				if ids, found := GetAVOrderedIDs(id, version, generation, key); found {
					if len(ids) != 2 || ids[0] != "first" || ids[1] != "second" {
						invalid.Store(true)
					}
					ids[0] = "local mutation"
				}
			}
		})
	}
	for range 100 {
		RemoveAVData(id)
	}
	workers.Wait()
	if invalid.Load() {
		t.Fatal("concurrent reads shared mutable IDs or admitted a partial payload")
	}
	ClearAVCache()
	if avOrders.bytes != avOrderMetadataBytes {
		t.Fatal("invalidation retained a concurrently admitted payload")
	}
}
