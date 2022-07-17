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
	"net"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/melody"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
)

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

func isPortOpen(port string) bool {
	timeout := time.Second
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", port), timeout)
	if nil != err {
		return false
	}
	if nil != conn {
		conn.Close()
		return true
	}
	return false
}

func tryToListenPort() bool {
	listener, err := net.Listen("tcp", "127.0.0.1:"+ServerPort)
	if nil != err {
		time.Sleep(time.Second * 3)
		listener, err = net.Listen("tcp", "127.0.0.1:"+ServerPort)
		if nil != err {
			logging.LogErrorf("try to listen port [%s] failed: %s", ServerPort, err)
			return false
		}
	}
	if err = listener.Close(); nil != err {
		time.Sleep(time.Second * 1)
		if err = listener.Close(); nil != err {
			logging.LogErrorf("close listen port [%s] failed: %s", ServerPort, err)
		}
	}
	return true
}
