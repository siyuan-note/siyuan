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
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type PublishServiceTransport struct{}

var (
	Host = "0.0.0.0"
	Port = "0"

	listener  net.Listener
	server    *http.Server
	transport = PublishServiceTransport{}
)

func InitPublishService() (uint16, error) {
	model.InitAccounts()

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
	if server == nil {
		return
	}

	// 关闭所有发布服务的 WebSocket 连接
	util.ClosePublishServiceSessions()

	if err := server.Shutdown(context.Background()); err != nil {
		logging.LogErrorf("shutdown server failed: %s", err)
	}

	if err := server.Close(); err != nil {
		logging.LogErrorf("close server failed: %s", err)
	}
	server, listener = nil, nil
}

func startPublishReverseProxyService() {
	logging.LogInfof("publish service [%s:%s] is running", Host, Port)

	server = &http.Server{
		Handler: &httputil.ReverseProxy{
			Rewrite:   rewrite,
			Transport: transport,
		},
	}

	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logging.LogErrorf("boot publish service failed: %s", err)
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
					response, err = http.DefaultTransport.RoundTrip(request)
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
		response, err = http.DefaultTransport.RoundTrip(request)
		response.Header.Add("Set-Cookie", cookie.String())
		return
	}

	request.Header.Set(model.XAuthTokenKey, model.GetBasicAuthAccount("").Token)
	response, err = http.DefaultTransport.RoundTrip(request)
	return
}
