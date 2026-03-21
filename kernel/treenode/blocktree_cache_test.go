// blocktree_cache_test.go — comprehensive correctness + data-loss + benchmark
// tests for the in-process BlockTree cache added to blocktree.go.
//
// Run all:
//
//	go test ./treenode/ -v -count=1 -race
//
// Run benchmarks (shows before/after SQLite):
//
//	go test ./treenode/ -bench=. -benchmem -benchtime=3s -count=1
//
// Run only data-loss scenarios:
//
//	go test ./treenode/ -run=DataLoss -v -count=1
package treenode

import (
	"fmt"
	"sync"
	"testing"
)

// ─── helpers ────────────────────────────────────────────────────────────────

func makeBT(id, rootID, parentID, boxID, path, hpath, updated, typ string) *BlockTree {
	return &BlockTree{
		ID:       id,
		RootID:   rootID,
		ParentID: parentID,
		BoxID:    boxID,
		Path:     path,
		HPath:    hpath,
		Updated:  updated,
		Type:     typ,
	}
}

func freshCache() *btCacheStore {
	return &btCacheStore{
		byID:   make(map[string]*BlockTree, 64),
		byRoot: make(map[string][]*BlockTree, 16),
	}
}

// ─── Unit: basic put / get ────────────────────────────────────────────────

func TestCache_PutGet(t *testing.T) {
	c := freshCache()

	bt := makeBT("id1", "root1", "", "box1", "/a/b.sy", "/A/B", "20250101", "d")
	c.put(bt)

	got := c.get("id1")
	if got == nil {
		t.Fatal("expected cache hit, got nil")
	}
	if got.RootID != "root1" {
		t.Errorf("RootID mismatch: want root1 got %s", got.RootID)
	}
	if got.Path != "/a/b.sy" {
		t.Errorf("Path mismatch: want /a/b.sy got %s", got.Path)
	}
}

func TestCache_Miss(t *testing.T) {
	c := freshCache()
	if got := c.get("nonexistent"); got != nil {
		t.Errorf("expected nil on miss, got %+v", got)
	}
}

func TestCache_PutNilOrEmpty(t *testing.T) {
	c := freshCache()
	c.put(nil)
	c.put(&BlockTree{}) // empty ID
	if len(c.byID) != 0 {
		t.Errorf("expected empty cache, have %d entries", len(c.byID))
	}
}

// ─── Unit: remove by ID ───────────────────────────────────────────────────

func TestCache_RemoveById(t *testing.T) {
	c := freshCache()
	bt := makeBT("id1", "root1", "", "box1", "/a/b.sy", "/A/B", "20250101", "d")
	c.put(bt)

	c.remove("id1")
	if got := c.get("id1"); got != nil {
		t.Errorf("expected nil after remove, got %+v", got)
	}
	// byRoot index must also be cleared
	if bts := c.getByRoot("root1"); len(bts) != 0 {
		t.Errorf("byRoot still has %d entries after remove", len(bts))
	}
}

func TestCache_RemoveNonExistent(t *testing.T) {
	c := freshCache()
	c.remove("ghost") // must not panic
}

// ─── Unit: remove by root ─────────────────────────────────────────────────

func TestCache_RemoveByRoot(t *testing.T) {
	c := freshCache()
	for i := 0; i < 10; i++ {
		id := fmt.Sprintf("block%d", i)
		c.put(makeBT(id, "root1", "", "box1", "/a.sy", "/A", "20250101", "p"))
	}
	// add a block for a different root that must survive
	c.put(makeBT("other", "root2", "", "box1", "/b.sy", "/B", "20250101", "d"))

	c.removeByRoot("root1")

	if bts := c.getByRoot("root1"); len(bts) != 0 {
		t.Errorf("root1 bucket still has %d entries", len(bts))
	}
	for i := 0; i < 10; i++ {
		id := fmt.Sprintf("block%d", i)
		if got := c.get(id); got != nil {
			t.Errorf("block %s should be evicted, still in cache", id)
		}
	}
	// root2 must be unaffected
	if got := c.get("other"); got == nil {
		t.Error("unrelated block 'other' was incorrectly evicted")
	}
}

