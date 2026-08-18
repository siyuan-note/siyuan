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
	"sync"
	"sync/atomic"
	"time"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/singleflight"
)

var (
	bazaarMemMu        sync.RWMutex
	bazaarCacheRhyHash string                         // bazaar hash，发生变更时清空以下缓存
	stageIndexCache    = make(map[string]*StageIndex) // pkgType -> 集市包索引
)

func applyRhyBazaarHash(ctx context.Context) {
	bazaarHash := util.GetRhyBazaarHash(ctx)
	if "" == bazaarHash {
		return
	}
	bazaarMemMu.Lock()
	defer bazaarMemMu.Unlock()
	if bazaarCacheRhyHash != "" && bazaarHash != bazaarCacheRhyHash {
		clear(stageIndexCache)
		logging.LogInfof("rhy bazaar hash changed, clearing bazaar caches")
	}
	bazaarCacheRhyHash = bazaarHash
}

type StageBazaarResult struct {
	StageIndex      *StageIndex               // stage 索引
	BazaarStats     map[string]*bazaarStats   // 下载统计信息
	BazaarRatings   map[string]*PackageRating // 评分统计信息
	RatingAvailable bool                      // 评分统计信息是否可用
	Online          bool                      // online 状态
	StageErr        error                     // stage 错误
}

var stageBazaarFlight singleflight.Group
var onlineCheckFlight singleflight.Group
var bazaarRatingsPrefetching atomic.Bool

var (
	applyBazaarCacheHash = applyRhyBazaarHash
	bazaarOnlineLoader   = isBazaarOnline
	stageIndexLoader     = getStageIndex
	bazaarStatsLoader    = getBazaarStats
	bazaarRatingsLoader  = getBazaarRatings
)

// getStageAndBazaar 获取 stage 索引和 bazaar 索引，相同 pkgType 的并发调用会合并为一次实际请求 (single-flight)
func getStageAndBazaar(pkgType string, showError bool) (result StageBazaarResult) {
	key := "stageBazaar:" + pkgType
	v, err, _ := stageBazaarFlight.Do(key, func() (any, error) {
		return getStageAndBazaar0(pkgType), nil
	})
	if err != nil {
		return
	}
	result = v.(StageBazaarResult)
	if showError && !result.Online {
		util.PushErrMsg(util.Langs[util.Lang][24], 5000)
	}
	return
}

// getStageAndBazaar0 执行一次 stage 和 bazaar 索引拉取
func getStageAndBazaar0(pkgType string) (result StageBazaarResult) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stageIndex := getStageIndexFromCache(ctx, pkgType)
	statsMap := getBazaarStatsFromCache(ctx)
	ratingsMap, ratingsAvailable := getBazaarRatingsFromCache(false)
	_, ratingsFresh := getBazaarRatingsFromCache(true)
	if nil != stageIndex && nil != statsMap {
		if !ratingsFresh {
			prefetchBazaarRatings()
		}
		if !ratingsAvailable {
			ratingsMap = nil
		}
		// 两者都从缓存返回，不需要 online 检查
		return StageBazaarResult{
			StageIndex:      stageIndex,
			BazaarStats:     statsMap,
			BazaarRatings:   ratingsMap,
			RatingAvailable: ratingsAvailable,
			Online:          true,
			StageErr:        nil,
		}
	}
	type stageLoadResult struct {
		index *StageIndex
		err   error
	}
	onlineResultCh := make(chan bool, 1)
	stageResultCh := make(chan stageLoadResult, 1)
	statsResultCh := make(chan map[string]*bazaarStats, 1)
	go func() {
		onlineResultCh <- bazaarOnlineLoader()
	}()
	go func() {
		index, err := stageIndexLoader(ctx, pkgType)
		stageResultCh <- stageLoadResult{index: index, err: err}
	}()
	go func() {
		statsResultCh <- bazaarStatsLoader(ctx)
	}()
	if !ratingsFresh {
		prefetchBazaarRatings()
	}

	onlineResult := <-onlineResultCh
	if !onlineResult {
		// 不在线时立即取消其他请求并返回结果，避免等待 HTTP 请求超时
		cancel()
		var stageErr error
		select {
		case stageResult := <-stageResultCh:
			stageIndex, stageErr = stageResult.index, stageResult.err
		default:
		}
		select {
		case statsMap = <-statsResultCh:
		default:
		}
		return StageBazaarResult{
			StageIndex:      stageIndex,
			BazaarStats:     statsMap,
			BazaarRatings:   ratingsMap,
			RatingAvailable: ratingsAvailable,
			Online:          false,
			StageErr:        stageErr,
		}
	}

	// 在线时等待所有请求完成
	stageResult := <-stageResultCh
	stageIndex, stageErr := stageResult.index, stageResult.err
	statsMap = <-statsResultCh
	ratingsMap, ratingsAvailable = getBazaarRatingsFromCache(false)
	if !ratingsAvailable {
		ratingsMap = nil
	}

	return StageBazaarResult{
		StageIndex:      stageIndex,
		BazaarStats:     statsMap,
		BazaarRatings:   ratingsMap,
		RatingAvailable: ratingsAvailable,
		Online:          onlineResult,
		StageErr:        stageErr,
	}
}

