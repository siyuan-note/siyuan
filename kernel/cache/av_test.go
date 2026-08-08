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

import "testing"

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