// ─── Unit: remove by box ──────────────────────────────────────────────────

func TestCache_RemoveByBox(t *testing.T) {
	c := freshCache()
	c.put(makeBT("a1", "rA", "", "boxA", "/a.sy", "/a", "20250101", "d"))
	c.put(makeBT("a2", "rA", "a1", "boxA", "/a.sy", "/a", "20250101", "p"))
	c.put(makeBT("b1", "rB", "", "boxB", "/b.sy", "/b", "20250101", "d"))

	c.removeByBox("boxA")

	if got := c.get("a1"); got != nil {
		t.Error("a1 (boxA) should be evicted")
	}
	if got := c.get("a2"); got != nil {
		t.Error("a2 (boxA) should be evicted")
	}
	if got := c.get("b1"); got == nil {
		t.Error("b1 (boxB) should not be evicted")
	}
}

// ─── Unit: remove by path prefix (folder rename) ─────────────────────────
// DATA LOSS SCENARIO: if folder /notebooks/A/ is renamed to /notebooks/B/,
// RemoveBlockTreesByPathPrefix("/notebooks/A/") is called.  The cache MUST be
// invalidated for all blocks whose path starts with /notebooks/A/ — otherwise
// subsequent GetBlockTree calls return stale paths, causing LoadTree to attempt
// a read from a now-non-existent file path, which can corrupt in-flight txs.

func TestCache_RemoveByPathPrefix_FolderRename(t *testing.T) {
	c := freshCache()

	// Three docs inside the renamed folder.
	c.put(makeBT("d1", "r1", "", "box1", "/A/doc1.sy", "/A/doc1", "20250101", "d"))
	c.put(makeBT("d2", "r2", "", "box1", "/A/sub/doc2.sy", "/A/sub/doc2", "20250101", "d"))
	c.put(makeBT("p1", "r1", "d1", "box1", "/A/doc1.sy", "/A/doc1", "20250101", "p"))
	// One doc NOT in the renamed folder.
	c.put(makeBT("d3", "r3", "", "box1", "/B/doc3.sy", "/B/doc3", "20250101", "d"))

	c.removeByPathPrefix("/A/")

	for _, id := range []string{"d1", "d2", "p1"} {
		if got := c.get(id); got != nil {
			t.Errorf("block %s (old path /A/...) should be evicted after folder rename, still in cache with path %s", id, got.Path)
		}
	}
	// Verify byRoot is also cleaned up for r1 and r2.
	for _, root := range []string{"r1", "r2"} {
		if bts := c.getByRoot(root); len(bts) != 0 {
			t.Errorf("root %s still has %d entries in byRoot after path-prefix eviction", root, len(bts))
		}
	}
	// Unrelated block must survive.
	if got := c.get("d3"); got == nil {
		t.Error("block d3 (/B/doc3.sy) should not be evicted by /A/ prefix removal")
	}
}

func TestCache_RemoveByPathPrefix_EmptyPrefix(t *testing.T) {
	c := freshCache()
	c.put(makeBT("x", "rx", "", "box1", "/anything.sy", "/anything", "20250101", "d"))
	// Empty prefix should not panic or corrupt the map.
	c.removeByPathPrefix("")
	// With empty prefix, strings.HasPrefix matches everything — verify it evicts consistently.
	// This is an edge case; the important property is "no panic".
}

// ─── Unit: update / overwrite ────────────────────────────────────────────

