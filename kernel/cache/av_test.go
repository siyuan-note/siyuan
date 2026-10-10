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
	"bytes"
	"testing"

	"github.com/dgraph-io/ristretto"
)

func TestAVSearchDataInvalidation(t *testing.T) {
	const avID = "20260728120000-search"
	const boxID = "20260728120000-box"

	version := SetAVDataWithVersionInBox(avID, boxID, []byte(`{"name":"old"}`))
	if !SetAVSearchDataInBox(avID, boxID, version, "cached") {
		t.Fatal("failed to cache search data")
	}
	if cached, ok := GetAVSearchDataInBox[string](avID, boxID); !ok || cached != "cached" {
		t.Fatalf("unexpected cached search data: %q, %v", cached, ok)
	}

	newVersion := SetAVDataWithVersionInBox(avID, boxID, []byte(`{"name":"new"}`))
	if _, ok := GetAVSearchDataInBox[string](avID, boxID); ok {
		t.Fatal("setting AV data should invalidate search data")
	}
	if SetAVSearchDataInBox(avID, boxID, version, "stale") {
		t.Fatal("stale search data should not be cached")
	}
	if _, ok := GetAVSearchDataInBox[string](avID, boxID); ok {
		t.Fatal("stale search data should remain invalid")
	}

	if !SetAVSearchDataInBox(avID, boxID, newVersion, "cached") {
		t.Fatal("failed to cache current search data")
	}
	RemoveAVDataInBox(avID, boxID)
	if _, ok := GetAVSearchDataInBox[string](avID, boxID); ok {
		t.Fatal("removing AV data should invalidate search data")
	}
}

func TestAVNormalizedDataSharesVersionAndNotebookBoundary(t *testing.T) {
	const id = "normalized-cache-test"
	defer RemoveAVData(id)
	raw, normalized := []byte("original"), []byte("normalized")
	version := SetAVDataWithVersionInBox(id, "a", raw)
	other := SetAVDataWithVersionInBox(id, "b", []byte("other"))
	if !SetAVNormalizedDataInBox(id, "a", version, raw, normalized) {
		t.Fatal("normalized data was not admitted")
	}
	avCache.Wait()
	if got, ok := GetAVNormalizedDataInBox(id, "a", version); !ok || !bytes.Equal(got, normalized) {
		t.Fatal("normalized data was not available")
	}
	if got, ok := GetAVDataInBox(id, "a"); !ok || !bytes.Equal(got, raw) {
		t.Fatal("normalization changed the source cache")
	}
	if _, ok := GetAVNormalizedDataInBox(id, "b", other); ok {
		t.Fatal("normalized plaintext crossed notebooks")
	}
	RemoveAVDataInBox(id, "a")
	if _, ok := GetAVNormalizedDataInBox(id, "a", version); ok {
		t.Fatal("removed source retained normalized data")
	}
	if SetAVNormalizedDataInBox(id, "a", version, raw, normalized) {
		t.Fatal("stale normalization was admitted after invalidation")
	}
	if got, ok := GetAVDataInBox(id, "b"); !ok || string(got) != "other" {
		t.Fatal("removal crossed notebook boundaries")
	}
}

func TestAVNormalizedDataRespectsCacheBudget(t *testing.T) {
	const id = "normalization-budget-test"
	previous := avCache.MaxCost()
	avCache.UpdateMaxCost(1024)
	defer func() { RemoveAVData(id); avCache.UpdateMaxCost(previous) }()
	raw := []byte("small source")
	version := SetAVDataWithVersionInBox(id, "", raw)
	avCache.Wait()
	if SetAVNormalizedDataInBox(id, "", version, raw, bytes.Repeat([]byte("x"), 2048)) {
		t.Fatal("oversize derived data exceeded cache budget")
	}
	if cached, ok := GetAVDataInBox(id, ""); !ok || !bytes.Equal(cached, raw) {
		t.Fatal("rejected normalization removed the source cache")
	}
}

func TestAVSearchDataWithoutRawData(t *testing.T) {
	const avID = "20260801120000-search"
	const boxID = "20260801120000-box"

	version := EnsureAVDataVersionInBox(avID, boxID)
	if version == 0 || EnsureAVDataVersionInBox(avID, boxID) != version {
		t.Fatalf("unexpected AV data version: %d", version)
	}
	if !SetAVSearchDataInBox(avID, boxID, version, "cached") {
		t.Fatal("failed to cache search data without raw data")
	}
	if _, ok := GetAVDataInBox(avID, boxID); ok {
		t.Fatal("caching search data should not cache raw data")
	}

	newVersion := SetAVDataWithVersionInBox(avID, boxID, []byte(`{"name":"new"}`))
	if newVersion == version {
		t.Fatal("setting raw data should advance the data version")
	}
	if _, ok := GetAVSearchDataInBox[string](avID, boxID); ok {
		t.Fatal("setting raw data should invalidate standalone search data")
	}
}

func TestAVCacheGeneration(t *testing.T) {
	generation := GetAVCacheGeneration()
	ClearAVCache()
	if current := GetAVCacheGeneration(); current != generation+1 {
		t.Fatalf("unexpected AV cache generation: %d", current)
	}
}

func TestAVCacheRejectsStaleAsyncAdmission(t *testing.T) {
	original := avCache
	entered, release := make(chan struct{}), make(chan struct{})
	controlled, err := ristretto.NewCache(&ristretto.Config{
		NumCounters: 100, MaxCost: 1 << 20, BufferItems: 64,
		Cost: func(value interface{}) int64 {
			close(entered)
			<-release
			return 1
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	avCache = controlled
	t.Cleanup(func() {
		ClearAVCache()
		controlled.Close()
		avCache = original
	})
	// 暂停准入线程，让同一数据库的两次写入都在首次缓存建立前入队。
	SetAVDataInBox("blocker", "box", []byte{})
	<-entered
	SetAVDataInBox("database", "box", []byte("old"))
	latestVersion := SetAVDataWithVersionInBox("database", "box", []byte("latest"))
	close(release)
	controlled.Wait()
	if raw, version, ok := GetAVDataWithVersionInBox("database", "box"); ok && (!bytes.Equal(raw, []byte("latest")) || version != latestVersion) {
		t.Fatalf("returned stale database after a newer write: %q", raw)
	}
	// 未命中后重新读取源文件，可以恢复当前版本的缓存。
	latestVersion = SetAVDataWithVersionInBox("database", "box", []byte("latest"))
	controlled.Wait()
	if raw, version, ok := GetAVDataWithVersionInBox("database", "box"); !ok || !bytes.Equal(raw, []byte("latest")) || version != latestVersion {
		t.Fatalf("latest database was not cached: %q, %v", raw, ok)
	}
}

func TestAVCacheRemovalKeepsNotebookIsolation(t *testing.T) {
	t.Cleanup(ClearAVCache)
	for _, box := range []string{"", "plain", "encrypted"} {
		SetAVDataInBox("database", box, []byte(box+" content"))
	}
	avCache.Wait()
	RemoveAVDataInBox("database", "encrypted")
	if _, ok := GetAVDataInBox("database", "encrypted"); ok {
		t.Fatal("removed notebook cache remained readable")
	}
	if raw, ok := GetAVDataInBox("database", "plain"); !ok || string(raw) != "plain content" {
		t.Fatal("removing another notebook changed the plain cache")
	}
	RemoveAVData("database")
	for _, box := range []string{"", "plain", "encrypted"} {
		if _, ok := GetAVDataInBox("database", box); ok {
			t.Fatalf("database cache remained readable in notebook %q", box)
		}
	}
}
