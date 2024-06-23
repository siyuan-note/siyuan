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
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"strconv"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type PublishServiceTransport struct{}

var (
	Host = "0.0.0.0"
	Port = "0"

	listener  net.Listener
	transport = PublishServiceTransport{}
	proxy     = &httputil.ReverseProxy{
		Rewrite:   rewrite,
		Transport: transport,
	}
)

func InitPublishService() (uint16, error) {
	model.InitAccounts()

	if listener != nil {
		if !model.Conf.Publish.Enable {
			// 关闭发布服务
			closePublishListener()
			return 0, nil
		}

		if port, err := util.ParsePort(Port); err != nil {
			return 0, err
		} else if port != model.Conf.Publish.Port {
			// 关闭原端口的发布服务
			if err = closePublishListener(); err != nil {
				return 0, err
			}

			// 重新启动新端口的发布服务
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

func initPublishService() (err error) {
	if err = initPublishListener(); err == nil {
		go startPublishReverseProxyService()
	}
	return
}

func initPublishListener() (err error) {
	// Start new listener
	listener, err = net.Listen("tcp", fmt.Sprintf("%s:%d", Host, model.Conf.Publish.Port))
	if err != nil {
		logging.LogErrorf("start listener failed: %s", err)
		return
	}

	_, Port, err = net.SplitHostPort(listener.Addr().String())
	if nil != err {
		logging.LogErrorf("split host and port failed: %s", err)
		return
	}
	return
}

func closePublishListener() (err error) {
	listener_ := listener
	listener = nil
	if err = listener_.Close(); err != nil {
		logging.LogErrorf("close listener %s failed: %s", listener_.Addr().String(), err)
		listener = listener_
	}
	return
}

func startPublishReverseProxyService() {
	logging.LogInfof("publish service [%s:%s] is running", Host, Port)
	// 服务进行时一直阻塞
	if err := http.Serve(listener, proxy); nil != err {
		if listener != nil {
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
					"WWW-Authenticate": {"Basic realm=" + strconv.Quote("Authorization Required")},
				},
				Close:         false,
				ContentLength: -1,
			}, nil
		} else {
			// set JWT
			request.Header.Set(model.XAuthTokenKey, account.Token)
		}
	} else {
		request.Header.Set(model.XAuthTokenKey, model.GetBasicAuthAccount("").Token)
	}

	response, err = http.DefaultTransport.RoundTrip(request)
	return
}