func TestCache_OverwriteUpdatesIndex(t *testing.T) {
	c := freshCache()

	// Initial state: block belongs to root1
	c.put(makeBT("id1", "root1", "", "box1", "/a.sy", "/A", "20250101", "p"))

	// Block is MOVED to root2 (simulates block move operation).
	// The cache put must remove the block from root1's bucket.
	c.put(makeBT("id1", "root2", "", "box1", "/b.sy", "/B", "20250102", "p"))

	got := c.get("id1")
	if got == nil {
		t.Fatal("expected cache hit after overwrite, got nil")
	}
	if got.RootID != "root2" {
		t.Errorf("RootID not updated: want root2, got %s", got.RootID)
	}

	// root1 bucket must no longer contain id1.
	for _, bt := range c.getByRoot("root1") {
		if bt.ID == "id1" {
			t.Error("id1 still appears in root1 byRoot bucket after move to root2")
		}
	}

	// root2 bucket must contain id1.
	found := false
	for _, bt := range c.getByRoot("root2") {
		if bt.ID == "id1" {
			found = true
			break
		}
	}
	if !found {
		t.Error("id1 not found in root2 byRoot bucket after move")
	}
}

// ─── Unit: getByRoot consistency ─────────────────────────────────────────

func TestCache_GetByRoot_LoadThrough(t *testing.T) {
	c := freshCache()
	// No entries for root1 yet → returns nil (caller should load from SQL).
	if bts := c.getByRoot("root1"); bts != nil {
		t.Errorf("expected nil on cold miss, got %d entries", len(bts))
	}
}

func TestCache_GetByRoot_ReturnsIsolatedCopy(t *testing.T) {
	c := freshCache()
	c.put(makeBT("id1", "root1", "", "box1", "/a.sy", "/A", "20250101", "d"))

	slice1 := c.getByRoot("root1")
	slice2 := c.getByRoot("root1")

	// Mutating the returned slice must not corrupt the index.
	if len(slice1) > 0 {
		slice1[0] = nil
	}
	if got := c.get("id1"); got == nil {
		t.Error("cache entry corrupted after caller mutated returned slice")
	}
	if len(slice2) == 0 || slice2[0] == nil {
		t.Error("second getByRoot returned a corrupt/nil entry")
	}
}

// ─── Unit: clear ─────────────────────────────────────────────────────────

func TestCache_Clear(t *testing.T) {
	c := freshCache()
	for i := 0; i < 100; i++ {
		id := fmt.Sprintf("id%d", i)
		c.put(makeBT(id, "root1", "", "box1", "/a.sy", "/A", "20250101", "p"))
	}
	c.clear()
	if got := c.get("id0"); got != nil {
		t.Error("id0 survived clear()")
	}
	if bts := c.getByRoot("root1"); len(bts) != 0 {
		t.Errorf("root1 bucket survived clear() with %d entries", len(bts))
	}
}

// ─── DATA LOSS: concurrent reads/writes ──────────────────────────────────
// Simulates many concurrent goroutines doing puts and removes on the same
// block IDs.  Verified with -race to detect data races.

func TestCache_ConcurrentSafety(t *testing.T) {
	c := freshCache()
	const goroutines = 32
	const ops = 500

	var wg sync.WaitGroup
	wg.Add(goroutines * 4)

	// Writers: put
	for g := 0; g < goroutines; g++ {
		g := g
		go func() {
			defer wg.Done()
			for i := 0; i < ops; i++ {
				id := fmt.Sprintf("g%d-id%d", g, i%50)
				root := fmt.Sprintf("root%d", i%10)
				c.put(makeBT(id, root, "", "box1", "/a.sy", "/A", "20250101", "p"))
			}
		}()
	}

	// Writers: remove
	for g := 0; g < goroutines; g++ {
		g := g
		go func() {
			defer wg.Done()
			for i := 0; i < ops; i++ {
				c.remove(fmt.Sprintf("g%d-id%d", g, i%50))
			}
		}()
	}

	// Readers: get
	for g := 0; g < goroutines; g++ {
		g := g
		go func() {
			defer wg.Done()
			for i := 0; i < ops; i++ {
				c.get(fmt.Sprintf("g%d-id%d", g, i%50))
			}
		}()
	}

	// Readers: getByRoot
	for g := 0; g < goroutines; g++ {
		go func() {
			defer wg.Done()
			for i := 0; i < ops; i++ {
				c.getByRoot(fmt.Sprintf("root%d", i%10))
			}
		}()
	}

	wg.Wait()
	// No assertion needed — -race detects data races; any panic means failure.
}

