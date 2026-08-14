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
	"math"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMergeBazaarRatingRegions(t *testing.T) {
	regions := [bazaarRatingRegionCount]bazaarRatingRegionResult{
		{loaded: true, data: map[string]bazaarRatingDistribution{
			"sample": {1, 2, 3, 4, 5},
		}},
		{loaded: true, data: map[string]bazaarRatingDistribution{
			"sample": {5, 4, 3, 2, 1},
		}},
	}
	rating := mergeBazaarRatingRegions(regions)["sample"]
	if nil == rating {
		t.Fatal("expected merged rating")
	}
	if want := [5]int64{6, 6, 6, 6, 6}; rating.Distribution != want {
		t.Fatalf("unexpected distribution: %v", rating.Distribution)
	}
	if 30 != rating.Count || 3 != rating.Average {
		t.Fatalf("unexpected aggregate: count=%d average=%f", rating.Count, rating.Average)
	}

	empty := [bazaarRatingRegionCount]bazaarRatingRegionResult{
		{loaded: true, data: map[string]bazaarRatingDistribution{"empty": {}}},
		{loaded: true, data: map[string]bazaarRatingDistribution{}},
	}
	if nil != mergeBazaarRatingRegions(empty)["empty"] {
		t.Fatal("zero-count distribution should not produce a rating")
	}
}

func TestBuildBazaarPackageIgnoresManifestRating(t *testing.T) {
	pkg := buildBazaarPackageWithMetadata(&StageRepo{
		URL: "owner/repo@hash",
		Package: &Package{
			Name:            "sample",
			RatingAvailable: true,
			Rating:          &PackageRating{Average: 5, Count: 1, Distribution: [5]int64{0, 0, 0, 0, 1}},
		},
	}, nil, nil, false, "plugins", "")
	if nil == pkg || pkg.RatingAvailable || nil != pkg.Rating {
		t.Fatalf("manifest rating should be ignored: %+v", pkg)
	}

	pkg = buildBazaarPackageWithMetadata(&StageRepo{
		URL:     "owner/repo@hash",
		Package: &Package{Name: "sample"},
	}, nil, map[string]*PackageRating{}, true, "plugins", "")
	if nil == pkg || !pkg.RatingAvailable || nil != pkg.Rating {
		t.Fatalf("zero-rating package should report available statistics without a rating: %+v", pkg)
	}

	pkg = buildBazaarPackageWithMetadata(&StageRepo{
		URL:     "owner/repo@hash",
		Package: &Package{Name: "sample"},
	}, nil, map[string]*PackageRating{
		"sample": {Average: 4, Count: 2, Distribution: [5]int64{0, 0, 0, 2, 0}},
	}, true, "plugins", "")
	if nil == pkg || !pkg.RatingAvailable || nil == pkg.Rating || 4 != pkg.Rating.Average {
		t.Fatalf("public rating should be injected: %+v", pkg)
	}
}

func TestBuildBazaarPackageUsesPackageDownloadStatistics(t *testing.T) {
	repo := &StageRepo{URL: "owner/repo@hash", Package: &Package{Name: "sample"}}
	pkg := buildBazaarPackageWithMetadata(repo, map[string]*bazaarStats{
		"sample":     {Downloads: 9},
		"owner/repo": {Downloads: 7},
	}, nil, false, "plugins", "")
	if nil == pkg || 9 != pkg.Downloads {
		t.Fatalf("package download statistics were not preferred: %+v", pkg)
	}
	repo = &StageRepo{URL: "Owner/Repo@hash", Package: &Package{Name: "sample"}}
	pkg = buildBazaarPackageWithMetadata(repo, map[string]*bazaarStats{
		"owner/repo": {Downloads: 7},
	}, nil, false, "plugins", "")
	if nil == pkg || 7 != pkg.Downloads {
		t.Fatalf("legacy repository download statistics were not preserved: %+v", pkg)
	}
}

func TestClearBazaarPackageRating(t *testing.T) {
	pkg := &Package{
		RatingAvailable: true,
		Rating:          &PackageRating{Average: 5, Count: 1, Distribution: [5]int64{0, 0, 0, 0, 1}},
	}
	clearBazaarPackageRating(pkg)
	if pkg.RatingAvailable || nil != pkg.Rating {
		t.Fatalf("package rating metadata should be cleared: %+v", pkg)
	}
}

