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
	"strings"
	"sync"
	"time"

	"github.com/imroc/req/v3"
	"github.com/siyuan-note/logging"
)

var cachedRhyResult = map[string]interface{}{}
var rhyResultCacheTime int64
var rhyResultLock = sync.Mutex{}

func GetRhyResult(showMsg bool) (ret map[string]interface{}, err error) {
	defer logging.Recover()

	// 使用 GitHub API 获取最新版本信息
	client := req.C().SetTimeout(7 * time.Second)
	resp, err := client.R().SetSuccessResult(&ret).Get("https://api.github.com/repos/EightDoor/siyuan/releases/latest")
	if err != nil {
		logging.LogErrorf("get latest release failed: %s", err)
		return
	}
	if 200 != resp.StatusCode {
		logging.LogErrorf("get latest release failed: %d", resp.StatusCode)
		return
	}

	// 转换 GitHub API 返回的数据格式
	version := ret["tag_name"].(string)
	version = strings.TrimPrefix(version, "v")

	// 构建返回数据
	ret = map[string]interface{}{
		"ver": version,
		"checksums": map[string]interface{}{
			"siyuan-" + version + "-win.exe":        ret["assets"].([]interface{})[0].(map[string]interface{})["browser_download_url"].(string),
			"siyuan-" + version + "-mac.dmg":        ret["assets"].([]interface{})[1].(map[string]interface{})["browser_download_url"].(string),
			"siyuan-" + version + "-mac-arm64.dmg":  ret["assets"].([]interface{})[2].(map[string]interface{})["browser_download_url"].(string),
			"siyuan-" + version + "-linux.AppImage": ret["assets"].([]interface{})[3].(map[string]interface{})["browser_download_url"].(string),
		},
	}

	return
}
