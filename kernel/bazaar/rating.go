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
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/singleflight"
)

const (
	bazaarRatingRegionCount = 2
	bazaarRatingCDNBucket   = 5 * time.Minute
)

var (
	bazaarRatingCacheTTL    = 5 * time.Minute
	bazaarRatingOverrideTTL = 15 * time.Minute
	bazaarRatingRetryDelay  = time.Minute
	bazaarRatingNow         = time.Now
	bazaarRatingStatServer  = util.BazaarStatServer
	bazaarRatingRegionFiles = [bazaarRatingRegionCount]string{
		"china.json",
		"north-america.json",
	}
	bazaarRatingRegionCaches  [bazaarRatingRegionCount]bazaarRatingRegionCache
	bazaarRatingRegionFlights [bazaarRatingRegionCount]singleflight.Group
	bazaarRatingRegionFetcher = fetchBazaarRatingRegion
	bazaarPublicRatingCache   = bazaarPublicRatingOverrides{overrides: map[string]bazaarPublicRatingOverride{}}
)

type bazaarRatingDistribution [5]int64

type bazaarRatingOverride struct {
	distribution bazaarRatingDistribution
	expiresAt    time.Time
}

type bazaarPublicRatingOverride struct {
	rating    *PackageRating
	expiresAt time.Time
}

type bazaarPublicRatingOverrides struct {
	mu        sync.RWMutex
	overrides map[string]bazaarPublicRatingOverride
}

type bazaarRatingRegionCache struct {
	mu        sync.RWMutex
	data      map[string]bazaarRatingDistribution
	loaded    bool
	expiresAt time.Time
	retryAt   time.Time
	overrides map[string]bazaarRatingOverride
}

type bazaarRatingRegionResult struct {
	data   map[string]bazaarRatingDistribution
	loaded bool
}

// GetBazaarPackageRatings 获取指定包的全球公开评分。
// 第二个返回值表示公开评分索引是否可用。
func GetBazaarPackageRatings(ctx context.Context, packageNames []string) (ret map[string]*PackageRating, available bool) {
	all, available := getBazaarRatings(ctx)
	if !available {
		return map[string]*PackageRating{}, false
	}
	ret = make(map[string]*PackageRating, len(packageNames))
	for _, packageName := range packageNames {
		if rating := all[packageName]; nil != rating {
			ret[packageName] = clonePackageRating(rating)
		}
	}
	return ret, true
}

// GetBazaarPackageRating 获取单个包的全球公开评分。
func GetBazaarPackageRating(ctx context.Context, packageName string) (rating *PackageRating, available bool) {
	if rating, ok := getBazaarPublicRatingOverride(packageName, bazaarRatingNow()); ok {
		return rating, true
	}
	ratings, available := getBazaarRatings(ctx)
	if !available {
		return nil, false
	}
	return clonePackageRating(ratings[packageName]), true
}

// GetCachedBazaarPackageRating 仅使用最后一次成功的公开索引获取单个包评分。
func GetCachedBazaarPackageRating(packageName string) (rating *PackageRating, available bool) {
	if rating, ok := getBazaarPublicRatingOverride(packageName, bazaarRatingNow()); ok {
		return rating, true
	}
	ratings, available := getBazaarRatingsFromCache(false)
	if !available {
		return nil, false
	}
	return clonePackageRating(ratings[packageName]), true
}

// ApplyBazaarPackageRating 使用评分提交响应临时覆盖统一索引中的公开评分。
func ApplyBazaarPackageRating(packageName string, rating *PackageRating) bool {
	if !IsValidPackageName(packageName) {
		return false
	}
	normalized, valid := normalizePackageRating(rating)
	if !valid {
		return false
	}
	applyBazaarPackageRatingOverride(packageName, normalized)
	return true
}

// ClearBazaarPackageRating 使用评分取消响应临时隐藏统一索引中的旧公开评分。
func ClearBazaarPackageRating(packageName string) bool {
	if !IsValidPackageName(packageName) {
		return false
	}
	applyBazaarPackageRatingOverride(packageName, nil)
	return true
}

