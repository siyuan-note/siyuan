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
	"strings"
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
	if err != nil {
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

	timestamp := int64(arg["reqId"].(float64))
	var transactions []*model.Transaction
	if err = gulu.JSON.UnmarshalJSON(data, &transactions); err != nil {
		ret.Code = -1
		ret.Msg = "parses request failed"
		return
	}
	for _, transaction := range transactions {
		transaction.Timestamp = timestamp
	}

	model.PerformTransactions(&transactions)

	ret.Data = transactions

	app := arg["app"].(string)
	session := arg["session"].(string)
	pushTransactions(app, session, transactions)

	if model.IsMoveOutlineHeading(&transactions) {
		if retData := transactions[0].DoOperations[0].RetData; nil != retData {
			util.PushReloadDoc(retData.(string))
		}
	}

	elapsed := time.Now().Sub(start).Milliseconds()
	c.Header("Server-Timing", fmt.Sprintf("total;dur=%d", elapsed))
}

func pushTransactions(app, session string, transactions []*model.Transaction) {
	pushMode := util.PushModeBroadcastExcludeSelf
	if 0 < len(transactions) && 0 < len(transactions[0].DoOperations) {
		model.WaitForWritingFiles() // 等待文件写入完成，后续渲染才能读取到最新的数据

		action := transactions[0].DoOperations[0].Action
		isAttrViewTx := strings.Contains(strings.ToLower(action), "attrview")
		if isAttrViewTx && "setAttrViewName" != action {
			pushMode = util.PushModeBroadcast
		}
	}

	evt := util.NewCmdResult("transactions", 0, pushMode)
	evt.AppId = app
	evt.SessionId = session
	evt.Data = transactions
	for _, tx := range transactions {
		tx.WaitForCommit()
	}
	util.PushEvent(evt)
}
