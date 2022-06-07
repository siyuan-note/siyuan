// SiYuan - Build Your Eternal Digital Garden
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
	"net/http"
	"sync"
	"time"

	"github.com/imroc/req/v3"
)

var cachedRhyResult = map[string]interface{}{}
var rhyResultCacheTime int64
var rhyResultLock = sync.Mutex{}

func GetRhyResult(force bool, proxyURL string) (map[string]interface{}, error) {
	rhyResultLock.Lock()
	defer rhyResultLock.Unlock()

	now := time.Now().Unix()
	if 3600 >= now-rhyResultCacheTime && !force && 0 < len(cachedRhyResult) {
		return cachedRhyResult, nil
	}

	request := NewCloudRequest(proxyURL)
	_, err := request.SetResult(&cachedRhyResult).Get(AliyunServer + "/apis/siyuan/version?ver=" + Ver)
	if nil != err {
		LogErrorf("get version meta info failed: %s", err)
		return nil, err
	}
	rhyResultCacheTime = now
	return cachedRhyResult, nil
}

var (
	browserClient, browserDownloadClient, cloudAPIClient, cloudFileClientTimeout2Min, cloudFileClientTimeout15s *req.Client

	browserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36"
)

func NewBrowserRequest(proxyURL string) (ret *req.Request) {
	if nil == browserClient {
		browserClient = req.C().
			SetUserAgent(browserUserAgent).
			SetTimeout(7 * time.Second).
			DisableInsecureSkipVerify()
	}
	if "" != proxyURL {
		browserClient.SetProxyURL(proxyURL)
	}
	ret = browserClient.R()
	ret.SetRetryCount(1).SetRetryFixedInterval(3 * time.Second)
	return
}

func NewBrowserDownloadRequest(proxyURL string) *req.Request {
	if nil == browserDownloadClient {
		browserDownloadClient = req.C().
			SetUserAgent(browserUserAgent).
			SetTimeout(2 * time.Minute).
			SetCommonRetryCount(1).
			SetCommonRetryFixedInterval(3 * time.Second).
			SetCommonRetryCondition(retryCondition).
			DisableInsecureSkipVerify()
	}
	if "" != proxyURL {
		browserDownloadClient.SetProxyURL(proxyURL)
	}
	return browserDownloadClient.R()
}

func NewCloudRequest(proxyURL string) *req.Request {
	if nil == cloudAPIClient {
		cloudAPIClient = req.C().
			SetUserAgent(UserAgent).
			SetTimeout(7 * time.Second).
			SetCommonRetryCount(1).
			SetCommonRetryFixedInterval(3 * time.Second).
			SetCommonRetryCondition(retryCondition).
			DisableInsecureSkipVerify()
	}
	if "" != proxyURL {
		cloudAPIClient.SetProxyURL(proxyURL)
	}
	return cloudAPIClient.R()
}

func NewCloudFileRequest2m(proxyURL string) *req.Request {
	if nil == cloudFileClientTimeout2Min {
		cloudFileClientTimeout2Min = req.C().
			SetUserAgent(UserAgent).
			SetTimeout(2 * time.Minute).
			SetCommonRetryCount(1).
			SetCommonRetryFixedInterval(3 * time.Second).
			SetCommonRetryCondition(retryCondition).
			DisableInsecureSkipVerify()
		setTransport(cloudFileClientTimeout2Min.GetClient())
	}
	if "" != proxyURL {
		cloudFileClientTimeout2Min.SetProxyURL(proxyURL)
	}
	return cloudFileClientTimeout2Min.R()
}

func NewCloudFileRequest15s(proxyURL string) *req.Request {
	if nil == cloudFileClientTimeout15s {
		cloudFileClientTimeout15s = req.C().
			SetUserAgent(UserAgent).
			SetTimeout(15 * time.Second).
			SetCommonRetryCount(1).
			SetCommonRetryFixedInterval(3 * time.Second).
			SetCommonRetryCondition(retryCondition).
			DisableInsecureSkipVerify()
		setTransport(cloudFileClientTimeout15s.GetClient())
	}
	if "" != proxyURL {
		cloudFileClientTimeout15s.SetProxyURL(proxyURL)
	}
	return cloudFileClientTimeout15s.R()
}

func retryCondition(resp *req.Response, err error) bool {
	if nil != err {
		return true
	}
	if 503 == resp.StatusCode { // 负载均衡会返回 503，需要重试
		return true
	}
	return false
}

func setTransport(client *http.Client) {
	// 改进同步下载数据稳定性 https://github.com/siyuan-note/siyuan/issues/4994
	transport := client.Transport.(*req.Transport)
	transport.MaxIdleConns = 10
	transport.MaxIdleConnsPerHost = 2
	transport.MaxConnsPerHost = 2
}
