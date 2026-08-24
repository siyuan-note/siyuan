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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package sql

import (
	gosql "database/sql"
	"testing"
)

// TestBlockCacheIsolatedByEncryptedBox 验证加密笔记本块不会污染全局缓存，且不同加密笔记本可安全使用相同块 ID。
func TestBlockCacheIsolatedByEncryptedBox(t *testing.T) {
	originalDisabled := cacheDisabled
	originalIsEncryptedBoxFn := IsEncryptedBoxFn
	originalIsBoxUnlockedFn := IsBoxUnlockedFn
	defer func() {
		cacheDisabled = originalDisabled
		IsEncryptedBoxFn = originalIsEncryptedBoxFn
		IsBoxUnlockedFn = originalIsBoxUnlockedFn
		ClearCache()
	}()

	cacheDisabled = false
	IsEncryptedBoxFn = func(boxID string) bool {
		return boxID == "encrypted-a" || boxID == "encrypted-b"
	}
	IsBoxUnlockedFn = func(boxID string) bool {
		return boxID == "encrypted-a" || boxID == "encrypted-b"
	}
	ClearCache()

	putBlockCache(&Block{ID: "shared-id", Box: "encrypted-a", Content: "secret-a"})
	putBlockCache(&Block{ID: "shared-id", Box: "encrypted-b", Content: "secret-b"})
	putBlockCache(&Block{ID: "normal-id", Box: "normal", Content: "normal"})
	blockCache.Wait()

	if block := getBlockCache("shared-id"); block != nil {
		t.Fatalf("global cache must not return encrypted block, got box %q", block.Box)
	}
	if block := getBlockCacheInBox("shared-id", "encrypted-a"); block == nil || block.Content != "secret-a" {
		t.Fatalf("encrypted-a cache miss or cross-box result: %#v", block)
	}
	if block := getBlockCacheInBox("shared-id", "encrypted-b"); block == nil || block.Content != "secret-b" {
		t.Fatalf("encrypted-b cache miss or cross-box result: %#v", block)
	}
	if block := getBlockCache("normal-id"); block == nil || block.Content != "normal" {
		t.Fatalf("normal block cache behavior changed: %#v", block)
	}

	removeBlockCache("shared-id")
	blockCache.Wait()
	if block := getBlockCacheInBox("shared-id", "encrypted-a"); block != nil {
		t.Fatalf("encrypted-a cache entry was not removed: %#v", block)
	}
	if block := getBlockCacheInBox("shared-id", "encrypted-b"); block != nil {
		t.Fatalf("encrypted-b cache entry was not removed: %#v", block)
	}
}

func TestEncryptedBlockCacheUnavailableAfterLock(t *testing.T) {
	originalDisabled := cacheDisabled
	originalIsEncryptedBoxFn := IsEncryptedBoxFn
	originalIsBoxUnlockedFn := IsBoxUnlockedFn
	defer func() {
		cacheDisabled = originalDisabled
		IsEncryptedBoxFn = originalIsEncryptedBoxFn
		IsBoxUnlockedFn = originalIsBoxUnlockedFn
		ClearCache()
	}()

	unlocked := true
	cacheDisabled = false
	IsEncryptedBoxFn = func(boxID string) bool {
		return boxID == "encrypted"
	}
	IsBoxUnlockedFn = func(boxID string) bool {
		return boxID != "encrypted" || unlocked
	}
	ClearCache()

	putBlockCache(&Block{ID: "secret", Box: "encrypted", Content: "plaintext"})
	blockCache.Wait()
	if block := getBlockCacheInBox("secret", "encrypted"); block == nil {
		t.Fatal("expected cache hit while encrypted notebook is unlocked")
	}

	unlocked = false
	if block := getBlockCacheInBox("secret", "encrypted"); block != nil {
		t.Fatalf("locked encrypted notebook returned cached plaintext: %#v", block)
	}
	putBlockCache(&Block{ID: "other", Box: "encrypted", Content: "plaintext"})
	blockCache.Wait()
	if block := getBlockCacheInBox("other", "encrypted"); block != nil {
		t.Fatalf("locked encrypted notebook accepted cached plaintext: %#v", block)
	}
}