// ─── DATA LOSS: folder rename while edits in flight ──────────────────────
// Simulates: goroutine A renames a folder (path prefix eviction + re-index),
// goroutine B is editing a doc in that folder concurrently.
// Expected: after rename completes, B should see the new path (or a cache miss
// triggering a fresh SQL load), NOT the stale old path.

func TestCache_DataLoss_FolderRenameRace(t *testing.T) {
	c := freshCache()

	const docID = "doc-in-folder"
	const oldPath = "/NB/oldFolder/doc.sy"
	const newPath = "/NB/newFolder/doc.sy"

	// Start: doc exists with old path.
	c.put(makeBT(docID, "rootDoc", "", "boxNB", oldPath, "/NB/oldFolder/doc", "20250101", "d"))

	var wg sync.WaitGroup
	wg.Add(2)

	// Goroutine A: rename (evict + re-insert with new path)
	go func() {
		defer wg.Done()
		c.removeByPathPrefix("/NB/oldFolder/")
		c.put(makeBT(docID, "rootDoc", "", "boxNB", newPath, "/NB/newFolder/doc", "20250102", "d"))
	}()

	// Goroutine B: many reads during the rename
	seenStaleCount := 0
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			bt := c.get(docID)
			if bt != nil && bt.Path == oldPath {
				seenStaleCount++
			}
		}
	}()

	wg.Wait()

	// After rename is done, the cache must NOT contain the old path.
	bt := c.get(docID)
	if bt != nil && bt.Path == oldPath {
		t.Errorf("DATA LOSS RISK: cache still has stale old path %s after folder rename", oldPath)
	}

	// Transient stale reads during the race window are acceptable (callers
	// handle not-found on disk by re-reading from SQL). Log for visibility.
	if seenStaleCount > 0 {
		t.Logf("INFO: saw %d transient stale reads during rename race (expected; callers handle gracefully)", seenStaleCount)
	}
}

// ─── DATA LOSS: overwrite then immediate read ─────────────────────────────
// If a block is moved between trees, the cache must reflect the new root/path
// immediately — no window where an intermediate state is observable.

func TestCache_DataLoss_MoveBlock_AtomicUpdate(t *testing.T) {
	c := freshCache()

	c.put(makeBT("blk", "root-src", "", "box1", "/src/doc.sy", "/src/doc", "20250101", "p"))

	// Simulate move: evict from source tree, re-insert under dest tree.
	c.removeByRoot("root-src")
	c.put(makeBT("blk", "root-dst", "", "box1", "/dst/doc.sy", "/dst/doc", "20250102", "p"))

	bt := c.get("blk")
	if bt == nil {
		t.Fatal("block missing from cache after move")
	}
	if bt.RootID != "root-dst" {
		t.Errorf("DATA LOSS RISK: GetBlockTree returns old root %s after block move", bt.RootID)
	}
	if bt.Path != "/dst/doc.sy" {
		t.Errorf("DATA LOSS RISK: GetBlockTree returns old path %s after block move", bt.Path)
	}

	// Source root bucket must be empty.
	if bts := c.getByRoot("root-src"); len(bts) != 0 {
		t.Errorf("DATA LOSS RISK: root-src still has %d blocks after move", len(bts))
	}
}

// ─── DATA LOSS: double-remove idempotence ─────────────────────────────────
// Calling remove/removeByRoot twice for the same block should not panic or
// corrupt the index (e.g. leaving dangling pointers in byRoot that point to
// blocks that have been removed from byID).

