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
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/singleflight"
)

const bazaarIndexCDNBucket = 5 * time.Minute

var (
	bazaarIndexCacheTTL       = 5 * time.Minute
	bazaarIndexRetryDelay     = time.Minute
	bazaarIndexRequestTimeout = 30 * time.Second
	bazaarIndexNow            = time.Now
	bazaarIndexStatServer     = util.BazaarStatServer
	bazaarIndexFetcher        = fetchBazaarIndex
	bazaarIndexFlight         singleflight.Group
	bazaarIndexPrefetching    atomic.Bool
	bazaarIndexState          bazaarIndexCache
)

type bazaarIndexMeta struct {
	Schema           int    `json:"schema"`
	RatingsAvailable bool   `json:"ratingsAvailable"`
	Generation       string `json:"generation"`
	PublishedAt      int64  `json:"publishedAt"`
}

type bazaarIndexPackage struct {
	Repo      string         `json:"repo"`
	Downloads int            `json:"downloads"`
	Rating    *PackageRating `json:"rating,omitempty"`
}

type bazaarIndexSnapshot struct {
	meta        bazaarIndexMeta
	packages    map[string]*bazaarIndexPackage
	legacyStats map[string]*bazaarStats
}

type bazaarIndexCache struct {
	mu        sync.RWMutex
	snapshot  *bazaarIndexSnapshot
	expiresAt time.Time
	retryAt   time.Time
}

// getBazaarIndex 返回统一集市索引。缓存过期时立即返回最后一次成功的数据，并在后台刷新。
func getBazaarIndex(ctx context.Context) *bazaarIndexSnapshot {
	snapshot, fresh, canRetry := snapshotBazaarIndex(bazaarIndexNow())
	if nil != snapshot {
		if !fresh && canRetry {
			prefetchBazaarIndex()
		}
		return snapshot
	}
	if !canRetry {
		return nil
	}
	return refreshBazaarIndex(ctx)
}

func getBazaarIndexFromCache() (snapshot *bazaarIndexSnapshot, fresh bool) {
	snapshot, fresh, canRetry := snapshotBazaarIndex(bazaarIndexNow())
	if nil != snapshot && !fresh && canRetry {
		prefetchBazaarIndex()
	}
	return
}

func prefetchBazaarIndex() {
	if !bazaarIndexPrefetching.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer bazaarIndexPrefetching.Store(false)
		ctx, cancel := context.WithTimeout(context.Background(), bazaarIndexRequestTimeout)
		defer cancel()
		_ = refreshBazaarIndex(ctx)
	}()
}

func refreshBazaarIndex(ctx context.Context) *bazaarIndexSnapshot {
	resultCh := bazaarIndexFlight.DoChan("bazaarIndex", func() (any, error) {
		now := bazaarIndexNow()
		if snapshot, fresh, _ := snapshotBazaarIndex(now); nil != snapshot && fresh {
			return snapshot, nil
		}
		if _, _, canRetry := snapshotBazaarIndex(now); !canRetry {
			snapshot, _, _ := snapshotBazaarIndex(now)
			return snapshot, nil
		}

		requestCtx, cancel := context.WithTimeout(context.Background(), bazaarIndexRequestTimeout)
		defer cancel()
		snapshot, err := bazaarIndexFetcher(requestCtx)
		completedAt := bazaarIndexNow()
		if nil != err {
			logging.LogWarnf("get bazaar index failed: %s", err)
			bazaarIndexState.mu.Lock()
			bazaarIndexState.retryAt = completedAt.Add(bazaarIndexRetryDelay)
			lastGood := bazaarIndexState.snapshot
			bazaarIndexState.mu.Unlock()
			return lastGood, nil
		}

		bazaarIndexState.mu.Lock()
		bazaarIndexState.snapshot = snapshot
		bazaarIndexState.expiresAt = completedAt.Add(bazaarIndexCacheTTL)
		bazaarIndexState.retryAt = time.Time{}
		bazaarIndexState.mu.Unlock()
		return snapshot, nil
	})

	select {
	case result := <-resultCh:
		if nil == result.Val {
			return nil
		}
		return result.Val.(*bazaarIndexSnapshot)
	case <-ctx.Done():
		snapshot, _, _ := snapshotBazaarIndex(bazaarIndexNow())
		return snapshot
	}
}

func snapshotBazaarIndex(now time.Time) (snapshot *bazaarIndexSnapshot, fresh, canRetry bool) {
	bazaarIndexState.mu.RLock()
	defer bazaarIndexState.mu.RUnlock()
	snapshot = bazaarIndexState.snapshot
	fresh = nil != snapshot && now.Before(bazaarIndexState.expiresAt)
	canRetry = bazaarIndexState.retryAt.IsZero() || !now.Before(bazaarIndexState.retryAt)
	return
}

func fetchBazaarIndex(ctx context.Context) (ret *bazaarIndexSnapshot, err error) {
	timeBucket := bazaarIndexNow().Unix() / int64(bazaarIndexCDNBucket/time.Second)
	u := fmt.Sprintf("%s/bazaar/index.json?t=%d", bazaarIndexStatServer, timeBucket)
	buf := &bytes.Buffer{}
	resp, err := httpclient.NewBrowserRequest().SetRetryCount(0).SetContext(ctx).SetOutput(buf).Get(u)
	if nil != err {
		return nil, err
	}
	if 200 != resp.StatusCode {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}
	return parseBazaarIndex(buf.Bytes())
}

