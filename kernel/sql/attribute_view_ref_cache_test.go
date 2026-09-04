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

package sql

import (
	"testing"
	"time"

	"github.com/88250/lute/parse"
)

func TestRemoveRefCacheByPathEvictsWholeDefinition(t *testing.T) {
	originalIsEncryptedBoxFn, originalIsBoxUnlockedFn := IsEncryptedBoxFn, IsBoxUnlockedFn
	IsEncryptedBoxFn = func(string) bool { return false }
	IsBoxUnlockedFn = func(string) bool { return true }
	clearRefCache()
	t.Cleanup(func() {
		clearRefCache()
		IsEncryptedBoxFn, IsBoxUnlockedFn = originalIsEncryptedBoxFn, originalIsBoxUnlockedFn
	})

	const (
		definitionID = "20260904030000-def0001"
		boxID        = "20260904030001-box0001"
		targetPath   = "/20260904030002-root001.sy"
		otherPath    = "/20260904030003-root002.sy"
	)
	putRefCache(boxID, &Ref{
		DefBlockID: definitionID, BlockID: "target", RootID: "target-root", Box: boxID, Path: targetPath,
	})
	putRefCache(boxID, &Ref{
		DefBlockID: definitionID, BlockID: "other", RootID: "other-root", Box: boxID, Path: otherPath,
	})

	removeRefCacheByPath(boxID, targetPath)
	if _, ok := defIDRefsCache.Get(refCacheKey(definitionID, boxID)); ok {
		t.Fatal("path invalidation left a partial definition cache entry")
	}
}

func TestRefCachePartialPutMergesCompleteDatabaseResult(t *testing.T) {
	const (
		boxID        = "20260904030500-encbox1"
		definitionID = "20260904030501-def0001"
	)
	originalIsEncryptedBoxFn, originalIsBoxUnlockedFn := IsEncryptedBoxFn, IsBoxUnlockedFn
	IsEncryptedBoxFn = func(candidate string) bool { return boxID == candidate }
	IsBoxUnlockedFn = func(candidate string) bool { return boxID == candidate }
	clearRefCache()
	t.Cleanup(func() {
		clearRefCache()
		IsEncryptedBoxFn, IsBoxUnlockedFn = originalIsEncryptedBoxFn, originalIsBoxUnlockedFn
	})

	pending := &Ref{DefBlockID: definitionID, BlockID: "pending", Box: boxID, Path: "/a.sy"}
	stored := &Ref{DefBlockID: definitionID, BlockID: "stored", Box: boxID, Path: "/b.sy"}
	putRefCache(boxID, pending)
	queryCalls := 0
	refs := getRefsCacheByDefIDInBox(definitionID, boxID, func(string, bool, string) []*Ref {
		queryCalls++
		return []*Ref{stored}
	})
	if 2 != len(refs) || nil == refsByBlockID(refs)[pending.BlockID] || nil == refsByBlockID(refs)[stored.BlockID] {
		t.Fatalf("partial cache did not merge the complete database result: %+v", refs)
	}
	refs = getRefsCacheByDefIDInBox(definitionID, boxID, func(string, bool, string) []*Ref {
		queryCalls++
		return nil
	})
	if 1 != queryCalls || 2 != len(refs) {
		t.Fatalf("merged complete cache was not reused: calls=%d refs=%+v", queryCalls, refs)
	}
}

