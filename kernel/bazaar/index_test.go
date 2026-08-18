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

package bazaar

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestParseBazaarIndex(t *testing.T) {
	index, err := parseBazaarIndex([]byte(`{
		"meta":{"schema":2,"ratingsAvailable":true,"generation":"42","publishedAt":1786665600},
		"packages":{"sample":{"repo":"owner/repo","downloads":12,"rating":{"average":3,"count":5,"distribution":[1,1,1,1,1]}}},
		"Owner/Repo":{"downloads":12},
		"https://github.com/owner/repo":{"downloads":3}
	}`))
	if nil != err {
		t.Fatal(err)
	}
	stats := bazaarStatsFromIndex(index)
	if 12 != stats["sample"].Downloads || 15 != stats["owner/repo"].Downloads {
		t.Fatalf("unexpected downloads: %+v", stats)
	}
	ratings, available := bazaarRatingsFromIndex(index)
	if !available || nil == ratings["sample"] || 5 != ratings["sample"].Count || 3 != ratings["sample"].Average {
		t.Fatalf("unexpected ratings: available=%v ratings=%+v", available, ratings)
	}
}

func TestParseLegacyBazaarIndex(t *testing.T) {
	index, err := parseBazaarIndex([]byte(`{
		"Akkuman/Repo":{"downloads":7},
		"akkuman/repo":{"downloads":3},
		"https://github.com/AKKUMAN/REPO":{"downloads":5},
		"owner/other":{"downloads":2}
	}`))
	if nil != err {
		t.Fatal(err)
	}
	stats := bazaarStatsFromIndex(index)
	if 15 != stats["akkuman/repo"].Downloads || 2 != stats["owner/other"].Downloads || 2 != len(stats) {
		t.Fatalf("legacy download statistics were not normalized and merged: %+v", stats)
	}
	if _, available := bazaarRatingsFromIndex(index); available {
		t.Fatal("legacy index must not report rating availability")
	}
}

func TestParseFutureBazaarIndexUsesOnlyCompatibleDownloads(t *testing.T) {
	index, err := parseBazaarIndex([]byte(`{
		"meta":{"schema":3,"ratingsAvailable":true,"generation":"future","publishedAt":1786665600},
		"packages":"unknown future structure",
		"https://github.com/Owner/Repo":{"downloads":7}
	}`))
	if nil != err {
		t.Fatal(err)
	}
	stats := bazaarStatsFromIndex(index)
	if 7 != stats["owner/repo"].Downloads || 1 != len(stats) {
		t.Fatalf("future index compatible downloads were not preserved: %+v", stats)
	}
	if 0 != len(index.packages) {
		t.Fatalf("future package structure should not be trusted: %+v", index.packages)
	}
	if _, available := bazaarRatingsFromIndex(index); available || index.meta.RatingsAvailable {
		t.Fatal("future index should not report rating availability")
	}
}

func TestParseBazaarIndexRejectsInvalidData(t *testing.T) {
	for _, data := range [][]byte{
		[]byte(`null`),
		[]byte(`{"meta":{"schema":2}}`),
		[]byte(`{"meta":{"schema":1,"ratingsAvailable":true},"packages":{}}`),
		[]byte(`{"meta":{"schema":2,"ratingsAvailable":true,"generation":" ","publishedAt":1},"packages":{}}`),
		[]byte(`{"meta":{"schema":2,"ratingsAvailable":true,"generation":"1","publishedAt":0},"packages":{}}`),
		[]byte(`{"meta":{"schema":2,"ratingsAvailable":true,"generation":"1","publishedAt":"1"},"packages":{}}`),
		[]byte(`{"meta":{"schema":2,"ratingsAvailable":true,"generation":"1","publishedAt":1},"packages":{"bad/name":{"repo":"owner/repo","downloads":1}}}`),
		[]byte(`{"meta":{"schema":2,"ratingsAvailable":true,"generation":"1","publishedAt":1},"packages":{"sample":{"repo":"owner/repo","downloads":-1}}}`),
		[]byte(`{"meta":{"schema":2,"ratingsAvailable":true,"generation":"1","publishedAt":1},"packages":{"sample":{"repo":"https://github.com/owner/repo","downloads":1}}}`),
		[]byte(`{"meta":{"schema":2,"ratingsAvailable":true,"generation":"1","publishedAt":1},"packages":{"sample":{"repo":"owner/repo","downloads":1,"rating":{"average":5,"count":2,"distribution":[0,0,0,0,1]}}}}`),
		[]byte(`{"owner/repo":{"downloads":-1}}`),
		[]byte(`{"HTTPS://github.com/owner/repo":{"downloads":1}}`),
	} {
		if _, err := parseBazaarIndex(data); nil == err {
			t.Fatalf("expected invalid index to fail: %s", data)
		}
	}
}

