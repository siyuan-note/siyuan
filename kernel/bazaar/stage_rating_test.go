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
	"sync/atomic"
	"testing"
	"time"
)

func TestPrefetchBazaarRatingsCoalescesConcurrentCalls(t *testing.T) {
	oldRatingsLoader := bazaarRatingsLoader
	bazaarRatingsPrefetching.Store(false)
	t.Cleanup(func() {
		bazaarRatingsLoader = oldRatingsLoader
		bazaarRatingsPrefetching.Store(false)
	})

	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan struct{})
	bazaarRatingsLoader = func(context.Context) (map[string]*PackageRating, bool) {
		calls.Add(1)
		close(started)
		<-release
		close(finished)
		return map[string]*PackageRating{}, false
	}
	for range 5 {
		prefetchBazaarRatings()
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("rating prefetch did not start")
	}
	if 1 != calls.Load() {
		close(release)
		t.Fatalf("expected one coalesced rating prefetch, got %d", calls.Load())
	}
	close(release)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("rating prefetch did not finish")
	}
}

func TestGetStageAndBazaarDoesNotWaitForRatings(t *testing.T) {
	resetBazaarRatingTestState(t)
	oldApplyHash := applyBazaarCacheHash
	oldOnlineLoader := bazaarOnlineLoader
	oldStageLoader := stageIndexLoader
	oldStatsLoader := bazaarStatsLoader
	oldRatingsLoader := bazaarRatingsLoader
	oldRatingNow := bazaarRatingNow
	bazaarRatingsPrefetching.Store(false)
	bazaarMemMu.Lock()
	oldStageCache := stageIndexCache
	stageIndexCache = map[string]*StageIndex{}
	bazaarMemMu.Unlock()
	t.Cleanup(func() {
		applyBazaarCacheHash = oldApplyHash
		bazaarOnlineLoader = oldOnlineLoader
		stageIndexLoader = oldStageLoader
		bazaarStatsLoader = oldStatsLoader
		bazaarRatingsLoader = oldRatingsLoader
		bazaarRatingNow = oldRatingNow
		bazaarRatingsPrefetching.Store(false)
		bazaarMemMu.Lock()
		stageIndexCache = oldStageCache
		bazaarMemMu.Unlock()
	})

	applyBazaarCacheHash = func(context.Context) {}
	bazaarOnlineLoader = func() bool { return true }
	stageIndexLoader = func(context.Context, string) (*StageIndex, error) {
		return &StageIndex{}, nil
	}
	bazaarStatsLoader = func(context.Context) map[string]*bazaarStats {
		return map[string]*bazaarStats{"sample": {Downloads: 1}}
	}
	bazaarRatingNow = func() time.Time { return time.Now().Add(24 * time.Hour) }
	ratingStarted := make(chan struct{})
	releaseRating := make(chan struct{})
	ratingFinished := make(chan struct{})
	bazaarRatingsLoader = func(context.Context) (map[string]*PackageRating, bool) {
		close(ratingStarted)
		<-releaseRating
		close(ratingFinished)
		return map[string]*PackageRating{}, true
	}

	resultDone := make(chan StageBazaarResult, 1)
	go func() {
		resultDone <- getStageAndBazaar0("plugins")
	}()

	select {
	case result := <-resultDone:
		if !result.Online || nil == result.StageIndex || nil == result.BazaarStats {
			t.Fatalf("unexpected marketplace result: %+v", result)
		}
	case <-time.After(time.Second):
		close(releaseRating)
		t.Fatal("marketplace loading waited for the optional rating request")
	}
	select {
	case <-ratingStarted:
	case <-time.After(time.Second):
		close(releaseRating)
		t.Fatal("rating prefetch did not start")
	}
	close(releaseRating)
	select {
	case <-ratingFinished:
	case <-time.After(time.Second):
		t.Fatal("rating prefetch did not finish")
	}
}