func TestRefCachePathReindexReloadsCompleteDefinition(t *testing.T) {
	const (
		boxID        = "20260904030700-encbox1"
		definitionID = "20260904030701-def0001"
		pathA        = "/a.sy"
		pathB        = "/b.sy"
	)
	originalIsEncryptedBoxFn, originalIsBoxUnlockedFn := IsEncryptedBoxFn, IsBoxUnlockedFn
	IsEncryptedBoxFn = func(candidate string) bool { return boxID == candidate }
	IsBoxUnlockedFn = func(candidate string) bool { return boxID == candidate }
	clearRefCache()
	t.Cleanup(func() {
		clearRefCache()
		IsEncryptedBoxFn, IsBoxUnlockedFn = originalIsEncryptedBoxFn, originalIsBoxUnlockedFn
	})

	oldA := &Ref{DefBlockID: definitionID, BlockID: "a", Box: boxID, Path: pathA, Content: "old"}
	refB := &Ref{DefBlockID: definitionID, BlockID: "b", Box: boxID, Path: pathB}
	getRefsCacheByDefIDInBox(definitionID, boxID, func(string, bool, string) []*Ref {
		return []*Ref{oldA, refB}
	})
	removeRefCacheByPath(boxID, pathA)
	if _, ok := defIDRefsCache.Get(refCacheKey(definitionID, boxID)); ok {
		t.Fatal("path invalidation retained an incomplete definition cache")
	}

	newA := &Ref{DefBlockID: definitionID, BlockID: "a", Box: boxID, Path: pathA, Content: "new"}
	queryCalls := 0
	refs := getRefsCacheByDefIDInBox(definitionID, boxID, func(string, bool, string) []*Ref {
		queryCalls++
		return []*Ref{newA, refB}
	})
	byBlockID := refsByBlockID(refs)
	if 2 != len(refs) || "new" != byBlockID["a"].Content || nil == byBlockID["b"] {
		t.Fatalf("reindexed definition cache is incomplete: %+v", refs)
	}
	refs = getRefsCacheByDefIDInBox(definitionID, boxID, func(string, bool, string) []*Ref {
		queryCalls++
		return nil
	})
	if 1 != queryCalls || 2 != len(refs) {
		t.Fatalf("complete reindexed cache was not reused: calls=%d refs=%+v", queryCalls, refs)
	}
}

func TestFailedRefQueueOperationClearsPendingCache(t *testing.T) {
	const (
		boxID        = "20260904030900-encbox1"
		definitionID = "20260904030901-def0001"
		pathA        = "/a.sy"
		pathB        = "/b.sy"
	)
	originalIsEncryptedBoxFn, originalIsBoxUnlockedFn := IsEncryptedBoxFn, IsBoxUnlockedFn
	IsEncryptedBoxFn = func(candidate string) bool { return boxID == candidate }
	IsBoxUnlockedFn = func(candidate string) bool { return boxID == candidate }
	clearRefCache()
	t.Cleanup(func() {
		clearRefCache()
		IsEncryptedBoxFn, IsBoxUnlockedFn = originalIsEncryptedBoxFn, originalIsBoxUnlockedFn
	})

	oldA := &Ref{DefBlockID: definitionID, BlockID: "a", Box: boxID, Path: pathA, Content: "old"}
	refB := &Ref{DefBlockID: definitionID, BlockID: "b", Box: boxID, Path: pathB}
	getRefsCacheByDefIDInBox(definitionID, boxID, func(string, bool, string) []*Ref {
		return []*Ref{oldA, refB}
	})
	removeRefCacheByPath(boxID, pathA)
	putRefCache(boxID, &Ref{
		DefBlockID: definitionID, BlockID: "a", Box: boxID, Path: pathA, Content: "uncommitted",
	})
	getRefsCacheByDefIDInBox(definitionID, boxID, func(string, bool, string) []*Ref {
		return []*Ref{oldA, refB}
	})
	invalidateRefsCacheForOperation(&dbQueueOperation{
		action: "update_refs", upsertTree: &parse.Tree{Box: boxID, Path: pathA},
	})

	queryCalls := 0
	refs := getRefsCacheByDefIDInBox(definitionID, boxID, func(string, bool, string) []*Ref {
		queryCalls++
		return []*Ref{oldA, refB}
	})
	byBlockID := refsByBlockID(refs)
	if 1 != queryCalls || 2 != len(refs) || "old" != byBlockID["a"].Content || nil == byBlockID["b"] {
		t.Fatalf("failed operation cache did not return to database state: calls=%d refs=%+v", queryCalls, refs)
	}
}

func refsByBlockID(refs []*Ref) map[string]*Ref {
	ret := make(map[string]*Ref, len(refs))
	for _, ref := range refs {
		if nil != ref {
			ret[ref.BlockID] = ref
		}
	}
	return ret
}

