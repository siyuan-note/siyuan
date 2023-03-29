// SiYuan - Build Your Eternal Digital Garden
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

func IsOnline() (ret bool) {
	c := req.C().SetTimeout(1 * time.Second)
	resp, err := c.R().Head("https://www.baidu.com")
	if nil != err {
		resp, err = c.R().Head("https://icanhazip.com")
		if nil != err {
			resp, err = c.R().Head("https://api.ipify.org")
		}
	}

	ret = nil == err && nil != resp && nil != resp.Response
	if !ret {
		logging.LogWarnf("network is offline: %v", err)
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
