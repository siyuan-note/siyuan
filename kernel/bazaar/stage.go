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
	"sync"
	"time"

	gcache "github.com/patrickmn/go-cache"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/singleflight"
)

// cachedStageIndex 缓存 stage 索引
var cachedStageIndex = gcache.New(time.Duration(util.RhyCacheDuration)*time.Second, time.Duration(util.RhyCacheDuration)*time.Second/6)

type StageBazaarResult struct {
	StageIndex  *StageIndex             // stage 索引
	BazaarStats map[string]*bazaarStats // 统计信息
	Online      bool                    // online 状态
	StageErr    error                   // stage 错误
}

var stageBazaarFlight singleflight.Group
var onlineCheckFlight singleflight.Group

// getStageAndBazaar 获取 stage 索引和 bazaar 索引，相同 pkgType 的并发调用会合并为一次实际请求 (single-flight)
func getStageAndBazaar(pkgType string) (result StageBazaarResult) {
	key := "stageBazaar:" + pkgType
	v, err, _ := stageBazaarFlight.Do(key, func() (interface{}, error) {
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
	stageIndex, stageErr := getStageIndexFromCache(pkgType)
	bazaarStats := getBazaarStatsFromCache()
	if nil != stageIndex && nil != bazaarStats {
		// 两者都从缓存返回，不需要 online 检查
		return StageBazaarResult{
			StageIndex:  stageIndex,
			BazaarStats: bazaarStats,
			Online:      true,
			StageErr:    stageErr,
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var onlineResult bool
	onlineDone := make(chan bool, 1)
	wg := &sync.WaitGroup{}
	wg.Add(3)
	go func() {
		defer wg.Done()
		onlineResult = isBazzarOnline()
		onlineDone <- true
	}()
	go func() {
		defer wg.Done()
		stageIndex, stageErr = getStageIndex(ctx, pkgType)
	}()
	go func() {
		defer wg.Done()
		bazaarStats = getBazaarStats(ctx)
	}()

	<-onlineDone
	if !onlineResult {
		// 不在线时立即取消其他请求并返回结果，避免等待 HTTP 请求超时
		cancel()
		return StageBazaarResult{
			StageIndex:  stageIndex,
			BazaarStats: bazaarStats,
			Online:      false,
			StageErr:    stageErr,
		}
	}

	// 在线时等待所有请求完成
	wg.Wait()

	return StageBazaarResult{
		StageIndex:  stageIndex,
		BazaarStats: bazaarStats,
		Online:      onlineResult,
		StageErr:    stageErr,
	}
}

func isBazzarOnline() bool {
	v, err, _ := onlineCheckFlight.Do("bazaarOnline", func() (interface{}, error) {
		return isBazzarOnline0(), nil
	})
	if err != nil {
		return false
	}
	return v.(bool)
}

func isBazzarOnline0() (ret bool) {
	// Improve marketplace loading when offline https://github.com/siyuan-note/siyuan/issues/12050
	ret = util.IsOnline(util.BazaarOSSServer+"/204", true, 3000)
	if !ret {
		util.PushErrMsg(util.Langs[util.Lang][24], 5000)
	}
	return
}

// getStageIndexFromCache 仅从缓存获取 stage 索引，过期或无缓存时返回 nil
func getStageIndexFromCache(pkgType string) (ret *StageIndex, err error) {
	if val, found := cachedStageIndex.Get(pkgType); found {
		ret = val.(*StageIndex)
	}
	return
}

// getStageIndex 获取 stage 索引
func getStageIndex(ctx context.Context, pkgType string) (ret *StageIndex, err error) {
	if cached, cacheErr := getStageIndexFromCache(pkgType); nil != cached {
		ret = cached
		err = cacheErr
		return
	}

	var rhyRet map[string]interface{}
	rhyRet, err = util.GetRhyResult(ctx, false)
	if nil != err {
		return
	}

	bazaarHash := rhyRet["bazaar"].(string)
	ret = &StageIndex{}
	request := httpclient.NewBrowserRequest()
	u := util.BazaarOSSServer + "/bazaar@" + bazaarHash + "/stage/" + pkgType + ".json" // pkgType 为复数形式
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

	cachedStageIndex.SetDefault(pkgType, ret)
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
	Name      string `json:"name"`      // owner/repo 形式，等于键名，目前没有用法
	Downloads int    `json:"downloads"` // 下载次数
}

// cachedBazaarStats 缓存集市包统计信息
var cachedBazaarStats = gcache.New(time.Duration(util.RhyCacheDuration)*time.Second, time.Duration(util.RhyCacheDuration)*time.Second/6)

// getBazaarStatsFromCache 仅从缓存获取集市包统计信息，过期或无缓存时返回 nil
func getBazaarStatsFromCache() (ret map[string]*bazaarStats) {
	if val, found := cachedBazaarStats.Get("index"); found {
		ret = val.(map[string]*bazaarStats)
	}
	return
}

// getBazaarStats 获取集市包统计信息
func getBazaarStats(ctx context.Context) map[string]*bazaarStats {
	if cached := getBazaarStatsFromCache(); nil != cached {
		return cached
	}

	var result map[string]*bazaarStats
	request := httpclient.NewBrowserRequest()
	u := util.BazaarStatServer + "/bazaar/index.json"
	resp, reqErr := request.SetContext(ctx).SetSuccessResult(&result).Get(u)
	if nil != reqErr {
		logging.LogErrorf("get bazaar stats [%s] failed: %s", u, reqErr)
		return result
	}
	if 200 != resp.StatusCode {
		logging.LogErrorf("get bazaar stats [%s] failed: %d", u, resp.StatusCode)
		return result
	}
	cachedBazaarStats.SetDefault("index", result)
	return result
}