func applyBazaarPackageRatingOverride(packageName string, rating *PackageRating) {
	now := bazaarRatingNow()
	bazaarPublicRatingCache.mu.Lock()
	defer bazaarPublicRatingCache.mu.Unlock()
	if nil == bazaarPublicRatingCache.overrides {
		bazaarPublicRatingCache.overrides = map[string]bazaarPublicRatingOverride{}
	}
	for name, override := range bazaarPublicRatingCache.overrides {
		if !now.Before(override.expiresAt) {
			delete(bazaarPublicRatingCache.overrides, name)
		}
	}
	bazaarPublicRatingCache.overrides[packageName] = bazaarPublicRatingOverride{
		rating:    rating,
		expiresAt: now.Add(bazaarRatingOverrideTTL),
	}
}

// ApplyBazaarPackageRatingDistribution 使用评分提交响应覆盖当前区域中单个包的分布。
func ApplyBazaarPackageRatingDistribution(region int, packageName string, distribution [5]int64) bool {
	if region < 0 || bazaarRatingRegionCount <= region || !IsValidPackageName(packageName) {
		return false
	}
	dist := bazaarRatingDistribution(distribution)
	if !validBazaarRatingDistribution(dist) {
		return false
	}

	now := bazaarRatingNow()
	cache := &bazaarRatingRegionCaches[region]
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if nil == cache.data {
		cache.data = map[string]bazaarRatingDistribution{}
	}
	data := cloneBazaarRatingDistributions(cache.data)
	data[packageName] = dist
	cache.data = data
	if nil == cache.overrides {
		cache.overrides = map[string]bazaarRatingOverride{}
	}
	cache.overrides[packageName] = bazaarRatingOverride{
		distribution: dist,
		expiresAt:    now.Add(bazaarRatingOverrideTTL),
	}
	return true
}

// GetBazaarPackageRatingAfterUpdate 将当前区域的评分响应与另一区域最后一次成功的数据合并。
func GetBazaarPackageRatingAfterUpdate(ctx context.Context, region int, packageName string,
	distribution [5]int64) (rating *PackageRating, available bool) {
	if region < 0 || bazaarRatingRegionCount <= region || !IsValidPackageName(packageName) {
		return nil, false
	}
	merged := bazaarRatingDistribution(distribution)
	if !validBazaarRatingDistribution(merged) {
		return nil, false
	}

	otherRegion := (region + 1) % bazaarRatingRegionCount
	other, _ := snapshotBazaarRatingRegion(otherRegion, bazaarRatingNow())
	if !other.loaded {
		other = getBazaarRatingRegion(ctx, otherRegion)
		if !other.loaded {
			return nil, false
		}
	}
	for i, count := range other.data[packageName] {
		if count > math.MaxInt64-merged[i] {
			return nil, false
		}
		merged[i] += count
	}
	rating = buildPackageRating(merged)
	if nil == rating {
		if (bazaarRatingDistribution{}) != merged {
			return nil, false
		}
		if !ClearBazaarPackageRating(packageName) {
			return nil, false
		}
		return nil, true
	}
	if !ApplyBazaarPackageRating(packageName, rating) {
		return nil, false
	}
	return rating, true
}

func getBazaarRatings(ctx context.Context) (ret map[string]*PackageRating, available bool) {
	if cached, ok := getBazaarRatingsFromCache(true); ok {
		return cached, true
	}
	index := getBazaarIndex(ctx)
	if ratings, ok := bazaarRatingsFromIndex(index); ok {
		return applyBazaarPublicRatingOverrides(ratings, bazaarRatingNow()), true
	}
	return getLegacyBazaarRatings(ctx)
}

func getBazaarRatingsFromCache(requireFresh bool) (ret map[string]*PackageRating, available bool) {
	index, fresh := getBazaarIndexFromCache()
	if ratings, ok := bazaarRatingsFromIndex(index); ok {
		if requireFresh && !fresh {
			return map[string]*PackageRating{}, false
		}
		return applyBazaarPublicRatingOverrides(ratings, bazaarRatingNow()), true
	}
	ratings, available := getLegacyBazaarRatingsFromCache(requireFresh)
	if !available {
		return ratings, false
	}
	return applyBazaarPublicRatingOverrides(ratings, bazaarRatingNow()), true
}

func getLegacyBazaarRatings(ctx context.Context) (ret map[string]*PackageRating, available bool) {
	if cached, ok := getLegacyBazaarRatingsFromCache(true); ok {
		return cached, true
	}

	results := [bazaarRatingRegionCount]bazaarRatingRegionResult{}
	wg := &sync.WaitGroup{}
	for region := range bazaarRatingRegionCount {
		wg.Go(func() {
			results[region] = getBazaarRatingRegion(ctx, region)
		})
	}
	wg.Wait()
	for _, result := range results {
		if !result.loaded {
			return map[string]*PackageRating{}, false
		}
	}
	return mergeBazaarRatingRegions(results), true
}

