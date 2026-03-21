// blocktree_fix_test.go – unit tests for removeBlockTreesByPath and
// ClearRedundantBlockTrees.  These functions touch both the global btCache
// and the SQLite DB, so a real in-memory SQLite is required.
//
// A TestMain initialises the package-level db so all tests in the treenode
// package share one in-memory database without needing a real workspace path.
// The freshCache() helper used by blocktree_cache_test.go creates isolated
// btCacheStore instances that never touch the package-level db, so the cache
// unit tests are completely unaffected by this setup.
//
//	go test ./treenode/ -run=TestFix -v -count=1 -race
//	go test ./treenode/ -v -count=1 -race          # all treenode tests
package treenode

import (
	"database/sql"
	"fmt"
	"os"
	"testing"

	"github.com/mattn/go-sqlite3"
)

// TestMain provides a shared in-memory SQLite for the entire test binary.
func TestMain(m *testing.M) {
	// Register the driver name that blocktree.go uses at runtime.  In
	// production, sql/database.go does this with a custom regexp function;
	// a plain driver is sufficient for correctness testing here.
	func() {
		defer func() { recover() }() // silently ignore "already registered" panic
		sql.Register("sqlite3_extended", &sqlite3.SQLiteDriver{})
	}()

	var err error
	db, err = sql.Open("sqlite3_extended", "file::memory:?cache=shared&mode=memory")
	if err != nil {
		panic("open in-memory sqlite3: " + err.Error())
	}
	// Serialise on the shared in-memory DB; WAL doesn't apply to in-memory.
	db.SetMaxOpenConns(1)

	for _, stmt := range []string{
		`CREATE TABLE blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type)`,
		`CREATE INDEX idx_blocktrees_id ON blocktrees(id)`,
		`CREATE INDEX idx_blocktrees_root_id ON blocktrees(root_id)`,
	} {
		if _, err = db.Exec(stmt); err != nil {
			panic("create schema: " + err.Error())
		}
	}

	code := m.Run()
	db.Close()
	os.Exit(code)
}

// ─── test helpers ─────────────────────────────────────────────────────────────