func TestNormalRefCacheSharesCryptoBoundary(t *testing.T) {
	originalIsEncryptedBoxFn := IsEncryptedBoxFn
	originalIsBoxUnlockedFn := IsBoxUnlockedFn
	defer func() {
		IsEncryptedBoxFn = originalIsEncryptedBoxFn
		IsBoxUnlockedFn = originalIsBoxUnlockedFn
		ClearCache()
	}()

	IsEncryptedBoxFn = func(string) bool {
		return false
	}
	IsBoxUnlockedFn = func(string) bool {
		return true
	}
	ClearCache()

	const defBlockID = "20260824000000-def0001"
	putRefCache("20260824000001-box0001", &Ref{
		DefBlockID: defBlockID,
		BlockID:    "20260824000002-ref0001",
		Box:        "20260824000001-box0001",
	})
	refs := GetRefsCacheByDefIDInBox(defBlockID, "20260824000001-box0001")
	if 1 != len(refs) {
		t.Fatalf("unexpected initial refs count: got %d, want 1", len(refs))
	}

	putRefCache("20260824000003-box0002", &Ref{
		DefBlockID: defBlockID,
		BlockID:    "20260824000004-ref0002",
		Box:        "20260824000003-box0002",
	})
	refs = GetRefsCacheByDefIDInBox(defBlockID, "20260824000001-box0001")
	if 2 != len(refs) {
		t.Fatalf("cross-notebook ref was not added to the shared cache: got %d refs", len(refs))
	}
}

func TestNormalRefCacheMissQueriesAllNotebooks(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if nil != err {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()
	if _, err = testDB.Exec("CREATE TABLE refs (id TEXT, def_block_id TEXT, def_block_parent_id TEXT, " +
		"def_block_root_id TEXT, def_block_path TEXT, block_id TEXT, root_id TEXT, box TEXT, path TEXT, " +
		"content TEXT, markdown TEXT, type TEXT)"); nil != err {
		t.Fatalf("create refs table failed: %s", err)
	}
	if _, err = testDB.Exec(`INSERT INTO refs VALUES
		('ref-a', 'def', '', '', '', 'block-a', 'root-a', 'normal-a', '/a.sy', '', '', ''),
		('ref-b', 'def', '', '', '', 'block-b', 'root-b', 'normal-b', '/b.sy', '', '', '')`); nil != err {
		t.Fatalf("insert refs failed: %s", err)
	}

	originalDB := db
	originalIsEncryptedBoxFn := IsEncryptedBoxFn
	originalIsBoxUnlockedFn := IsBoxUnlockedFn
	db = testDB
	defer func() {
		db = originalDB
		IsEncryptedBoxFn = originalIsEncryptedBoxFn
		IsBoxUnlockedFn = originalIsBoxUnlockedFn
		ClearCache()
	}()
	IsEncryptedBoxFn = func(string) bool {
		return false
	}
	IsBoxUnlockedFn = func(string) bool {
		return true
	}
	ClearCache()

	refs := GetRefsCacheByDefIDInBox("def", "normal-a")
	if 2 != len(refs) {
		t.Fatalf("cross-notebook refs query returned %d refs, want 2", len(refs))
	}
}

func TestEncryptedRefCacheIsolatedAndUnavailableAfterLock(t *testing.T) {
	originalIsEncryptedBoxFn := IsEncryptedBoxFn
	originalIsBoxUnlockedFn := IsBoxUnlockedFn
	unlocked := true
	defer func() {
		IsEncryptedBoxFn = originalIsEncryptedBoxFn
		IsBoxUnlockedFn = originalIsBoxUnlockedFn
		ClearCache()
	}()

	IsEncryptedBoxFn = func(boxID string) bool {
		return boxID == "encrypted-a" || boxID == "encrypted-b"
	}
	IsBoxUnlockedFn = func(boxID string) bool {
		return !IsEncryptedBoxFn(boxID) || unlocked
	}
	ClearCache()

	const defBlockID = "20260824000005-def0002"
	putRefCache("normal", &Ref{DefBlockID: defBlockID, BlockID: "ref-normal", Box: "normal"})
	putRefCache("encrypted-a", &Ref{DefBlockID: defBlockID, BlockID: "ref-a", Box: "encrypted-a"})
	putRefCache("encrypted-b", &Ref{DefBlockID: defBlockID, BlockID: "ref-b", Box: "encrypted-b"})

	refsA := GetRefsCacheByDefIDInBox(defBlockID, "encrypted-a")
	if 1 != len(refsA) || "encrypted-a" != refsA[0].Box {
		t.Fatalf("encrypted-a cache returned cross-boundary refs: %#v", refsA)
	}
	refsB := GetRefsCacheByDefIDInBox(defBlockID, "encrypted-b")
	if 1 != len(refsB) || "encrypted-b" != refsB[0].Box {
		t.Fatalf("encrypted-b cache returned cross-boundary refs: %#v", refsB)
	}
	if refs := GetRefsCacheByDefID(defBlockID); 1 != len(refs) || "normal" != refs[0].Box {
		t.Fatalf("global cache returned encrypted refs: %#v", refs)
	}

	unlocked = false
	if refs := GetRefsCacheByDefIDInBox(defBlockID, "encrypted-a"); 0 != len(refs) {
		t.Fatalf("locked encrypted cache returned plaintext refs: %#v", refs)
	}
}