func getLegacyBazaarRatingsFromCache(requireFresh bool) (ret map[string]*PackageRating, available bool) {
	now := bazaarRatingNow()
	results := [bazaarRatingRegionCount]bazaarRatingRegionResult{}
	for region := range bazaarRatingRegionCount {
		result, fresh := snapshotBazaarRatingRegion(region, now)
		if !result.loaded || requireFresh && !fresh {
			return map[string]*PackageRating{}, false
		}
		results[region] = result
	}
	return mergeBazaarRatingRegions(results), true
}

func getBazaarPublicRatingOverride(packageName string, now time.Time) (*PackageRating, bool) {
	bazaarPublicRatingCache.mu.RLock()
	defer bazaarPublicRatingCache.mu.RUnlock()
	override, ok := bazaarPublicRatingCache.overrides[packageName]
	if !ok || !now.Before(override.expiresAt) {
		return nil, false
	}
	return clonePackageRating(override.rating), true
}

func applyBazaarPublicRatingOverrides(source map[string]*PackageRating, now time.Time) map[string]*PackageRating {
	ret := make(map[string]*PackageRating, len(source))
	for packageName, rating := range source {
		ret[packageName] = clonePackageRating(rating)
	}
	bazaarPublicRatingCache.mu.RLock()
	defer bazaarPublicRatingCache.mu.RUnlock()
	for packageName, override := range bazaarPublicRatingCache.overrides {
		if now.Before(override.expiresAt) {
			if nil == override.rating {
				delete(ret, packageName)
			} else {
				ret[packageName] = clonePackageRating(override.rating)
			}
		}
	}
	return ret
}

func getBazaarRatingRegion(ctx context.Context, region int) bazaarRatingRegionResult {
	now := bazaarRatingNow()
	if cached, fresh := snapshotBazaarRatingRegion(region, now); cached.loaded && fresh {
		return cached
	}
	if !canRetryBazaarRatingRegion(region, now) {
		cached, _ := snapshotBazaarRatingRegion(region, now)
		return cached
	}

	resultCh := bazaarRatingRegionFlights[region].DoChan("bazaarRatingRegion", func() (any, error) {
		now = bazaarRatingNow()
		if cached, fresh := snapshotBazaarRatingRegion(region, now); cached.loaded && fresh {
			return cached, nil
		}
		if !canRetryBazaarRatingRegion(region, now) {
			cached, _ := snapshotBazaarRatingRegion(region, now)
			return cached, nil
		}

		data, err := bazaarRatingRegionFetcher(ctx, region)
		if nil != err {
			logging.LogWarnf("get bazaar rating region [%s] failed: %s", bazaarRatingRegionFiles[region], err)
			cache := &bazaarRatingRegionCaches[region]
			cache.mu.Lock()
			cache.retryAt = now.Add(bazaarRatingRetryDelay)
			cache.mu.Unlock()
			cached, _ := snapshotBazaarRatingRegion(region, now)
			return cached, nil
		}

		cache := &bazaarRatingRegionCaches[region]
		cache.mu.Lock()
		cache.data = cloneBazaarRatingDistributions(data)
		cache.loaded = true
		cache.expiresAt = now.Add(bazaarRatingCacheTTL)
		cache.retryAt = time.Time{}
		for packageName, override := range cache.overrides {
			if !now.Before(override.expiresAt) {
				delete(cache.overrides, packageName)
			}
		}
		cache.mu.Unlock()
		cached, _ := snapshotBazaarRatingRegion(region, now)
		return cached, nil
	})
	select {
	case result := <-resultCh:
		return result.Val.(bazaarRatingRegionResult)
	case <-ctx.Done():
		cached, _ := snapshotBazaarRatingRegion(region, bazaarRatingNow())
		return cached
	}
}

func canRetryBazaarRatingRegion(region int, now time.Time) bool {
	cache := &bazaarRatingRegionCaches[region]
	cache.mu.RLock()
	defer cache.mu.RUnlock()
	return cache.retryAt.IsZero() || !now.Before(cache.retryAt)
}

