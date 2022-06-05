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

package api

import (
	"net/http"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func pushMsg(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	msg := arg["msg"].(string)
	timeout := 7000
	if nil != arg["timeout"] {
		timeout = int(arg["timeout"].(float64))
	}
	msgId := util.PushMsg(msg, timeout)

	ret.Data = map[string]interface{}{
		"id": msgId,
	}
}

func pushErrMsg(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	msg := arg["msg"].(string)
	timeout := 7000
	if nil != arg["timeout"] {
		timeout = int(arg["timeout"].(float64))
	}
	msgId := util.PushErrMsg(msg, timeout)

	ret.Data = map[string]interface{}{
		"id": msgId,
	}
}