func TestBuildPackageRatingRejectsInvalidDistribution(t *testing.T) {
	if nil != buildPackageRating(bazaarRatingDistribution{-1, 0, 0, 0, 0}) {
		t.Fatal("negative count should be rejected")
	}
	if nil != buildPackageRating(bazaarRatingDistribution{math.MaxInt64, 1, 0, 0, 0}) {
		t.Fatal("count overflow should be rejected")
	}

	regions := [bazaarRatingRegionCount]bazaarRatingRegionResult{
		{loaded: true, data: map[string]bazaarRatingDistribution{"sample": {math.MaxInt64, 0, 0, 0, 0}}},
		{loaded: true, data: map[string]bazaarRatingDistribution{"sample": {1, 0, 0, 0, 0}}},
	}
	if nil != mergeBazaarRatingRegions(regions)["sample"] {
		t.Fatal("cross-region overflow should be rejected")
	}
}

func TestParseBazaarRatingRegion(t *testing.T) {
	parsed, err := parseBazaarRatingRegion([]byte(`{"sample":[1,2,3,4,5]}`))
	if nil != err || parsed["sample"] != (bazaarRatingDistribution{1, 2, 3, 4, 5}) {
		t.Fatalf("unexpected parsed distribution: parsed=%v err=%v", parsed, err)
	}
	for _, data := range [][]byte{
		[]byte(`{"sample":[1,2,3,4]}`),
		[]byte(`{"sample":[1,2,3,4,-1]}`),
		[]byte(`{"bad/name/extra":[1,2,3,4,5]}`),
		[]byte(`{"sample":[1,2,3,4,"5"]}`),
	} {
		if _, parseErr := parseBazaarRatingRegion(data); nil == parseErr {
			t.Fatalf("expected invalid payload to fail: %s", data)
		}
	}
}

