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
	"crypto/tls"
	"net"
	"net/http"
	"net/http/httputil"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/soheilhy/cmux"
)

func InitFixedPortService(host string, useTLS bool, certPath, keyPath string) {
	if util.FixedPort != util.ServerPort {
		if util.IsPortOpen(util.FixedPort) {
			return
		}

		addr := host + ":" + util.FixedPort

		// 启动一个固定 6806 端口的反向代理服务器，这样浏览器扩展才能直接使用 127.0.0.1:6806，不用配置端口
		proxy := httputil.NewSingleHostReverseProxy(util.ServerURL)

		if useTLS {
			proxy.Transport = &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			}

			logging.LogInfof("fixed port service [%s] is running (HTTP/HTTPS dual mode)", addr)

			ln, err := net.Listen("tcp", addr)
			if err != nil {
				logging.LogWarnf("boot fixed port service [%s] failed: %s", addr, err)
				return
			}

			m := cmux.New(ln)

			// Match TLS connections (first byte 0x16 indicates TLS handshake)
			tlsL := m.Match(cmux.TLS())
			// Match HTTP (anything else)
			httpL := m.Match(cmux.Any())

			cert, err := tls.LoadX509KeyPair(certPath, keyPath)
			if err != nil {
				logging.LogWarnf("failed to load TLS cert for fixed port service: %s", err)
				ln.Close()
				return
			}
			tlsConfig := &tls.Config{Certificates: []tls.Certificate{cert}}

			tlsListener := tls.NewListener(tlsL, tlsConfig)

			go func() {
				httpServer := &http.Server{Handler: proxy}
				if err := httpServer.Serve(httpL); err != nil && err != cmux.ErrListenerClosed {
					logging.LogWarnf("fixed port HTTP server error: %s", err)
				}
			}()

			go func() {
				httpsServer := &http.Server{Handler: proxy}
				if err := httpsServer.Serve(tlsListener); err != nil && err != cmux.ErrListenerClosed {
					logging.LogWarnf("fixed port HTTPS server error: %s", err)
				}
			}()

			if err := m.Serve(); err != nil && err != cmux.ErrListenerClosed {
				logging.LogWarnf("fixed port cmux serve error: %s", err)
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