func TestGetStageAndBazaarIncludesCompletedRatingPrefetch(t *testing.T) {
	resetBazaarRatingTestState(t)
	oldApplyHash := applyBazaarCacheHash
	oldOnlineLoader := bazaarOnlineLoader
	oldStageLoader := stageIndexLoader
	oldStatsLoader := bazaarStatsLoader
	oldRatingsLoader := bazaarRatingsLoader
	bazaarRatingsPrefetching.Store(false)
	bazaarMemMu.Lock()
	oldStageCache := stageIndexCache
	stageIndexCache = map[string]*StageIndex{}
	bazaarMemMu.Unlock()
	t.Cleanup(func() {
		applyBazaarCacheHash = oldApplyHash
		bazaarOnlineLoader = oldOnlineLoader
		stageIndexLoader = oldStageLoader
		bazaarStatsLoader = oldStatsLoader
		bazaarRatingsLoader = oldRatingsLoader
		bazaarRatingsPrefetching.Store(false)
		bazaarMemMu.Lock()
		stageIndexCache = oldStageCache
		bazaarMemMu.Unlock()
	})

	ratingReady := make(chan struct{})
	ratingFinished := make(chan struct{})
	applyBazaarCacheHash = func(context.Context) {}
	bazaarOnlineLoader = func() bool { return true }
	stageIndexLoader = func(context.Context, string) (*StageIndex, error) {
		<-ratingReady
		return &StageIndex{}, nil
	}
	bazaarStatsLoader = func(context.Context) map[string]*bazaarStats {
		return map[string]*bazaarStats{"sample": {Downloads: 1}}
	}
	bazaarRatingsLoader = func(context.Context) (map[string]*PackageRating, bool) {
		defer close(ratingFinished)
		now := time.Now()
		for region := range bazaarRatingRegionCount {
			cache := &bazaarRatingRegionCaches[region]
			cache.mu.Lock()
			cache.data = map[string]bazaarRatingDistribution{"sample": {0, 0, 0, 0, 1}}
			cache.loaded = true
			cache.expiresAt = now.Add(time.Minute)
			cache.mu.Unlock()
		}
		close(ratingReady)
		return map[string]*PackageRating{}, true
	}

	result := getStageAndBazaar0("plugins")
	<-ratingFinished
	if !result.RatingAvailable {
		t.Fatal("completed rating prefetch should be visible in the initial marketplace response")
	}
	rating := result.BazaarRatings["sample"]
	if nil == rating || 2 != rating.Count || ([5]int64{0, 0, 0, 0, 2}) != rating.Distribution {
		t.Fatalf("unexpected prefetched rating: %+v", rating)
	}
}

func TestGetStageAndBazaarOfflineDoesNotWaitForLoaders(t *testing.T) {
	resetBazaarRatingTestState(t)
	oldApplyHash := applyBazaarCacheHash
	oldOnlineLoader := bazaarOnlineLoader
	oldStageLoader := stageIndexLoader
	oldStatsLoader := bazaarStatsLoader
	oldRatingsLoader := bazaarRatingsLoader
	bazaarRatingsPrefetching.Store(false)
	bazaarMemMu.Lock()
	oldStageCache := stageIndexCache
	stageIndexCache = map[string]*StageIndex{}
	bazaarMemMu.Unlock()
	t.Cleanup(func() {
		applyBazaarCacheHash = oldApplyHash
		bazaarOnlineLoader = oldOnlineLoader
		stageIndexLoader = oldStageLoader
		bazaarStatsLoader = oldStatsLoader
		bazaarRatingsLoader = oldRatingsLoader
		bazaarRatingsPrefetching.Store(false)
		bazaarMemMu.Lock()
		stageIndexCache = oldStageCache
		bazaarMemMu.Unlock()
	})

	applyBazaarCacheHash = func(context.Context) {}
	loadersStarted := make(chan struct{}, 2)
	releaseStage := make(chan struct{})
	releaseStats := make(chan struct{})
	stageReturning := make(chan struct{})
	statsReturned := make(chan struct{})
	ratingLoaded := make(chan struct{})
	stageIndexLoader = func(context.Context, string) (*StageIndex, error) {
		loadersStarted <- struct{}{}
		<-releaseStage
		close(stageReturning)
		return &StageIndex{}, nil
	}
	bazaarStatsLoader = func(context.Context) map[string]*bazaarStats {
		loadersStarted <- struct{}{}
		<-releaseStats
		close(statsReturned)
		return map[string]*bazaarStats{}
	}
	bazaarRatingsLoader = func(context.Context) (map[string]*PackageRating, bool) {
		close(ratingLoaded)
		return map[string]*PackageRating{}, false
	}
	bazaarOnlineLoader = func() bool {
		<-loadersStarted
		<-loadersStarted
		close(releaseStage)
		<-stageReturning
		return false
	}

	resultDone := make(chan StageBazaarResult, 1)
	go func() {
		resultDone <- getStageAndBazaar0("plugins")
	}()
	select {
	case result := <-resultDone:
		if result.Online {
			t.Fatal("offline marketplace was reported as online")
		}
	case <-time.After(time.Second):
		close(releaseStats)
		t.Fatal("offline marketplace waited for a loader that ignored cancellation")
	}
	close(releaseStats)
	select {
	case <-statsReturned:
	case <-time.After(time.Second):
		t.Fatal("blocked statistics loader did not finish after release")
	}
	select {
	case <-ratingLoaded:
	case <-time.After(time.Second):
		t.Fatal("rating prefetch did not finish")
	}
}