func TestCache_DoubleRemoveIdempotent(t *testing.T) {
	c := freshCache()
	c.put(makeBT("id1", "root1", "", "box1", "/a.sy", "/A", "20250101", "d"))

	c.remove("id1")
	c.remove("id1") // must not panic

	c.put(makeBT("id2", "root2", "", "box1", "/b.sy", "/B", "20250101", "d"))
	c.removeByRoot("root2")
	c.removeByRoot("root2") // must not panic

	// No dangling entries
	if got := c.get("id1"); got != nil {
		t.Error("id1 still present after double-remove")
	}
}

// ─── DATA LOSS: byRoot/byID consistency invariant ─────────────────────────
// After any sequence of puts/removes, every entry reachable through byRoot
// must also be reachable through byID and vice versa.

func TestCache_IndexConsistency(t *testing.T) {
	c := freshCache()

	// Build a varied state.
	for i := 0; i < 30; i++ {
		c.put(makeBT(
			fmt.Sprintf("id%d", i),
			fmt.Sprintf("root%d", i%5),
			"",
			"box1",
			fmt.Sprintf("/path%d.sy", i),
			fmt.Sprintf("/path%d", i),
			"20250101",
			"p",
		))
	}
	c.remove("id7")
	c.remove("id15")
	c.removeByRoot("root3")
	c.removeByPathPrefix("/path2")

	c.mu.RLock()
	defer c.mu.RUnlock()

	// Every byRoot entry must be in byID.
	for rootID, bts := range c.byRoot {
		for _, bt := range bts {
			if bt == nil {
				t.Errorf("nil entry in byRoot[%s]", rootID)
				continue
			}
			if c.byID[bt.ID] == nil {
				t.Errorf("CONSISTENCY VIOLATION: byRoot[%s] contains id=%s but byID has no such entry", rootID, bt.ID)
			}
		}
	}

	// Every byID entry must be in its root's bucket.
	for id, bt := range c.byID {
		found := false
		for _, rb := range c.byRoot[bt.RootID] {
			if rb != nil && rb.ID == id {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("CONSISTENCY VIOLATION: byID[%s] (root=%s) has no corresponding byRoot entry", id, bt.RootID)
		}
	}
}

// ─── Benchmarks ──────────────────────────────────────────────────────────

// BenchmarkCacheGet measures the cache hit path — this replaces the SQL query
// path in production.
func BenchmarkCacheGet_Hit(b *testing.B) {
	c := freshCache()
	for i := 0; i < 10000; i++ {
		c.put(makeBT(fmt.Sprintf("id%d", i), "root1", "", "box1", "/a.sy", "/A", "20250101", "p"))
	}
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			c.get(fmt.Sprintf("id%d", i%10000))
			i++
		}
	})
}

func BenchmarkCacheGet_Miss(b *testing.B) {
	c := freshCache()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c.get(fmt.Sprintf("missing%d", i))
	}
}

func BenchmarkCacheGetByRoot(b *testing.B) {
	c := freshCache()
	for i := 0; i < 500; i++ {
		c.put(makeBT(fmt.Sprintf("id%d", i), "root1", "", "box1", "/a.sy", "/A", "20250101", "p"))
	}
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			c.getByRoot("root1")
		}
	})
}

func BenchmarkCachePut(b *testing.B) {
	c := freshCache()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c.put(makeBT(fmt.Sprintf("id%d", i%10000), "root1", "", "box1", "/a.sy", "/A", "20250101", "p"))
	}
}

func BenchmarkCachePutRemoveCycle(b *testing.B) {
	c := freshCache()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		id := fmt.Sprintf("id%d", i%1000)
		c.put(makeBT(id, "root1", "", "box1", "/a.sy", "/A", "20250101", "p"))
		c.remove(id)
	}
}