func snapshotBazaarRatingRegion(region int, now time.Time) (ret bazaarRatingRegionResult, fresh bool) {
	cache := &bazaarRatingRegionCaches[region]
	cache.mu.RLock()
	defer cache.mu.RUnlock()
	ret.loaded = cache.loaded
	fresh = cache.loaded && now.Before(cache.expiresAt)
	if !cache.loaded {
		return
	}
	ret.data = cloneBazaarRatingDistributions(cache.data)
	for packageName, override := range cache.overrides {
		if now.Before(override.expiresAt) {
			ret.data[packageName] = override.distribution
		}
	}
	return
}

func fetchBazaarRatingRegion(ctx context.Context, region int) (ret map[string]bazaarRatingDistribution, err error) {
	if region < 0 || bazaarRatingRegionCount <= region {
		return nil, errors.New("invalid bazaar rating region")
	}

	timeBucket := bazaarRatingNow().Unix() / int64(bazaarRatingCDNBucket/time.Second)
	u := fmt.Sprintf("%s/bazaar/ratings/v1/%s?t=%d", bazaarRatingStatServer, bazaarRatingRegionFiles[region], timeBucket)
	buf := &bytes.Buffer{}
	resp, err := httpclient.NewBrowserRequest().SetRetryCount(0).SetContext(ctx).SetOutput(buf).Get(u)
	if nil != err {
		return nil, err
	}
	if 200 != resp.StatusCode {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	ret, err = parseBazaarRatingRegion(buf.Bytes())
	return
}

func parseBazaarRatingRegion(data []byte) (ret map[string]bazaarRatingDistribution, err error) {
	raw := map[string]json.RawMessage{}
	if err = json.Unmarshal(data, &raw); nil != err {
		return nil, err
	}
	ret = make(map[string]bazaarRatingDistribution, len(raw))
	for packageName, rawDistribution := range raw {
		if !IsValidPackageName(packageName) {
			return nil, fmt.Errorf("invalid package name: %s", packageName)
		}
		var values []int64
		if err = json.Unmarshal(rawDistribution, &values); nil != err {
			return nil, err
		}
		if 5 != len(values) {
			return nil, fmt.Errorf("invalid rating distribution length for package: %s", packageName)
		}
		distribution := bazaarRatingDistribution(values)
		if !validBazaarRatingDistribution(distribution) {
			return nil, fmt.Errorf("invalid rating distribution for package: %s", packageName)
		}
		ret[packageName] = distribution
	}
	return
}

func mergeBazaarRatingRegions(regions [bazaarRatingRegionCount]bazaarRatingRegionResult) map[string]*PackageRating {
	distributions := map[string]bazaarRatingDistribution{}
	for _, region := range regions {
		for packageName, distribution := range region.data {
			merged := distributions[packageName]
			valid := true
			for i, count := range distribution {
				if count > math.MaxInt64-merged[i] {
					valid = false
					break
				}
				merged[i] += count
			}
			if valid {
				distributions[packageName] = merged
			} else {
				delete(distributions, packageName)
			}
		}
	}

	ret := make(map[string]*PackageRating, len(distributions))
	for packageName, distribution := range distributions {
		if rating := buildPackageRating(distribution); nil != rating {
			ret[packageName] = rating
		}
	}
	return ret
}

func buildPackageRating(distribution bazaarRatingDistribution) *PackageRating {
	if !validBazaarRatingDistribution(distribution) {
		return nil
	}
	var count int64
	var weighted float64
	for i, itemCount := range distribution {
		if itemCount > math.MaxInt64-count {
			return nil
		}
		count += itemCount
		weighted += float64(i+1) * float64(itemCount)
	}
	if 1 > count {
		return nil
	}
	return &PackageRating{
		Average:      weighted / float64(count),
		Count:        count,
		Distribution: [5]int64(distribution),
	}
}

func validBazaarRatingDistribution(distribution bazaarRatingDistribution) bool {
	for _, count := range distribution {
		if 0 > count {
			return false
		}
	}
	return true
}

func cloneBazaarRatingDistributions(source map[string]bazaarRatingDistribution) map[string]bazaarRatingDistribution {
	ret := make(map[string]bazaarRatingDistribution, len(source))
	for packageName, distribution := range source {
		ret[packageName] = distribution
	}
	return ret
}

func clonePackageRating(rating *PackageRating) *PackageRating {
	if nil == rating {
		return nil
	}
	ret := *rating
	return &ret
}