func prefetchBazaarRatings() {
	if !bazaarRatingsPrefetching.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer bazaarRatingsPrefetching.Store(false)
		ratingCtx, ratingCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer ratingCancel()
		_, _ = bazaarRatingsLoader(ratingCtx)
	}()
}

func isBazaarOnline() bool {
	v, err, _ := onlineCheckFlight.Do("bazaarOnline", func() (any, error) {
		return isBazaarOnline0(), nil
	})
	if err != nil {
		return false
	}
	return v.(bool)
}

func isBazaarOnline0() (ret bool) {
	// Improve marketplace loading when offline https://github.com/siyuan-note/siyuan/issues/12050
	ret = util.IsOnline(util.BazaarOSSServer+"/204", true, 3000)
	return
}

// getStageIndexFromCache 仅从缓存获取 stage 索引，无缓存时返回 nil（读前根据 util 已同步的 bazaar hash 视情况清理缓存）
func getStageIndexFromCache(ctx context.Context, pkgType string) *StageIndex {
	applyBazaarCacheHash(ctx)
	bazaarMemMu.RLock()
	defer bazaarMemMu.RUnlock()
	return stageIndexCache[pkgType]
}

// getStageIndex 获取 stage 索引
func getStageIndex(ctx context.Context, pkgType string) (ret *StageIndex, err error) {
	if cached := getStageIndexFromCache(ctx, pkgType); nil != cached {
		ret = cached
		return
	}

	bazaarHash := util.GetRhyBazaarHash(ctx)
	if "" == bazaarHash {
		logging.LogErrorf("bazaar hash unavailable (rhy missing or invalid bazaar field)")
		err = errors.New("bazaar hash not available")
		return
	}
	ret = &StageIndex{}
	request := httpclient.NewBrowserRequest()
	u := util.BazaarOSSServer + "/bazaar@" + bazaarHash + "/stage/" + pkgType + ".json" // pkgType 单词为复数形式
	resp, reqErr := request.SetContext(ctx).SetSuccessResult(ret).Get(u)
	if nil != reqErr {
		logging.LogErrorf("get community stage index [%s] failed: %s", u, reqErr)
		err = reqErr
		return
	}
	if 200 != resp.StatusCode {
		logging.LogErrorf("get community stage index [%s] failed: %d", u, resp.StatusCode)
		err = errors.New("get stage index failed")
		return
	}

	for _, repo := range ret.Repos {
		unescapePackageDisplayStrings(repo.Package)
	}

	bazaarMemMu.Lock()
	stageIndexCache[pkgType] = ret
	bazaarMemMu.Unlock()
	return
}

// getStageRepoByURL 根据 pkgType 与 url（owner/repo@hash）获取 StageRepo
func getStageRepoByURL(ctx context.Context, pkgType, url string) *StageRepo {
	stageIndex, _ := getStageIndex(ctx, pkgType)
	if nil == stageIndex {
		return nil
	}
	stageIndex.reposOnce.Do(func() {
		stageIndex.reposByURL = make(map[string]*StageRepo, len(stageIndex.Repos))
		for _, r := range stageIndex.Repos {
			stageIndex.reposByURL[r.URL] = r
		}
	})
	return stageIndex.reposByURL[url]
}

// HasBazaarPackage 判断指定名称是否存在于官方集市 Stage 索引中。
func HasBazaarPackage(ctx context.Context, pkgType, packageName string) (bool, error) {
	packageNames, err := GetExistingBazaarPackageNames(ctx, pkgType, []string{packageName})
	return 0 < len(packageNames), err
}

// GetExistingBazaarPackageNames 筛选存在于官方集市 Stage 索引中的包名。
func GetExistingBazaarPackageNames(ctx context.Context, pkgType string, packageNames []string) ([]string, error) {
	stageIndex, err := getStageIndex(ctx, pkgType)
	if nil != err {
		return nil, err
	}
	if nil == stageIndex {
		return nil, errors.New("stage index is unavailable")
	}
	official := make(map[string]bool, len(stageIndex.Repos))
	for _, repo := range stageIndex.Repos {
		if nil != repo && nil != repo.Package {
			official[repo.Package.Name] = true
		}
	}
	ret := make([]string, 0, len(packageNames))
	for _, packageName := range packageNames {
		if official[packageName] {
			ret = append(ret, packageName)
		}
	}
	return ret, nil
}

// bazaarStats 集市包统计信息
type bazaarStats struct {
	Downloads int `json:"downloads"` // 下载次数
}

// getBazaarStatsFromCache 仅从缓存获取集市包统计信息，无缓存时返回 nil
func getBazaarStatsFromCache(ctx context.Context) (ret map[string]*bazaarStats) {
	applyBazaarCacheHash(ctx)
	index, _ := getBazaarIndexFromCache()
	return bazaarStatsFromIndex(index)
}

// getBazaarStats 获取集市包统计信息
func getBazaarStats(ctx context.Context) map[string]*bazaarStats {
	return bazaarStatsFromIndex(getBazaarIndex(ctx))
}