func TestRemoveRefCacheByPathUsesEncryptedScope(t *testing.T) {
	const encryptedBoxID = "20260904031000-encbox1"
	originalIsEncryptedBoxFn, originalIsBoxUnlockedFn := IsEncryptedBoxFn, IsBoxUnlockedFn
	IsEncryptedBoxFn = func(boxID string) bool { return encryptedBoxID == boxID }
	IsBoxUnlockedFn = func(boxID string) bool { return encryptedBoxID == boxID }
	clearRefCache()
	t.Cleanup(func() {
		clearRefCache()
		IsEncryptedBoxFn, IsBoxUnlockedFn = originalIsEncryptedBoxFn, originalIsBoxUnlockedFn
	})

	const definitionID = "20260904031001-def0001"
	putRefCache(encryptedBoxID, &Ref{
		DefBlockID: definitionID, BlockID: "carrier", RootID: "root", Box: encryptedBoxID, Path: "/root.sy",
	})
	removeRefCacheByPath(encryptedBoxID, "/root.sy")
	if _, ok := defIDRefsCache.Get(refCacheKey(definitionID, encryptedBoxID)); ok {
		t.Fatal("encrypted carrier reference remained cached after reindexing")
	}
}

func TestRefCacheLateQueryDoesNotRepopulateInvalidatedScope(t *testing.T) {
	const (
		boxID        = "20260904032000-encbox1"
		definitionID = "20260904032001-def0001"
		path         = "/20260904032002-root001.sy"
	)
	originalIsEncryptedBoxFn, originalIsBoxUnlockedFn := IsEncryptedBoxFn, IsBoxUnlockedFn
	IsEncryptedBoxFn = func(candidate string) bool { return boxID == candidate }
	IsBoxUnlockedFn = func(candidate string) bool { return boxID == candidate }
	clearRefCache()
	t.Cleanup(func() {
		clearRefCache()
		IsEncryptedBoxFn, IsBoxUnlockedFn = originalIsEncryptedBoxFn, originalIsBoxUnlockedFn
	})

	stale := &Ref{DefBlockID: definitionID, BlockID: "stale", Box: boxID, Path: path}
	queryStarted := make(chan struct{})
	allowQueryReturn := make(chan struct{})
	result := make(chan []*Ref, 1)
	go func() {
		result <- getRefsCacheByDefIDInBox(definitionID, boxID,
			func(string, bool, string) []*Ref {
				close(queryStarted)
				<-allowQueryReturn
				return []*Ref{stale}
			})
	}()

	select {
	case <-queryStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("reference cache query did not start")
	}
	removeRefCacheByPath(boxID, path)
	close(allowQueryReturn)
	select {
	case refs := <-result:
		if 1 != len(refs) || "stale" != refs[0].BlockID {
			t.Fatalf("unexpected in-flight query result: %+v", refs)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("reference cache query did not finish")
	}

	if _, ok := defIDRefsCache.Get(refCacheKey(definitionID, boxID)); ok {
		t.Fatal("late query repopulated an invalidated reference cache scope")
	}
	fresh := &Ref{DefBlockID: definitionID, BlockID: "fresh", Box: boxID, Path: path}
	queryCalls := 0
	refs := getRefsCacheByDefIDInBox(definitionID, boxID, func(string, bool, string) []*Ref {
		queryCalls++
		return []*Ref{fresh}
	})
	if 1 != len(refs) || "fresh" != refs[0].BlockID {
		t.Fatalf("fresh query result was not cached: %+v", refs)
	}
	refs = getRefsCacheByDefIDInBox(definitionID, boxID, func(string, bool, string) []*Ref {
		queryCalls++
		return nil
	})
	if 1 != queryCalls || 1 != len(refs) || "fresh" != refs[0].BlockID {
		t.Fatalf("fresh cache was not reused: calls=%d refs=%+v", queryCalls, refs)
	}
}

func TestRefCacheLateQueryDoesNotOverwriteAuthoritativePut(t *testing.T) {
	const (
		boxID        = "20260904032500-encbox1"
		definitionID = "20260904032501-def0001"
		path         = "/20260904032502-root001.sy"
		blockID      = "20260904032503-block01"
	)
	originalIsEncryptedBoxFn, originalIsBoxUnlockedFn := IsEncryptedBoxFn, IsBoxUnlockedFn
	IsEncryptedBoxFn = func(candidate string) bool { return boxID == candidate }
	IsBoxUnlockedFn = func(candidate string) bool { return boxID == candidate }
	clearRefCache()
	t.Cleanup(func() {
		clearRefCache()
		IsEncryptedBoxFn, IsBoxUnlockedFn = originalIsEncryptedBoxFn, originalIsBoxUnlockedFn
	})

	queryStarted := make(chan struct{})
	allowQueryReturn := make(chan struct{})
	result := make(chan []*Ref, 1)
	go func() {
		result <- getRefsCacheByDefIDInBox(definitionID, boxID,
			func(string, bool, string) []*Ref {
				close(queryStarted)
				<-allowQueryReturn
				return []*Ref{{
					DefBlockID: definitionID, BlockID: blockID, Box: boxID, Path: path, Content: "stale",
				}}
			})
	}()

	select {
	case <-queryStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("reference cache query did not start")
	}
	putRefCache(boxID, &Ref{
		DefBlockID: definitionID, BlockID: blockID, Box: boxID, Path: path, Content: "fresh",
	})
	close(allowQueryReturn)
	select {
	case <-result:
	case <-time.After(3 * time.Second):
		t.Fatal("reference cache query did not finish")
	}

	item, ok := defIDRefsCache.Get(refCacheKey(definitionID, boxID))
	if !ok {
		t.Fatal("authoritative reference cache entry is missing")
	}
	entry := item.(*refCacheEntry)
	if nil == entry.refs[blockID] || "fresh" != entry.refs[blockID].Content {
		t.Fatalf("late query overwrote pending cache entry: %+v", entry.refs)
	}
}

func TestRefCacheInvalidationGenerations(t *testing.T) {
	const (
		boxA         = "20260904033000-encbox1"
		boxB         = "20260904033001-encbox2"
		definitionID = "20260904033002-def0001"
	)
	originalIsEncryptedBoxFn, originalIsBoxUnlockedFn := IsEncryptedBoxFn, IsBoxUnlockedFn
	IsEncryptedBoxFn = func(candidate string) bool { return boxA == candidate || boxB == candidate }
	IsBoxUnlockedFn = func(candidate string) bool { return boxA == candidate || boxB == candidate }
	clearRefCache()
	t.Cleanup(func() {
		clearRefCache()
		IsEncryptedBoxFn, IsBoxUnlockedFn = originalIsEncryptedBoxFn, originalIsBoxUnlockedFn
	})

	beforeA, beforeB := getRefCacheGeneration(boxA), getRefCacheGeneration(boxB)
	removeRefCacheByPath(boxB, "/root.sy")
	afterA, afterB := getRefCacheGeneration(boxA), getRefCacheGeneration(boxB)
	if beforeA != afterA {
		t.Fatalf("invalidating another encrypted scope changed generation A: before=%+v after=%+v", beforeA, afterA)
	}
	if beforeB.global != afterB.global || beforeB.scope == afterB.scope {
		t.Fatalf("path invalidation did not advance only scope B: before=%+v after=%+v", beforeB, afterB)
	}

	beforeGlobal := getRefCacheGeneration(boxA)
	removeRefCacheByDefID(definitionID)
	afterGlobal := getRefCacheGeneration(boxA)
	if beforeGlobal.global == afterGlobal.global {
		t.Fatalf("definition invalidation did not advance global generation: before=%+v after=%+v",
			beforeGlobal, afterGlobal)
	}

	beforeGlobal = getRefCacheGeneration(boxA)
	clearRefCache()
	afterGlobal = getRefCacheGeneration(boxA)
	if beforeGlobal.global == afterGlobal.global {
		t.Fatalf("cache clear did not advance global generation: before=%+v after=%+v", beforeGlobal, afterGlobal)
	}
}
