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
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/imroc/req/v3"
	"github.com/olahol/melody"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

func IsOnline(checkURL string, skipTlsVerify bool) bool {
	_, err := url.Parse(checkURL)
	if nil != err {
		logging.LogWarnf("invalid check URL [%s]", checkURL)
		return false
	}

	if "" == checkURL {
		return false
	}

	if isOnline(checkURL, skipTlsVerify) {
		return true
	}

	logging.LogWarnf("network is offline [checkURL=%s]", checkURL)
	return false
}

func isOnline(checkURL string, skipTlsVerify bool) (ret bool) {
	c := req.C().SetTimeout(3 * time.Second)
	if skipTlsVerify {
		c.EnableInsecureSkipVerify()
	}
	c.SetUserAgent(UserAgent)

	for i := 0; i < 3; i++ {
		resp, err := c.R().Get(checkURL)
		if resp.GetHeader("Location") != "" {
			return true
		}

		switch err.(type) {
		case *url.Error:
			if err.(*url.Error).URL != checkURL {
				// DNS 重定向
				logging.LogWarnf("network is online [DNS redirect, checkURL=%s, retURL=%s]", checkURL, err.(*url.Error).URL)
				return true
			}
		}

		ret = nil == err
		if ret {
			break
		}

		time.Sleep(1 * time.Second)
		logging.LogWarnf("check url [%s] is online failed: %s", checkURL, err)
	}
	return
}

func GetRemoteAddr(session *melody.Session) string {
	ret := session.Request.Header.Get("X-forwarded-for")
	ret = strings.TrimSpace(ret)
	if "" == ret {
		ret = session.Request.Header.Get("X-Real-IP")
	}
	ret = strings.TrimSpace(ret)
	if "" == ret {
		return session.Request.RemoteAddr
	}
	return strings.Split(ret, ",")[0]
}

func JsonArg(c *gin.Context, result *gulu.Result) (arg map[string]interface{}, ok bool) {
	arg = map[string]interface{}{}
	if err := c.BindJSON(&arg); nil != err {
		result.Code = -1
		result.Msg = "parses request failed"
		return
	}

	ok = true
	return
}

func InvalidIDPattern(idArg string, result *gulu.Result) bool {
	if ast.IsNodeIDPattern(idArg) {
		return false
	}

	result.Code = -1
	result.Msg = "invalid ID argument"
	return true
}

func IsValidURL(str string) bool {
	_, err := url.Parse(str)
	return nil == err
}

func initHttpClient() {
	http.DefaultClient = httpclient.GetCloudFileClient2Min()
	http.DefaultTransport = httpclient.NewTransport(false)
}
