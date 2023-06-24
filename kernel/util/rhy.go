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
	"sync"
	"time"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

var cachedRhyResult = map[string]interface{}{}
var rhyResultCacheTime int64
var rhyResultLock = sync.Mutex{}

func GetRhyResult(force bool) (map[string]interface{}, error) {
	rhyResultLock.Lock()
	defer rhyResultLock.Unlock()

	now := time.Now().Unix()
	if 3600 >= now-rhyResultCacheTime && !force && 0 < len(cachedRhyResult) {
		return cachedRhyResult, nil
	}

	request := httpclient.NewCloudRequest30s()
	_, err := request.SetSuccessResult(&cachedRhyResult).Get(GetCloudServer() + "/apis/siyuan/version?ver=" + Ver)
	if nil != err {
		logging.LogErrorf("get version info failed: %s", err)
		return nil, err
	}
	rhyResultCacheTime = now
	return cachedRhyResult, nil
}
