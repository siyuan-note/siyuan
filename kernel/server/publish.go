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

package server

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"strconv"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
)

type Transport struct{}

var (
	host = "0.0.0.0"
	port = "0"

	listener  net.Listener
	transport = Transport{}
)

func StartPublishServe() {
	var err error

	if !model.Conf.Publish.Enable {
		return
	}

	// Close previous listener
	if listener != nil {
		if err = listener.Close(); err != nil {
			logging.LogErrorf("close listener failed: %s", err)
		}
	}

	// Start new listener
	listener, err = net.Listen("tcp", fmt.Sprintf("%s:%d", host, model.Conf.Publish.Port))
	if err != nil {
		logging.LogErrorf("start listener failed: %s", err)
		return
	}

	_, port, err = net.SplitHostPort(listener.Addr().String())
	if nil != err {
		logging.LogErrorf("split host and port failed: %s", err)
	}

	model.InitAccounts()

	proxy := &httputil.ReverseProxy{
		Rewrite:   rewrite,
		Transport: transport,
	}

	logging.LogInfof("reverse proxy server [%s] is booting", host+":"+port)
	if err = http.Serve(listener, proxy); nil != err {
		logging.LogErrorf("boot publish serve failed: %s", err)
	}
}

func rewrite(r *httputil.ProxyRequest) {
	r.SetURL(ServerURL)
	r.SetXForwarded()
	// r.Out.Host = r.In.Host // if desired
}

func (Transport) RoundTrip(request *http.Request) (response *http.Response, err error) {
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
