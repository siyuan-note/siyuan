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

package model

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestMatchAttributeViewSearchName(t *testing.T) {
	tests := []struct {
		name     string
		keywords []string
		hit      bool
	}{
		{name: "Schedule", keywords: []string{"schedule"}, hit: true},
		{name: "状态：进行", keywords: []string{"状态", "进行"}, hit: true},
		{name: "状态：进行", keywords: []string{"状态", "结束"}, hit: false},
		{name: "Database View", keywords: []string{"DATA", "view"}, hit: true},
		{name: "", keywords: []string{"view"}, hit: false},
		{name: "View", keywords: nil, hit: false},
	}

	for _, test := range tests {
		score, hit := matchAttributeViewSearchName(test.name, test.keywords)
		if hit != test.hit {
			t.Fatalf("unexpected match result for %q and %v: %v", test.name, test.keywords, hit)
		}
		if hit && score <= 0 {
			t.Fatalf("expected positive score for %q and %v", test.name, test.keywords)
		}
	}
}

func TestSortAndLimitAttributeViewSearchResults(t *testing.T) {
	var results []*AvSearchTempResult
	for i := 0; i < 15; i++ {
		results = append(results, &AvSearchTempResult{AvID: string(rune('a' + i)), AvUpdated: int64(i)})
	}

	results = sortAndLimitAttributeViewSearchResults(results, "")
	if len(results) != 12 {
		t.Fatalf("expected 12 results, got %d", len(results))
	}
	if results[0].AvUpdated != 14 || results[11].AvUpdated != 3 {
		t.Fatalf("unexpected result order: first=%d, last=%d", results[0].AvUpdated, results[11].AvUpdated)
	}

	results = []*AvSearchTempResult{
		{AvID: "first", AvUpdated: 3, Score: 1},
		{AvID: "second", AvUpdated: 1, Score: 2},
		{AvID: "third", AvUpdated: 5, Score: 1},
	}
	results = sortAndLimitAttributeViewSearchResults(results, "keyword")
	if results[0].AvID != "second" || results[1].AvID != "third" || results[2].AvID != "first" {
		t.Fatalf("unexpected keyword result order: %s, %s, %s", results[0].AvID, results[1].AvID, results[2].AvID)
	}
}

func TestAttributeViewSearchCacheWarmup(t *testing.T) {
	resetAttributeViewSearchCacheWarmups()
	defer resetAttributeViewSearchCacheWarmups()

	originalDelay := attributeViewSearchCacheWarmupDelay
	originalLoader := loadAttributeViewSearchInfo
	attributeViewSearchCacheWarmupDelay = 10 * time.Millisecond
	defer func() {
		attributeViewSearchCacheWarmupDelay = originalDelay
		loadAttributeViewSearchInfo = originalLoader
	}()

	var count atomic.Int32
	loaded := make(chan struct{}, 8)
	loadAttributeViewSearchInfo = func(_, _ string) (*av.AttributeViewSearchInfo, error) {
		count.Add(1)
		loaded <- struct{}{}
		return &av.AttributeViewSearchInfo{}, nil
	}

	const boxID = "20260801120000-box"
	ids := []string{"20260801120000-first", "20260801120001-second"}
	warmAttributeViewSearchCache(boxID, ids, 1)
	waitAttributeViewSearchCacheLoads(t, loaded, len(ids))
	waitAttributeViewSearchCacheWarmupComplete(t, boxID)

	warmAttributeViewSearchCache(boxID, ids, 1)
	select {
	case <-loaded:
		t.Fatal("completed warmup should not run again for the same signature")
	case <-time.After(30 * time.Millisecond):
	}

	warmAttributeViewSearchCache(boxID, ids, 2)
	waitAttributeViewSearchCacheLoads(t, loaded, len(ids))
	waitAttributeViewSearchCacheWarmupComplete(t, boxID)
	if count.Load() != 4 {
		t.Fatalf("unexpected load count: %d", count.Load())
	}

	warmAttributeViewSearchCache(boxID, ids, 3)
	stopAttributeViewSearchCacheWarmup(boxID)
	select {
	case <-loaded:
		t.Fatal("stopped warmup should not load search info")
	case <-time.After(30 * time.Millisecond):
	}
}

func resetAttributeViewSearchCacheWarmups() {
	attributeViewSearchCacheWarmups.Lock()
	defer attributeViewSearchCacheWarmups.Unlock()
	for _, state := range attributeViewSearchCacheWarmups.states {
		if state.cancel != nil {
			state.cancel()
		}
	}
	attributeViewSearchCacheWarmups.states = map[string]*attributeViewSearchCacheWarmup{}
}

func waitAttributeViewSearchCacheLoads(t *testing.T, loaded <-chan struct{}, expected int) {
	t.Helper()
	for i := 0; i < expected; i++ {
		select {
		case <-loaded:
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for warmup load %d", i+1)
		}
	}
}

func waitAttributeViewSearchCacheWarmupComplete(t *testing.T, boxID string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		attributeViewSearchCacheWarmups.Lock()
		state := attributeViewSearchCacheWarmups.states[boxID]
		completed := state != nil && !state.running
		attributeViewSearchCacheWarmups.Unlock()
		if completed {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("timed out waiting for warmup completion")
}