func TestFetchBazaarRatingRegion(t *testing.T) {
	oldServer := bazaarRatingStatServer
	oldNow := bazaarRatingNow
	t.Cleanup(func() {
		bazaarRatingStatServer = oldServer
		bazaarRatingNow = oldNow
	})
	bazaarRatingNow = func() time.Time { return time.Unix(900, 0) }

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/bazaar/ratings/v1/north-america.json" || request.URL.Query().Get("t") != "3" {
			t.Fatalf("unexpected rating URL: %s", request.URL.String())
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"sample":[1,2,3,4,5]}`))
	}))
	defer server.Close()
	bazaarRatingStatServer = server.URL

	data, err := fetchBazaarRatingRegion(context.Background(), 1)
	if nil != err || data["sample"] != (bazaarRatingDistribution{1, 2, 3, 4, 5}) {
		t.Fatalf("unexpected fetched rating: data=%v err=%v", data, err)
	}
	if _, err = fetchBazaarRatingRegion(context.Background(), bazaarRatingRegionCount); nil == err {
		t.Fatal("invalid region should be rejected")
	}
}

func TestBazaarRatingCacheLastGoodAndOverride(t *testing.T) {
	resetBazaarRatingTestState(t)
	now := time.Unix(1000, 0)
	bazaarIndexNow = func() time.Time { return now }
	bazaarRatingNow = func() time.Time { return now }
	bazaarRatingCacheTTL = time.Minute
	bazaarRatingOverrideTTL = 5 * time.Minute

	var fail atomic.Bool
	bazaarRatingRegionFetcher = func(_ context.Context, region int) (map[string]bazaarRatingDistribution, error) {
		if fail.Load() {
			return nil, errors.New("offline")
		}
		return map[string]bazaarRatingDistribution{
			"sample": {int64(region + 1), 0, 0, 0, 0},
		}, nil
	}

	rating, available := GetBazaarPackageRating(context.Background(), "sample")
	if !available || nil == rating || 3 != rating.Count {
		t.Fatalf("unexpected initial rating: available=%v rating=%+v", available, rating)
	}

	fail.Store(true)
	now = now.Add(2 * time.Minute)
	rating, available = GetBazaarPackageRating(context.Background(), "sample")
	if !available || nil == rating || 3 != rating.Count {
		t.Fatalf("expected last-good rating: available=%v rating=%+v", available, rating)
	}

	if !ApplyBazaarPackageRatingDistribution(0, "sample", [5]int64{0, 0, 0, 0, 4}) {
		t.Fatal("expected valid override")
	}
	rating, available = GetCachedBazaarPackageRating("sample")
	if !available || nil == rating || 6 != rating.Count || 11.0/3.0 != rating.Average {
		t.Fatalf("unexpected overridden rating: available=%v rating=%+v", available, rating)
	}
	if ApplyBazaarPackageRatingDistribution(0, "sample", [5]int64{-1, 0, 0, 0, 0}) {
		t.Fatal("negative override should be rejected")
	}

	fail.Store(false)
	now = now.Add(2 * time.Minute)
	rating, available = GetBazaarPackageRating(context.Background(), "sample")
	if !available || nil == rating || 6 != rating.Count || 11.0/3.0 != rating.Average {
		t.Fatalf("stale refresh overwrote submitted distribution: available=%v rating=%+v", available, rating)
	}
}

func TestBazaarPublicRatingTombstone(t *testing.T) {
	resetBazaarRatingTestState(t)
	now := time.Unix(1000, 0)
	bazaarIndexNow = func() time.Time { return now }
	bazaarRatingNow = func() time.Time { return now }
	bazaarRatingOverrideTTL = 5 * time.Minute
	bazaarIndexState.mu.Lock()
	bazaarIndexState.snapshot = testBazaarIndex(1, true)
	bazaarIndexState.snapshot.packages["sample"].Rating = &PackageRating{
		Average: 5, Count: 1, Distribution: [5]int64{0, 0, 0, 0, 1},
	}
	bazaarIndexState.expiresAt = now.Add(time.Hour)
	bazaarIndexState.mu.Unlock()

	if !ClearBazaarPackageRating("sample") {
		t.Fatal("valid rating tombstone was rejected")
	}
	if ClearBazaarPackageRating("bad/name/extra") {
		t.Fatal("invalid package name should be rejected")
	}
	rating, available := GetCachedBazaarPackageRating("sample")
	if !available || nil != rating {
		t.Fatalf("tombstoned rating should be available without an aggregate: available=%v rating=%+v",
			available, rating)
	}
	ratings, available := GetBazaarPackageRatings(context.Background(), []string{"sample"})
	if !available || 0 != len(ratings) {
		t.Fatalf("batch response should omit a tombstoned rating: available=%v ratings=%+v", available, ratings)
	}

	now = now.Add(bazaarRatingOverrideTTL)
	rating, available = GetCachedBazaarPackageRating("sample")
	if !available || nil == rating || 1 != rating.Count {
		t.Fatalf("expired tombstone did not reveal the refreshed index: available=%v rating=%+v",
			available, rating)
	}
}

func TestBazaarRatingOverrideDoesNotExtendRegionCache(t *testing.T) {
	resetBazaarRatingTestState(t)
	now := time.Unix(1000, 0)
	bazaarRatingNow = func() time.Time { return now }
	baseExpiry := now.Add(time.Minute)
	cache := &bazaarRatingRegionCaches[0]
	cache.loaded = true
	cache.expiresAt = baseExpiry
	cache.data = map[string]bazaarRatingDistribution{
		"sample": {1, 0, 0, 0, 0},
		"other":  {1, 0, 0, 0, 0},
	}

	now = now.Add(30 * time.Second)
	if !ApplyBazaarPackageRatingDistribution(0, "sample", [5]int64{0, 0, 0, 0, 2}) {
		t.Fatal("expected valid override")
	}
	if !cache.expiresAt.Equal(baseExpiry) {
		t.Fatalf("rating override changed base cache expiry: got %v, want %v", cache.expiresAt, baseExpiry)
	}

	var fetchCount atomic.Int32
	bazaarRatingRegionFetcher = func(context.Context, int) (map[string]bazaarRatingDistribution, error) {
		fetchCount.Add(1)
		return map[string]bazaarRatingDistribution{
			"sample": {3, 0, 0, 0, 0},
			"other":  {0, 1, 0, 0, 0},
		}, nil
	}
	now = baseExpiry.Add(time.Second)
	result := getBazaarRatingRegion(context.Background(), 0)
	if 1 != fetchCount.Load() {
		t.Fatalf("expected region refresh at base expiry, got %d fetches", fetchCount.Load())
	}
	if want := (bazaarRatingDistribution{0, 1, 0, 0, 0}); result.data["other"] != want {
		t.Fatalf("other package did not refresh on schedule: %v", result.data["other"])
	}
	if want := (bazaarRatingDistribution{0, 0, 0, 0, 2}); result.data["sample"] != want {
		t.Fatalf("submitted package override was not preserved: %v", result.data["sample"])
	}
}

func TestBazaarRatingUnavailableUntilEveryRegionLoaded(t *testing.T) {
	resetBazaarRatingTestState(t)
	bazaarRatingRegionCaches[0].loaded = true
	bazaarRatingRegionCaches[0].data = map[string]bazaarRatingDistribution{"sample": {1, 0, 0, 0, 0}}
	bazaarRatingRegionCaches[0].expiresAt = time.Now().Add(time.Minute)
	if _, available := GetCachedBazaarPackageRating("sample"); available {
		t.Fatal("rating should be unavailable before both regions are loaded")
	}
}

func TestBazaarPackageRatingAfterUpdateNeedsOnlyOtherRegion(t *testing.T) {
	resetBazaarRatingTestState(t)
	bazaarRatingRegionCaches[1].loaded = true
	bazaarRatingRegionCaches[1].data = map[string]bazaarRatingDistribution{"sample": {1, 0, 0, 0, 0}}

	rating, available := GetBazaarPackageRatingAfterUpdate(context.Background(), 0, "sample", [5]int64{0, 0, 0, 0, 2})
	if !available || nil == rating || 3 != rating.Count || 11.0/3.0 != rating.Average {
		t.Fatalf("unexpected rating after update: available=%v rating=%+v", available, rating)
	}
	bazaarRatingRegionCaches[1] = bazaarRatingRegionCache{}
	bazaarRatingRegionFetcher = func(context.Context, int) (map[string]bazaarRatingDistribution, error) {
		return nil, errors.New("offline")
	}
	if _, available = GetBazaarPackageRatingAfterUpdate(context.Background(), 0, "sample",
		[5]int64{0, 0, 0, 0, 2}); available {
		t.Fatal("rating should be unavailable before the other region is loaded")
	}
}

func TestBazaarPackageRatingAfterUpdateLoadsLegacyFallback(t *testing.T) {
	resetBazaarRatingTestState(t)
	var fetchCount atomic.Int32
	bazaarRatingRegionFetcher = func(_ context.Context, region int) (map[string]bazaarRatingDistribution, error) {
		fetchCount.Add(1)
		if 1 != region {
			t.Fatalf("unexpected legacy rating region: %d", region)
		}
		return map[string]bazaarRatingDistribution{"sample": {1, 0, 0, 0, 0}}, nil
	}

	rating, available := GetBazaarPackageRatingAfterUpdate(context.Background(), 0, "sample",
		[5]int64{0, 0, 0, 0, 2})
	if !available || nil == rating || 3 != rating.Count || 11.0/3.0 != rating.Average || 1 != fetchCount.Load() {
		t.Fatalf("unexpected legacy rating fallback: available=%v rating=%+v fetches=%d",
			available, rating, fetchCount.Load())
	}
}

func TestBazaarPackageRatingAfterCancellationReturnsAvailableWithoutRating(t *testing.T) {
	resetBazaarRatingTestState(t)
	bazaarRatingRegionCaches[1].loaded = true
	bazaarRatingRegionCaches[1].data = map[string]bazaarRatingDistribution{}

	rating, available := GetBazaarPackageRatingAfterUpdate(context.Background(), 0, "sample", [5]int64{})
	if !available || nil != rating {
		t.Fatalf("global zero-count rating should remain available: available=%v rating=%+v", available, rating)
	}
	rating, available = GetCachedBazaarPackageRating("sample")
	if !available || nil != rating {
		t.Fatalf("zero-count result should install a public tombstone: available=%v rating=%+v", available, rating)
	}
}

func TestBazaarPackageRatingAfterUpdateRejectsTotalCountOverflow(t *testing.T) {
	resetBazaarRatingTestState(t)
	bazaarRatingRegionCaches[1].loaded = true
	bazaarRatingRegionCaches[1].data = map[string]bazaarRatingDistribution{
		"sample": {0, 1, 0, 0, 0},
	}

	rating, available := GetBazaarPackageRatingAfterUpdate(
		context.Background(), 0, "sample", [5]int64{math.MaxInt64, 0, 0, 0, 0})
	if available || nil != rating {
		t.Fatalf("overflowing total count should be rejected: available=%v rating=%+v", available, rating)
	}
	if rating, overridden := getBazaarPublicRatingOverride("sample", bazaarRatingNow()); overridden || nil != rating {
		t.Fatalf("overflowing total count must not install a public tombstone: overridden=%v rating=%+v",
			overridden, rating)
	}
}

func TestBazaarRatingRegionSingleflight(t *testing.T) {
	resetBazaarRatingTestState(t)
	var fetchCount atomic.Int32
	started := make(chan struct{}, bazaarRatingRegionCount)
	release := make(chan struct{})
	bazaarRatingRegionFetcher = func(_ context.Context, _ int) (map[string]bazaarRatingDistribution, error) {
		fetchCount.Add(1)
		started <- struct{}{}
		<-release
		return map[string]bazaarRatingDistribution{"sample": {1, 0, 0, 0, 0}}, nil
	}

	wg := &sync.WaitGroup{}
	for range 10 {
		wg.Go(func() {
			if rating, available := GetBazaarPackageRating(context.Background(), "sample"); !available || nil == rating {
				t.Errorf("expected rating to be available: %+v", rating)
			}
		})
	}
	for range bazaarRatingRegionCount {
		<-started
	}
	close(release)
	wg.Wait()
	if bazaarRatingRegionCount != int(fetchCount.Load()) {
		t.Fatalf("expected one fetch per region, got %d", fetchCount.Load())
	}
}

func TestBazaarRatingRegionSingleflightWaiterHonorsContext(t *testing.T) {
	resetBazaarRatingTestState(t)
	started := make(chan struct{})
	release := make(chan struct{})
	leaderDone := make(chan struct{})
	bazaarRatingRegionFetcher = func(context.Context, int) (map[string]bazaarRatingDistribution, error) {
		close(started)
		<-release
		return map[string]bazaarRatingDistribution{}, nil
	}
	go func() {
		defer close(leaderDone)
		_ = getBazaarRatingRegion(context.Background(), 0)
	}()
	<-started

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	waiterDone := make(chan struct{})
	go func() {
		defer close(waiterDone)
		_ = getBazaarRatingRegion(ctx, 0)
	}()
	select {
	case <-waiterDone:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("singleflight waiter ignored its canceled context")
	}
	close(release)
	select {
	case <-leaderDone:
	case <-time.After(time.Second):
		t.Fatal("singleflight leader did not finish")
	}
}

func TestBazaarRatingInitialFailureBackoff(t *testing.T) {
	resetBazaarRatingTestState(t)
	now := time.Unix(1000, 0)
	bazaarRatingNow = func() time.Time { return now }
	bazaarRatingRetryDelay = time.Minute
	var fetchCount atomic.Int32
	bazaarRatingRegionFetcher = func(_ context.Context, _ int) (map[string]bazaarRatingDistribution, error) {
		fetchCount.Add(1)
		return nil, errors.New("offline")
	}

	if _, available := GetBazaarPackageRating(context.Background(), "sample"); available {
		t.Fatal("rating should be unavailable after the initial failures")
	}
	if _, available := GetBazaarPackageRating(context.Background(), "sample"); available {
		t.Fatal("rating should remain unavailable during retry backoff")
	}
	if bazaarRatingRegionCount != int(fetchCount.Load()) {
		t.Fatalf("requests during backoff should not refetch, got %d", fetchCount.Load())
	}

	now = now.Add(time.Minute)
	_, _ = GetBazaarPackageRating(context.Background(), "sample")
	if bazaarRatingRegionCount*2 != int(fetchCount.Load()) {
		t.Fatalf("expected one retry per region after backoff, got %d", fetchCount.Load())
	}
}

func resetBazaarRatingTestState(t *testing.T) {
	t.Helper()
	resetBazaarIndexTestState(t)
	resetBazaarRatingOverrides(t)
	oldTTL := bazaarRatingCacheTTL
	oldOverrideTTL := bazaarRatingOverrideTTL
	oldRetryDelay := bazaarRatingRetryDelay
	oldNow := bazaarRatingNow
	oldFetcher := bazaarRatingRegionFetcher
	for region := range bazaarRatingRegionCount {
		bazaarRatingRegionCaches[region] = bazaarRatingRegionCache{}
	}
	// 使用新索引尚未启用的缓存状态，避免旧区域评分测试发起真实统一索引请求。
	bazaarIndexState.mu.Lock()
	bazaarIndexState.snapshot = &bazaarIndexSnapshot{
		packages:    map[string]*bazaarIndexPackage{},
		legacyStats: map[string]*bazaarStats{},
	}
	bazaarIndexState.expiresAt = time.Now().Add(24 * time.Hour)
	bazaarIndexState.mu.Unlock()
	t.Cleanup(func() {
		bazaarRatingCacheTTL = oldTTL
		bazaarRatingOverrideTTL = oldOverrideTTL
		bazaarRatingRetryDelay = oldRetryDelay
		bazaarRatingNow = oldNow
		bazaarRatingRegionFetcher = oldFetcher
		for region := range bazaarRatingRegionCount {
			bazaarRatingRegionCaches[region] = bazaarRatingRegionCache{}
		}
	})
}
