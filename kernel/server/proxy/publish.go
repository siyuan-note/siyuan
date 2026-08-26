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
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
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

	handler := newPublishReverseProxy(util.ServerURL, transport)

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

func newPublishReverseProxy(target *url.URL, roundTripper http.RoundTripper) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(target)
			request.Out.Host = request.In.Host
			request.SetXForwarded()
		},
		Transport: roundTripper,
	}
}

// publishAuthRejectResponse 构造发布服务认证拒绝响应，retryAfter 大于 0 时附加 Retry-After 头。
func publishAuthRejectResponse(request *http.Request, statusCode, retryAfter int) *http.Response {
	header := http.Header{
		model.BasicAuthHeaderKey: {model.BasicAuthHeaderValue},
	}
	if 0 < retryAfter {
		header.Set("Retry-After", strconv.Itoa(retryAfter))
	}
	return &http.Response{
		StatusCode:    statusCode,
		Status:        http.StatusText(statusCode),
		Proto:         request.Proto,
		ProtoMajor:    request.ProtoMajor,
		ProtoMinor:    request.ProtoMinor,
		Request:       request,
		Header:        header,
		Body:          http.NoBody,
		Close:         false,
		ContentLength: -1,
	}
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
		if !ok || "" == username {
			// 未提供凭据，返回 401 提示输入，不计入失败次数
			return publishAuthRejectResponse(request, http.StatusUnauthorized, 0), nil
		}

		// 按来源 IP 限流，防止暴力破解与限流记录无限增长 https://github.com/siyuan-note/siyuan/security/advisories/GHSA-2x7j-p79w-7744
		ip := util.GetRemoteAddr(request)
		if retryAfter := util.AuthThrottleCheck(ip); 0 < retryAfter {
			// 锁定期间持续记录失败，以延长锁定时间
			util.AuthThrottleFail(ip)
			logging.LogWarnf("publish service auth throttled [ip=%s, username=%s]", ip, username)
			return publishAuthRejectResponse(request, http.StatusTooManyRequests, retryAfter), nil
		}

		account := model.GetBasicAuthAccount(username)
		if account == nil ||
			"" == account.Username || // 匿名用户
			!util.AuthCodeEquals(account.Password, password) { // 恒定时间比较，避免时序侧信道 https://github.com/siyuan-note/siyuan/security/advisories/GHSA-phg7-xcr4-q5wg
			util.AuthThrottleFail(ip)
			return publishAuthRejectResponse(request, http.StatusUnauthorized, 0), nil
		}
		util.AuthThrottleReset(ip)

		// set session cookie，同一账户已有有效会话时复用其 ID，避免重复认证导致会话无限增长
		sessionID := model.AddSession(username)
		cookie := &http.Cookie{
			Name:     model.SessionIdCookieName,
			Value:    sessionID,
			Path:     "/",
			HttpOnly: true,
		}

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