func parseBazaarIndex(data []byte) (ret *bazaarIndexSnapshot, err error) {
	raw := map[string]json.RawMessage{}
	if err = json.Unmarshal(data, &raw); nil != err {
		return nil, err
	}
	if nil == raw {
		return nil, errors.New("invalid null bazaar index")
	}
	ret = &bazaarIndexSnapshot{
		packages:    map[string]*bazaarIndexPackage{},
		legacyStats: map[string]*bazaarStats{},
	}

	metaRaw, hasMeta := raw["meta"]
	packagesRaw, hasPackages := raw["packages"]
	if hasMeta {
		if err = json.Unmarshal(metaRaw, &ret.meta); nil != err {
			return nil, err
		}
		if 2 > ret.meta.Schema {
			return nil, fmt.Errorf("invalid bazaar index schema: %d", ret.meta.Schema)
		}
		if "" == strings.TrimSpace(ret.meta.Generation) || 1 > ret.meta.PublishedAt {
			return nil, errors.New("invalid bazaar index generation metadata")
		}
		if 2 < ret.meta.Schema {
			ret.meta.RatingsAvailable = false
		} else {
			if !hasPackages {
				return nil, errors.New("incomplete bazaar index metadata")
			}
			if err = json.Unmarshal(packagesRaw, &ret.packages); nil != err {
				return nil, err
			}
			if nil == ret.packages {
				return nil, errors.New("invalid bazaar index packages")
			}
			for packageName, pkg := range ret.packages {
				if !IsValidPackageName(packageName) || nil == pkg || !isValidBazaarRepo(pkg.Repo) || 0 > pkg.Downloads {
					return nil, fmt.Errorf("invalid bazaar index package: %s", packageName)
				}
				if nil != pkg.Rating {
					rating, valid := normalizePackageRating(pkg.Rating)
					if !valid {
						return nil, fmt.Errorf("invalid bazaar package rating: %s", packageName)
					}
					pkg.Rating = rating
				}
			}
		}
	} else if hasPackages {
		return nil, errors.New("incomplete bazaar index metadata")
	}

	for rawRepo, rawStats := range raw {
		if "meta" == rawRepo || "packages" == rawRepo {
			continue
		}
		repo, valid := normalizeLegacyBazaarRepo(rawRepo)
		if !valid {
			return nil, fmt.Errorf("invalid bazaar repository: %s", rawRepo)
		}
		stats := &bazaarStats{}
		if err = json.Unmarshal(rawStats, stats); nil != err {
			return nil, err
		}
		if 0 > stats.Downloads {
			return nil, fmt.Errorf("invalid bazaar downloads: %s", rawRepo)
		}
		if current := ret.legacyStats[repo]; nil != current {
			if stats.Downloads > int(^uint(0)>>1)-current.Downloads {
				return nil, fmt.Errorf("bazaar downloads overflow: %s", repo)
			}
			current.Downloads += stats.Downloads
			continue
		}
		ret.legacyStats[repo] = stats
	}
	return
}

func normalizeLegacyBazaarRepo(repo string) (string, bool) {
	const githubPrefix = "https://github.com/"
	if strings.HasPrefix(repo, githubPrefix) {
		repo = strings.TrimPrefix(repo, githubPrefix)
	}
	if !isValidBazaarRepo(repo) {
		return "", false
	}
	return strings.ToLower(repo), true
}

func isValidBazaarRepo(repo string) bool {
	if 1 != strings.Count(repo, "/") || strings.HasPrefix(repo, "/") || strings.HasSuffix(repo, "/") {
		return false
	}
	for _, part := range strings.Split(repo, "/") {
		if "" == part || "." == part || ".." == part {
			return false
		}
		for _, char := range []byte(part) {
			if ('a' > char || char > 'z') && ('A' > char || char > 'Z') && ('0' > char || char > '9') &&
				'-' != char && '_' != char && '.' != char {
				return false
			}
		}
	}
	return true
}

func normalizePackageRating(rating *PackageRating) (*PackageRating, bool) {
	if nil == rating || math.IsNaN(rating.Average) || math.IsInf(rating.Average, 0) {
		return nil, false
	}
	built := buildPackageRating(bazaarRatingDistribution(rating.Distribution))
	if nil == built || rating.Count != built.Count || math.Abs(rating.Average-built.Average) > 1e-9 {
		return nil, false
	}
	return built, true
}

func bazaarStatsFromIndex(index *bazaarIndexSnapshot) map[string]*bazaarStats {
	if nil == index {
		return nil
	}
	ret := make(map[string]*bazaarStats, len(index.packages)+len(index.legacyStats))
	for repo, stats := range index.legacyStats {
		ret[repo] = &bazaarStats{Downloads: stats.Downloads}
	}
	for packageName, pkg := range index.packages {
		ret[packageName] = &bazaarStats{Downloads: pkg.Downloads}
	}
	return ret
}

func bazaarRatingsFromIndex(index *bazaarIndexSnapshot) (map[string]*PackageRating, bool) {
	if nil == index || 2 != index.meta.Schema || !index.meta.RatingsAvailable {
		return map[string]*PackageRating{}, false
	}
	ret := make(map[string]*PackageRating, len(index.packages))
	for packageName, pkg := range index.packages {
		if nil != pkg.Rating {
			ret[packageName] = clonePackageRating(pkg.Rating)
		}
	}
	return ret, true
}
