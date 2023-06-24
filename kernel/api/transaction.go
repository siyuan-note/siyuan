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
	"fmt"
	"net/http"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func performTransactions(c *gin.Context) {
	start := time.Now()
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	trans := arg["transactions"]
	data, err := gulu.JSON.MarshalJSON(trans)
	if nil != err {
		ret.Code = -1
		ret.Msg = "parses request failed"
		return
	}

	if !util.IsBooted() {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(74), int(util.GetBootProgress()))
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	var transactions []*model.Transaction
	if err = gulu.JSON.UnmarshalJSON(data, &transactions); nil != err {
		ret.Code = -1
		ret.Msg = "parses request failed"
		return
	}

	model.PerformTransactions(&transactions)

	ret.Data = transactions

	app := arg["app"].(string)
	session := arg["session"].(string)
	if model.IsFoldHeading(&transactions) || model.IsUnfoldHeading(&transactions) {
		model.WaitForWritingFiles()
	}
	pushTransactions(app, session, transactions)

	elapsed := time.Now().Sub(start).Milliseconds()
	c.Header("Server-Timing", fmt.Sprintf("total;dur=%d", elapsed))
}

func pushTransactions(app, session string, transactions []*model.Transaction) {
	evt := util.NewCmdResult("transactions", 0, util.PushModeBroadcastExcludeSelf)
	evt.AppId = app
	evt.SessionId = session
	evt.Data = transactions
	util.PushEvent(evt)
}