func TestParseLegacyBazaarIndexRejectsDownloadOverflow(t *testing.T) {
	maxInt := int(^uint(0) >> 1)
	data := []byte(`{"Owner/Repo":{"downloads":` + strconv.Itoa(maxInt) +
		`},"https://github.com/owner/repo":{"downloads":1}}`)
	if _, err := parseBazaarIndex(data); nil == err {
		t.Fatal("expected merged legacy downloads overflow to fail")
	}
}

func TestFetchBazaarIndexUsesTimeBucket(t *testing.T) {
	resetBazaarIndexTestState(t)
	bazaarIndexNow = func() time.Time { return time.Unix(900, 0) }
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if "/bazaar/index.json" != request.URL.Path || "3" != request.URL.Query().Get("t") {
			t.Fatalf("unexpected index URL: %s", request.URL.String())
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"owner/repo":{"downloads":1}}`))
	}))
	defer server.Close()
	bazaarIndexStatServer = server.URL

	index, err := fetchBazaarIndex(context.Background())
	if nil != err || 1 != index.legacyStats["owner/repo"].Downloads {
		t.Fatalf("unexpected fetched index: index=%+v err=%v", index, err)
	}
}

func TestBazaarIndexStaleWhileRevalidateAndLastGood(t *testing.T) {
	resetBazaarIndexTestState(t)
	now := time.Unix(1000, 0)
	bazaarIndexNow = func() time.Time { return now }
	bazaarIndexCacheTTL = time.Minute
	bazaarIndexRetryDelay = time.Minute

	var calls atomic.Int32
	var fail atomic.Bool
	refreshStarted := make(chan struct{}, 1)
	releaseRefresh := make(chan struct{})
	bazaarIndexFetcher = func(context.Context) (*bazaarIndexSnapshot, error) {
		call := calls.Add(1)
		if fail.Load() {
			return nil, errors.New("offline")
		}
		if 2 == call {
			refreshStarted <- struct{}{}
			<-releaseRefresh
		}
		return testBazaarIndex(int(call), true), nil
	}

	if index := getBazaarIndex(context.Background()); 1 != index.packages["sample"].Downloads {
		t.Fatalf("unexpected initial index: %+v", index)
	}
	now = now.Add(2 * time.Minute)
	if index := getBazaarIndex(context.Background()); 1 != index.packages["sample"].Downloads {
		t.Fatalf("stale request did not return last-good index: %+v", index)
	}
	select {
	case <-refreshStarted:
	case <-time.After(time.Second):
		t.Fatal("stale index did not start a background refresh")
	}
	close(releaseRefresh)
	waitForBazaarIndexDownloads(t, 2)
	waitForBazaarIndexPrefetch(t)

	fail.Store(true)
	now = now.Add(2 * time.Minute)
	if index := getBazaarIndex(context.Background()); 2 != index.packages["sample"].Downloads {
		t.Fatalf("failed refresh did not keep last-good index: %+v", index)
	}
	deadline := time.Now().Add(time.Second)
	for 3 > calls.Load() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if 3 != calls.Load() {
		t.Fatalf("expected one failed refresh, got %d requests", calls.Load())
	}
	_ = getBazaarIndex(context.Background())
	if 3 != calls.Load() {
		t.Fatalf("retry backoff allowed an early request: %d", calls.Load())
	}
	waitForBazaarIndexPrefetch(t)
}

func TestBazaarIndexDeadlinesStartAfterFetch(t *testing.T) {
	resetBazaarIndexTestState(t)
	now := time.Unix(1000, 0)
	bazaarIndexNow = func() time.Time { return now }
	bazaarIndexCacheTTL = 5 * time.Minute
	bazaarIndexRetryDelay = time.Minute
	bazaarIndexFetcher = func(context.Context) (*bazaarIndexSnapshot, error) {
		now = now.Add(30 * time.Second)
		return testBazaarIndex(1, true), nil
	}

	_ = getBazaarIndex(context.Background())
	bazaarIndexState.mu.RLock()
	expiresAt := bazaarIndexState.expiresAt
	bazaarIndexState.mu.RUnlock()
	if want := now.Add(bazaarIndexCacheTTL); !expiresAt.Equal(want) {
		t.Fatalf("index expiry started before the fetch completed: got %v, want %v", expiresAt, want)
	}

	now = time.Unix(2000, 0)
	bazaarIndexState.mu.Lock()
	bazaarIndexState.snapshot = nil
	bazaarIndexState.expiresAt = time.Time{}
	bazaarIndexState.retryAt = time.Time{}
	bazaarIndexState.mu.Unlock()
	bazaarIndexFetcher = func(context.Context) (*bazaarIndexSnapshot, error) {
		now = now.Add(30 * time.Second)
		return nil, errors.New("offline")
	}
	_ = getBazaarIndex(context.Background())
	bazaarIndexState.mu.RLock()
	retryAt := bazaarIndexState.retryAt
	bazaarIndexState.mu.RUnlock()
	if want := now.Add(bazaarIndexRetryDelay); !retryAt.Equal(want) {
		t.Fatalf("index retry started before the fetch completed: got %v, want %v", retryAt, want)
	}
}

func TestBazaarIndexSingleflightWaiterHonorsContext(t *testing.T) {
	resetBazaarIndexTestState(t)
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	bazaarIndexFetcher = func(context.Context) (*bazaarIndexSnapshot, error) {
		calls.Add(1)
		close(started)
		<-release
		return testBazaarIndex(1, true), nil
	}

	leaderDone := make(chan struct{})
	go func() {
		defer close(leaderDone)
		_ = getBazaarIndex(context.Background())
	}()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	waiterDone := make(chan struct{})
	go func() {
		defer close(waiterDone)
		if nil != getBazaarIndex(ctx) {
			t.Error("canceled initial waiter should not receive an uncached index")
		}
	}()
	select {
	case <-waiterDone:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("singleflight waiter ignored its canceled context")
	}
	close(release)
	<-leaderDone
	if 1 != calls.Load() {
		t.Fatalf("expected one shared fetch, got %d", calls.Load())
	}
}

func TestBazaarPublicRatingOverlaySurvivesIndexRefresh(t *testing.T) {
	resetBazaarIndexTestState(t)
	resetBazaarRatingOverrides(t)
	now := time.Unix(1000, 0)
	bazaarIndexNow = func() time.Time { return now }
	bazaarRatingNow = func() time.Time { return now }
	bazaarIndexState.snapshot = testBazaarIndex(1, true)
	bazaarIndexState.snapshot.packages["sample"].Rating = &PackageRating{
		Average: 1, Count: 1, Distribution: [5]int64{1, 0, 0, 0, 0},
	}
	bazaarIndexState.expiresAt = now.Add(2 * bazaarRatingOverrideTTL)

	updated := &PackageRating{Average: 5, Count: 2, Distribution: [5]int64{0, 0, 0, 0, 2}}
	if !ApplyBazaarPackageRating("sample", updated) {
		t.Fatal("valid public rating was rejected")
	}
	bazaarIndexState.mu.Lock()
	bazaarIndexState.snapshot = testBazaarIndex(2, true)
	bazaarIndexState.snapshot.packages["sample"].Rating = &PackageRating{
		Average: 1, Count: 1, Distribution: [5]int64{1, 0, 0, 0, 0},
	}
	bazaarIndexState.mu.Unlock()

	rating, available := GetCachedBazaarPackageRating("sample")
	if !available || nil == rating || 5 != rating.Average || 2 != rating.Count {
		t.Fatalf("stale index overwrote the submitted rating: available=%v rating=%+v", available, rating)
	}

	now = now.Add(bazaarRatingOverrideTTL)
	rating, available = GetCachedBazaarPackageRating("sample")
	if !available || nil == rating || 1 != rating.Average {
		t.Fatalf("expired override did not reveal the refreshed index: available=%v rating=%+v", available, rating)
	}
}

func TestBazaarIndexRatingAvailabilityAndLegacyFallback(t *testing.T) {
	resetBazaarRatingTestState(t)
	now := time.Now()
	bazaarRatingNow = func() time.Time { return now }
	index := testBazaarIndex(9, false)
	bazaarIndexState.mu.Lock()
	bazaarIndexState.snapshot = index
	bazaarIndexState.expiresAt = now.Add(time.Minute)
	bazaarIndexState.mu.Unlock()
	for region := range bazaarRatingRegionCount {
		cache := &bazaarRatingRegionCaches[region]
		cache.data = map[string]bazaarRatingDistribution{"sample": {0, 0, 0, 0, 1}}
		cache.loaded = true
		cache.expiresAt = now.Add(time.Minute)
	}

	if 9 != bazaarStatsFromIndex(index)["sample"].Downloads {
		t.Fatal("rating unavailability hid package downloads")
	}
	ratings, available := getBazaarRatingsFromCache(false)
	if !available || nil == ratings["sample"] || 2 != ratings["sample"].Count {
		t.Fatalf("legacy rating fallback failed: available=%v ratings=%+v", available, ratings)
	}

	bazaarRatingRegionCaches[1] = bazaarRatingRegionCache{}
	if _, available = getBazaarRatingsFromCache(false); available {
		t.Fatal("ratings should remain unavailable when neither unified nor legacy statistics are complete")
	}

	availableIndex := testBazaarIndex(9, true)
	bazaarIndexState.mu.Lock()
	bazaarIndexState.snapshot = availableIndex
	bazaarIndexState.mu.Unlock()
	ratings, available = getBazaarRatingsFromCache(false)
	if !available || 0 != len(ratings) {
		t.Fatalf("zero-rating unified index was not distinguished from an unavailable index: %v %+v", available, ratings)
	}
}

func TestBazaarPublicRatingOverlayConcurrentAccess(t *testing.T) {
	resetBazaarIndexTestState(t)
	resetBazaarRatingOverrides(t)
	now := time.Now()
	bazaarIndexNow = func() time.Time { return now }
	bazaarRatingNow = func() time.Time { return now }
	bazaarIndexState.snapshot = testBazaarIndex(1, true)
	bazaarIndexState.expiresAt = now.Add(time.Minute)
	rating := &PackageRating{Average: 5, Count: 1, Distribution: [5]int64{0, 0, 0, 0, 1}}

	wg := &sync.WaitGroup{}
	for range 20 {
		wg.Go(func() {
			for range 20 {
				if !ApplyBazaarPackageRating("sample", rating) {
					t.Error("valid rating override failed")
				}
				_, _ = GetCachedBazaarPackageRating("sample")
			}
		})
	}
	wg.Wait()
}

func testBazaarIndex(downloads int, ratingsAvailable bool) *bazaarIndexSnapshot {
	return &bazaarIndexSnapshot{
		meta: bazaarIndexMeta{Schema: 2, RatingsAvailable: ratingsAvailable},
		packages: map[string]*bazaarIndexPackage{
			"sample": {Repo: "owner/repo", Downloads: downloads},
		},
		legacyStats: map[string]*bazaarStats{"owner/repo": {Downloads: downloads}},
	}
}

func waitForBazaarIndexDownloads(t *testing.T, downloads int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		index, _, _ := snapshotBazaarIndex(bazaarIndexNow())
		if nil != index && downloads == index.packages["sample"].Downloads {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("index did not refresh to %d downloads", downloads)
}

func waitForBazaarIndexPrefetch(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for bazaarIndexPrefetching.Load() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if bazaarIndexPrefetching.Load() {
		t.Fatal("index prefetch did not finish")
	}
}

func resetBazaarIndexTestState(t *testing.T) {
	t.Helper()
	oldTTL := bazaarIndexCacheTTL
	oldRetryDelay := bazaarIndexRetryDelay
	oldRequestTimeout := bazaarIndexRequestTimeout
	oldNow := bazaarIndexNow
	oldStatServer := bazaarIndexStatServer
	oldFetcher := bazaarIndexFetcher
	bazaarIndexState.mu.Lock()
	oldSnapshot := bazaarIndexState.snapshot
	oldExpiresAt := bazaarIndexState.expiresAt
	oldRetryAt := bazaarIndexState.retryAt
	bazaarIndexState.snapshot = nil
	bazaarIndexState.expiresAt = time.Time{}
	bazaarIndexState.retryAt = time.Time{}
	bazaarIndexState.mu.Unlock()
	bazaarIndexPrefetching.Store(false)
	t.Cleanup(func() {
		bazaarIndexCacheTTL = oldTTL
		bazaarIndexRetryDelay = oldRetryDelay
		bazaarIndexRequestTimeout = oldRequestTimeout
		bazaarIndexNow = oldNow
		bazaarIndexStatServer = oldStatServer
		bazaarIndexFetcher = oldFetcher
		bazaarIndexState.mu.Lock()
		bazaarIndexState.snapshot = oldSnapshot
		bazaarIndexState.expiresAt = oldExpiresAt
		bazaarIndexState.retryAt = oldRetryAt
		bazaarIndexState.mu.Unlock()
		bazaarIndexPrefetching.Store(false)
	})
}

func resetBazaarRatingOverrides(t *testing.T) {
	t.Helper()
	bazaarPublicRatingCache.mu.Lock()
	oldOverrides := bazaarPublicRatingCache.overrides
	bazaarPublicRatingCache.overrides = map[string]bazaarPublicRatingOverride{}
	bazaarPublicRatingCache.mu.Unlock()
	t.Cleanup(func() {
		bazaarPublicRatingCache.mu.Lock()
		bazaarPublicRatingCache.overrides = oldOverrides
		bazaarPublicRatingCache.mu.Unlock()
	})
}
