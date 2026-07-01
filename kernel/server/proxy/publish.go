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
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/soheilhy/cmux"
)

type PublishServiceTransport struct{}

var (
	Host = "0.0.0.0"
	Port = "0"

	listener            net.Listener
	httpServer          *http.Server
	httpsServer         *http.Server
	transport           = PublishServiceTransport{}
	publishRoundTripper = &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
)

func InitPublishService() (uint16, error) {
	model.InitPublishAccounts()

	if listener != nil {
		if !model.Conf.Publish.Enable {
			closePublishListener()
			return 0, nil
		}

		if port, err := util.ParsePort(Port); err != nil {
			return 0, err
		} else if port != model.Conf.Publish.Port {
			closePublishListener()
			initPublishService()
		}
	} else {
		if !model.Conf.Publish.Enable {
			return 0, nil
		}

		// 启动新端口的发布服务
		initPublishService()
	}
	return util.ParsePort(Port)
}

func initPublishService() {
	if err := initPublishListener(); err == nil {
		go startPublishReverseProxyService()
	}
}

func initPublishListener() (err error) {
	listener, err = net.Listen("tcp", fmt.Sprintf("%s:%d", Host, model.Conf.Publish.Port))
	if err != nil {
		logging.LogErrorf("start listener failed: %s", err)
		return
	}

	_, Port, err = net.SplitHostPort(listener.Addr().String())
	if err != nil {
		logging.LogErrorf("split host and port failed: %s", err)
		return
	}
	return
}

func closePublishListener() {
	if listener == nil {
		return
	}

	util.ClosePublishServiceSessions()

	// 先关闭监听器，停止接收新连接
	if err := listener.Close(); err != nil {
		logging.LogErrorf("close publish listener failed: %s", err)
	}

	// 再关闭已建立的活跃连接（含 HTTP/2 长连接），否则浏览器会复用旧连接
	// 继续访问到已关闭发布服务的工作空间内核。HTTP 与 HTTPS 各自独立，需分别关闭。
	for _, srv := range []*http.Server{httpServer, httpsServer} {
		if srv == nil {
			continue
		}

		// Shutdown 优雅关闭：等待活跃请求处理完毕（最多 5 秒），并触发 keep-alive/HTTP2 连接断开
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := srv.Shutdown(ctx); err != nil {
			logging.LogErrorf("shutdown publish server failed: %s", err)
		}
		cancel()

		// Close 强制关闭所有残留连接，确保端口和连接彻底释放
		if err := srv.Close(); err != nil {
			logging.LogErrorf("close publish server failed: %s", err)
		}
	}
	httpServer, httpsServer, listener = nil, nil, nil
}

func startPublishReverseProxyService() {
	logging.LogInfof("publish service [%s:%s] is running", Host, Port)

	handler := &httputil.ReverseProxy{
		Rewrite:   rewrite,
		Transport: transport,
	}

	certPath, keyPath, certErr := util.GetOrCreateTLSCert()
	if certErr == nil && "" != certPath {
		// 提前创建 HTTP/HTTPS 各自的 *http.Server 并传入，这样在服务运行期间就能持有它们的引用，
		// closePublishListener 调用其 Shutdown/Close 时才能关闭已建立的活跃连接（含 HTTP/2 长连接），
		// 避免切换工作空间后旧连接仍被旧内核接管。
		httpServer = &http.Server{Handler: handler}
		httpsServer = &http.Server{Handler: handler}
		if _, _, serveErr := util.ServeMultiplexed(listener, handler, certPath, keyPath, httpServer, httpsServer); serveErr != nil {
			if !errors.Is(serveErr, cmux.ErrListenerClosed) && !errors.Is(serveErr, http.ErrServerClosed) {
				logging.LogErrorf("publish service failed: %s", serveErr)
			}
		}
	} else {
		httpServer = &http.Server{Handler: handler}
		if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logging.LogErrorf("boot publish service failed: %s", err)
		}
	}

	logging.LogInfof("publish service [%s:%s] is stopped", Host, Port)
}

func rewrite(r *httputil.ProxyRequest) {
	r.SetURL(util.ServerURL)
	r.SetXForwarded()
	// r.Out.Host = r.In.Host // if desired
}

func (PublishServiceTransport) RoundTrip(request *http.Request) (response *http.Response, err error) {
	if model.Conf.Publish.Auth.Enable {
		// Session Auth
		sessionIdCookie, cookieErr := request.Cookie(model.SessionIdCookieName)
		if cookieErr == nil {
			// Check session ID
			sessionID := sessionIdCookie.Value
			if username := model.GetBasicAuthUsernameBySessionID(sessionID); username != "" {
				// Valid session
				if account := model.GetBasicAuthAccount(username); account != nil {
					// Valid account
					request.Header.Set(model.XAuthTokenKey, account.Token)
					response, err = publishRoundTripper.RoundTrip(request)
					return
				}

				// Invalid account, remove session
				model.DeleteSession(sessionID)
			}
		}

		// Basic Auth
		username, password, ok := request.BasicAuth()
		account := model.GetBasicAuthAccount(username)
		if !ok ||
			account == nil ||
			account.Username == "" || // 匿名用户
			account.Password != password {

			return &http.Response{
				StatusCode: http.StatusUnauthorized,
				Status:     http.StatusText(http.StatusUnauthorized),
				Proto:      request.Proto,
				ProtoMajor: request.ProtoMajor,
				ProtoMinor: request.ProtoMinor,
				Request:    request,
				Header: http.Header{
					model.BasicAuthHeaderKey: {model.BasicAuthHeaderValue},
				},
				Body:          http.NoBody,
				Close:         false,
				ContentLength: -1,
			}, nil
		}

		// set session cookie
		sessionID := model.GetNewSessionID()
		cookie := &http.Cookie{
			Name:     model.SessionIdCookieName,
			Value:    sessionID,
			Path:     "/",
			HttpOnly: true,
		}
		model.AddSession(sessionID, username)

		// set JWT
		request.Header.Set(model.XAuthTokenKey, account.Token)
		response, err = publishRoundTripper.RoundTrip(request)
		response.Header.Add("Set-Cookie", cookie.String())
		return
	}

	request.Header.Set(model.XAuthTokenKey, model.GetBasicAuthAccount("").Token)
	response, err = publishRoundTripper.RoundTrip(request)
	return
}
