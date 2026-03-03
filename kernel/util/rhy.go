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

package util

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"golang.org/x/sync/singleflight"
)

var (
	RhyCacheDuration = int64(3600 * 6)

	cachedRhyResult    = map[string]interface{}{}
	rhyResultCacheTime int64
	rhyResultLock      = sync.Mutex{}
	rhyResultFlight    singleflight.Group
)

func GetRhyResult(ctx context.Context, force bool) (map[string]interface{}, error) {
	if ContainerDocker == Container {
		RhyCacheDuration = int64(3600 * 24)
	}

	if RhyCacheDuration >= time.Now().Unix()-rhyResultCacheTime && !force && 0 < len(cachedRhyResult) {
		return cachedRhyResult, nil
	}

	// 并发调用只执行一次实际请求
	v, err, _ := rhyResultFlight.Do("rhyResult", func() (interface{}, error) {
		return getRhyResult0(ctx)
	})
	if err != nil {
		return nil, err
	}
	return v.(map[string]interface{}), nil
}

func getRhyResult0(ctx context.Context) (map[string]interface{}, error) {
	rhyResultLock.Lock()
	defer rhyResultLock.Unlock()

	request := httpclient.NewCloudRequest30s()
	resp, err := request.SetContext(ctx).SetSuccessResult(&cachedRhyResult).Get(GetCloudServer() + "/apis/siyuan/version?ver=" + Ver)
	if err != nil {
		logging.LogErrorf("get version info failed: %s", err)
		return nil, err
	}
	if 200 != resp.StatusCode {
		msg := fmt.Sprintf("get rhy result failed: %d", resp.StatusCode)
		logging.LogErrorf(msg)
		return nil, errors.New(msg)
	}
	rhyResultCacheTime = time.Now().Unix()
	return cachedRhyResult, nil
}

func RefreshRhyResultJob() {
	_, err := GetRhyResult(context.TODO(), true)
	if nil != err {
		// 系统唤醒后可能还没有网络连接，这里等待后再重试
		go func() {
			time.Sleep(7 * time.Second)
			GetRhyResult(context.TODO(), true)
		}()
	}
}
