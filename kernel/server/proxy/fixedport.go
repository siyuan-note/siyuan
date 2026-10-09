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

package proxy

import (
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/soheilhy/cmux"
)

func InitFixedPortService(host string, certPath, keyPath string) {
	if util.FixedPort != util.ServerPort {
		if util.IsPortOpen(util.FixedPort) {
			return
		}

		addr := host + ":" + util.FixedPort

		// 启动一个固定 6806 端口的反向代理服务器，这样浏览器扩展才能直接使用 127.0.0.1:6806，不用配置端口
		proxy := newFixedPortReverseProxy(util.ServerURL)

		if "" != certPath {
			logging.LogInfof("fixed port service [%s] is running (HTTP/HTTPS dual mode)", addr)

			ln, listenErr := net.Listen("tcp", addr)
			if listenErr != nil {
				logging.LogWarnf("boot fixed port service [%s] failed: %s", addr, listenErr)
				return
			}

			// 双栈监听下仍需按开关强制加密，否则明文的 6806 端口会继续放行全部 API 请求
			// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-hpj5-f7cj-vvwr
			handler := util.TLSRedirectHandler(proxy)
			if _, _, serveErr := util.ServeMultiplexed(ln, handler, certPath, keyPath, nil, nil); serveErr != nil {
				if !errors.Is(serveErr, cmux.ErrListenerClosed) && !errors.Is(serveErr, http.ErrServerClosed) {
					logging.LogWarnf("fixed port cmux serve error: %s", serveErr)
				}
			}
		} else {
			logging.LogInfof("fixed port service [%s] is running", addr)
			if proxyErr := http.ListenAndServe(addr, proxy); nil != proxyErr {
				logging.LogWarnf("boot fixed port service [%s] failed: %s", util.ServerURL, proxyErr)
			}
		}
		logging.LogInfof("fixed port service [%s] is stopped", addr)
	}
}

func newFixedPortReverseProxy(target *url.URL) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(target)
			request.Out.Host = request.In.Host
			request.SetXForwarded()

			// 反代以 HTTPS 回源内核，内核据此会把明文客户端的连接误判为 TLS，
			// 因此显式标记客户端侧的真实连接方式；调用方伪造的同名头部一律清除。
			// 这里必须判断原始请求（request.In）而不是改写后的请求：改写后的请求是 HTTPS 回源。
			request.Out.Header.Del(util.ClientTLSHeader)
			if request.In.TLS != nil {
				request.Out.Header.Set(util.ClientTLSHeader, util.ClientTLSHeaderValue)
			}
		},
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}
}
