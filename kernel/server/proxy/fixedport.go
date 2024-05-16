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

package proxy

import (
	"net/http"
	"net/http/httputil"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func InitFixedPortService(host string) {
	if util.FixedPort != util.ServerPort {
		if util.IsPortOpen(util.FixedPort) {
			return
		}

		// 启动一个固定 6806 端口的反向代理服务器，这样浏览器扩展才能直接使用 127.0.0.1:6806，不用配置端口
		proxy := httputil.NewSingleHostReverseProxy(util.ServerURL)
		logging.LogInfof("fixed port service [%s:%s] is running", host, util.FixedPort)
		if proxyErr := http.ListenAndServe(host+":"+util.FixedPort, proxy); nil != proxyErr {
			logging.LogWarnf("boot fixed port service [%s] failed: %s", util.ServerURL, proxyErr)
		}
		logging.LogInfof("fixed port service [%s:%s] is stopped", host, util.FixedPort)
	}
}
