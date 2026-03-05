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

package api

import (
	"net/http"
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func sendDeviceNotification(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	if util.ContainerAndroid != util.Container {
		ret.Code = -1
		ret.Msg = "Just support Android"
		return
	}

	var channel string
	if nil != arg["channel"] {
		channel = strings.TrimSpace(arg["channel"].(string))
	} else {
		channel = "SiYuan Notifications"
	}

	var title string
	if nil != arg["title"] {
		title = strings.TrimSpace(arg["title"].(string))
	} else {
		ret.Code = -1
		ret.Msg = "title can't be empty"
		return
	}

	var body string
	if nil != arg["body"] {
		body = strings.TrimSpace(arg["body"].(string))
	} else {
		ret.Code = -1
		ret.Msg = "body can't be empty"
		return
	}

	var delayInSeconds int
	if nil != arg["delayInSeconds"] {
		delayInSeconds = int(arg["delayInSeconds"].(float64))
	} else {
		delayInSeconds = 1
	}

	util.BroadcastByType("main", "sendDeviceNotification", 0, "", map[string]interface{}{
		"channel":        channel,
		"title":          title,
		"body":           body,
		"delayInSeconds": delayInSeconds,
	})
}

func pushMsg(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	msg := strings.TrimSpace(arg["msg"].(string))
	if "" == msg {
		ret.Code = -1
		ret.Msg = "msg can't be empty"
		return
	}

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
