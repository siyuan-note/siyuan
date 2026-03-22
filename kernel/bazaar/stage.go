// SiYuan - Refactor your thinking
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
	"maps"
	"sync"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/singleflight"
)

var (
	bazaarMemMu        sync.RWMutex
	bazaarCacheRhyHash string                          // bazaar hash，发生变更时清空以下缓存
	stageIndexCache    = make(map[string]*StageIndex)  // pkgType -> 集市包索引
	bazaarStatsCache   = make(map[string]*bazaarStats) // 集市统计数据
	installSizeCache   = make(map[string]int64)        // repoURL -> 安装大小
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
		clear(bazaarStatsCache)
		clear(installSizeCache)
		logging.LogInfof("rhy bazaar hash changed, clearing bazaar caches")
	}
	bazaarCacheRhyHash = bazaarHash
}

type StageBazaarResult struct {
	StageIndex  *StageIndex             // stage 索引
	BazaarStats map[string]*bazaarStats // 统计信息
	Online      bool                    // online 状态
	StageErr    error                   // stage 错误
}

var stageBazaarFlight singleflight.Group
var onlineCheckFlight singleflight.Group
var bazaarStatsFlight singleflight.Group

// getStageAndBazaar 获取 stage 索引和 bazaar 索引，相同 pkgType 的并发调用会合并为一次实际请求 (single-flight)
func getStageAndBazaar(pkgType string) (result StageBazaarResult) {
	key := "stageBazaar:" + pkgType
	v, err, _ := stageBazaarFlight.Do(key, func() (any, error) {
		return getStageAndBazaar0(pkgType), nil
	})
	if err != nil {
		return
	}
	result = v.(StageBazaarResult)
	return
}

// getStageAndBazaar0 执行一次 stage 和 bazaar 索引拉取
func getStageAndBazaar0(pkgType string) (result StageBazaarResult) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stageIndex := getStageIndexFromCache(ctx, pkgType)
	statsMap := getBazaarStatsFromCache(ctx)
	if nil != stageIndex && nil != statsMap {
		// 两者都从缓存返回，不需要 online 检查
		return StageBazaarResult{
			StageIndex:  stageIndex,
			BazaarStats: statsMap,
			Online:      true,
			StageErr:    nil,
		}
	}
	var onlineResult bool
	onlineDone := make(chan bool, 1)
	var stageErr error
	wg := &sync.WaitGroup{}
	wg.Go(func() {
		onlineResult = isBazaarOnline()
		onlineDone <- true
	})
	wg.Go(func() {
		stageIndex, stageErr = getStageIndex(ctx, pkgType)
	})
	wg.Go(func() {
		statsMap = getBazaarStats(ctx)
	})

	<-onlineDone
	if !onlineResult {
		// 不在线时立即取消其他请求并返回结果，避免等待 HTTP 请求超时
		cancel()
		return StageBazaarResult{
			StageIndex:  stageIndex,
			BazaarStats: statsMap,
			Online:      false,
			StageErr:    stageErr,
		}
	}

	// 在线时等待所有请求完成
	wg.Wait()

	return StageBazaarResult{
		StageIndex:  stageIndex,
		BazaarStats: statsMap,
		Online:      onlineResult,
		StageErr:    stageErr,
	}
}

func isBazaarOnline() bool {
	v, err, _ := onlineCheckFlight.Do("bazaarOnline", func() (interface{}, error) {
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
	if !ret {
		util.PushErrMsg(util.Langs[util.Lang][24], 5000)
	}
	return
}

// getStageIndexFromCache 仅从缓存获取 stage 索引，无缓存时返回 nil（读前根据 util 已同步的 bazaar hash 视情况清理缓存）
func getStageIndexFromCache(ctx context.Context, pkgType string) *StageIndex {
	applyRhyBazaarHash(ctx)
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

// bazaarStats 集市包统计信息
type bazaarStats struct {
	Downloads int `json:"downloads"` // 下载次数
}

// getBazaarStatsFromCache 仅从缓存获取集市包统计信息，无缓存时返回 nil
func getBazaarStatsFromCache(ctx context.Context) (ret map[string]*bazaarStats) {
	applyRhyBazaarHash(ctx)
	bazaarMemMu.RLock()
	defer bazaarMemMu.RUnlock()
	if 0 == len(bazaarStatsCache) {
		return nil
	}
	return bazaarStatsCache
}

// getBazaarStats 获取集市包统计信息
func getBazaarStats(ctx context.Context) map[string]*bazaarStats {
	if cached := getBazaarStatsFromCache(ctx); nil != cached {
		return cached
	}

	v, _, _ := bazaarStatsFlight.Do("bazaarStats", func() (interface{}, error) {
		return getBazaarStats0(ctx), nil
	})
	return v.(map[string]*bazaarStats)
}

func getBazaarStats0(ctx context.Context) (result map[string]*bazaarStats) {
	request := httpclient.NewBrowserRequest()
	u := util.BazaarStatServer + "/bazaar/index.json"
	resp, reqErr := request.SetContext(ctx).SetSuccessResult(&result).Get(u)
	if nil != reqErr {
		logging.LogErrorf("get bazaar stats [%s] failed: %s", u, reqErr)
		return
	}
	if 200 != resp.StatusCode {
		logging.LogErrorf("get bazaar stats [%s] failed: %d", u, resp.StatusCode)
		return
	}
	if nil == result {
		result = make(map[string]*bazaarStats)
	}
	bazaarMemMu.Lock()
	clear(bazaarStatsCache)
	maps.Copy(bazaarStatsCache, result)
	bazaarMemMu.Unlock()
	return
}