// insertBTRow writes one BlockTree row into both the DB and the global
// btCache, mimicking what execInsertBlocktrees does during normal editing.
func insertBTRow(t *testing.T, bt *BlockTree) {
	t.Helper()
	_, err := db.Exec(
		`INSERT INTO blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		bt.ID, bt.RootID, bt.ParentID, bt.BoxID, bt.Path, bt.HPath, bt.Updated, bt.Type,
	)
	if err != nil {
		t.Fatalf("insertBTRow(%s): %v", bt.ID, err)
	}
	btCache.put(bt)
}

// dbCount returns the number of rows in blocktrees matching a WHERE clause.
func dbCount(t *testing.T, where string, args ...interface{}) int {
	t.Helper()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM blocktrees WHERE "+where, args...).Scan(&n); err != nil {
		t.Fatalf("dbCount(%q): %v", where, err)
	}
	return n
}

// wipeAll truncates the blocktrees table and resets the global btCache so
// each test starts from a known-empty state.
func wipeAll(t *testing.T) {
	t.Helper()
	if _, err := db.Exec("DELETE FROM blocktrees"); err != nil {
		t.Fatalf("wipeAll: %v", err)
	}
	btCache.clear()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// TestFix_RemoveBlockTreesByPath_EvictsCacheAndDB is the "repair path" scenario
// (scenario 4 from the manual test plan).
//
// When FixBlockTree discovers a .sy file that no longer exists on disk it calls
// removeBlockTreesByPath.  BOTH the in-memory cache AND the SQLite rows must be
// cleaned up so that subsequent GetBlockTree calls cannot return phantom entries
// pointing at a deleted file — which would cause LoadTree to fail and corrupt
// in-flight transactions.
func TestFix_RemoveBlockTreesByPath_EvictsCacheAndDB(t *testing.T) {
	wipeAll(t)

	target := []*BlockTree{
		makeBT("fx-d1", "fx-r1", "",      "boxFix", "/orphan.sy", "/Orphan", "20260101", "d"),
		makeBT("fx-p1", "fx-r1", "fx-d1", "boxFix", "/orphan.sy", "/Orphan", "20260101", "p"),
		makeBT("fx-p2", "fx-r1", "fx-d1", "boxFix", "/orphan.sy", "/Orphan", "20260101", "p"),
	}
	survivor := makeBT("fx-s1", "fx-r2", "", "boxFix", "/alive.sy", "/Alive", "20260101", "d")

	for _, bt := range target {
		insertBTRow(t, bt)
	}
	insertBTRow(t, survivor)

	// Pre-conditions.
	if n := dbCount(t, "box_id=? AND path=?", "boxFix", "/orphan.sy"); n != 3 {
		t.Fatalf("pre: want 3 DB rows for /orphan.sy, got %d", n)
	}
	for _, bt := range target {
		if btCache.get(bt.ID) == nil {
			t.Fatalf("pre: block %s not in cache", bt.ID)
		}
	}

	// Act: repair function evicts the path.
	removeBlockTreesByPath("boxFix", "/orphan.sy")

	// Cache must be fully evicted for all 3 orphan IDs.
	for _, bt := range target {
		if got := btCache.get(bt.ID); got != nil {
			t.Errorf("cache still has block %s after removeBlockTreesByPath", bt.ID)
		}
	}
	if bts := btCache.getByRoot("fx-r1"); len(bts) != 0 {
		t.Errorf("byRoot[fx-r1] still has %d entries after eviction", len(bts))
	}

	// DB must have zero rows for the orphaned path.
	if n := dbCount(t, "box_id=? AND path=?", "boxFix", "/orphan.sy"); n != 0 {
		t.Errorf("DB still has %d rows for /orphan.sy after removeBlockTreesByPath", n)
	}

	// The survivor block in a different path must be completely untouched.
	if btCache.get("fx-s1") == nil {
		t.Error("survivor fx-s1 incorrectly evicted from cache")
	}
	if n := dbCount(t, "id=?", "fx-s1"); n != 1 {
		t.Errorf("survivor fx-s1 gone from DB (want 1, got %d)", n)
	}
}

// TestFix_ClearRedundantBlockTrees_PurgesOrphanedPath verifies the exported
// entry point that FixBlockTree calls.
// "Redundant" = rows in the DB whose path has no corresponding .sy file on disk.
func TestFix_ClearRedundantBlockTrees_PurgesOrphanedPath(t *testing.T) {
	wipeAll(t)

	// Three paths that exist on disk.
	existing := []string{"/a.sy", "/b.sy", "/c.sy"}
	for i, p := range existing {
		id := fmt.Sprintf("bt-ex%d", i)
		insertBTRow(t, makeBT(id, id+"r", "", "box1", p, p, "20260101", "d"))
	}

	// Two orphaned rows (path exists in DB but no longer on disk).
	insertBTRow(t, makeBT("bt-orp1", "bt-orp-r", "",        "box1", "/orphan.sy", "/Orphan", "20260101", "d"))
	insertBTRow(t, makeBT("bt-orp2", "bt-orp-r", "bt-orp1", "box1", "/orphan.sy", "/Orphan", "20260101", "p"))

	// Act: fixer is told only the 3 on-disk paths.
	ClearRedundantBlockTrees("box1", existing)

	// Orphans must be gone from cache and DB.
	for _, id := range []string{"bt-orp1", "bt-orp2"} {
		if btCache.get(id) != nil {
			t.Errorf("orphan %s still in cache after ClearRedundantBlockTrees", id)
		}
	}
	if n := dbCount(t, "box_id=? AND path=?", "box1", "/orphan.sy"); n != 0 {
		t.Errorf("DB still has %d orphan rows after ClearRedundantBlockTrees", n)
	}

	// Existing paths must be untouched in the DB.
	for i, p := range existing {
		id := fmt.Sprintf("bt-ex%d", i)
		if n := dbCount(t, "id=?", id); n != 1 {
			t.Errorf("existing block %s (path %s) incorrectly removed from DB (got %d)", id, p, n)
		}
	}
}

// TestFix_RemoveBlockTreesByPath_Idempotent verifies that calling
// removeBlockTreesByPath on a non-existent path is safe.
func TestFix_RemoveBlockTreesByPath_Idempotent(t *testing.T) {
	wipeAll(t)
	insertBTRow(t, makeBT("safe1", "safeRoot", "", "safeBox", "/real.sy", "/real", "20260101", "d"))

	// Neither call must panic or affect unrelated blocks.
	removeBlockTreesByPath("safeBox", "/nonexistent.sy")
	removeBlockTreesByPath("safeBox", "/nonexistent.sy")

	if btCache.get("safe1") == nil {
		t.Error("unrelated block safe1 incorrectly evicted from cache")
	}
	if n := dbCount(t, "id=?", "safe1"); n != 1 {
		t.Errorf("unrelated block safe1 gone from DB (want 1, got %d)", n)
	}
}

// TestFix_RemoveBlockTreesByPath_PartialEviction verifies that removing one
// path within a box does not touch blocks belonging to a different path in the
// same box.
func TestFix_RemoveBlockTreesByPath_PartialEviction(t *testing.T) {
	wipeAll(t)

	toRemove := []*BlockTree{
		makeBT("mp-a1", "mp-ra", "",      "boxMP", "/a.sy", "/A", "20260101", "d"),
		makeBT("mp-a2", "mp-ra", "mp-a1", "boxMP", "/a.sy", "/A", "20260101", "p"),
	}
	toKeep := []*BlockTree{
		makeBT("mp-b1", "mp-rb", "",      "boxMP", "/b.sy", "/B", "20260101", "d"),
		makeBT("mp-b2", "mp-rb", "mp-b1", "boxMP", "/b.sy", "/B", "20260101", "p"),
	}
	for _, bt := range append(toRemove, toKeep...) {
		insertBTRow(t, bt)
	}

	removeBlockTreesByPath("boxMP", "/a.sy")

	for _, bt := range toRemove {
		if btCache.get(bt.ID) != nil {
			t.Errorf("block %s (path /a.sy) still in cache", bt.ID)
		}
		if n := dbCount(t, "id=?", bt.ID); n != 0 {
			t.Errorf("block %s (path /a.sy) still in DB", bt.ID)
		}
	}
	for _, bt := range toKeep {
		if btCache.get(bt.ID) == nil {
			t.Errorf("block %s (path /b.sy) incorrectly evicted from cache", bt.ID)
		}
		if n := dbCount(t, "id=?", bt.ID); n != 1 {
			t.Errorf("block %s (path /b.sy) incorrectly deleted from DB", bt.ID)
		}
	}
}

// TestFix_ClearRedundant_AllPathsRedundant verifies behaviour when every row
// in the DB for a box is orphaned (e.g. notebook re-created with new docs).
func TestFix_ClearRedundant_AllPathsRedundant(t *testing.T) {
	wipeAll(t)

	for i := 0; i < 5; i++ {
		id := fmt.Sprintf("all-orp%d", i)
		insertBTRow(t, makeBT(id, id+"r", "", "boxAll", fmt.Sprintf("/old%d.sy", i), "/old", "20260101", "d"))
	}

	// Fixer says NO paths exist on disk for this box.
	ClearRedundantBlockTrees("boxAll", []string{})

	if n := dbCount(t, "box_id=?", "boxAll"); n != 0 {
		t.Errorf("DB still has %d rows after clearing all-redundant box (want 0)", n)
	}
	for i := 0; i < 5; i++ {
		id := fmt.Sprintf("all-orp%d", i)
		if btCache.get(id) != nil {
			t.Errorf("block %s still in cache after all-redundant clear", id)
		}
	}
}
