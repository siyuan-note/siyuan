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
	"encoding/hex"
	"net/http"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getRepoFile(c *gin.Context) {

}

func checkoutRepo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if err := model.CheckoutRepo(id); nil != err {
		ret.Code = -1
		ret.Msg = model.Conf.Language(141)
		return
	}
}

func getRepoIndexLogs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	page := arg["page"].(float64)
	logs, err := model.GetRepoIndexLogs(int(page))
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]interface{}{
		"logs": logs,
	}
}

func indexRepo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	message := arg["message"].(string)
	if err := model.IndexRepo(message); nil != err {
		ret.Code = -1
		ret.Msg = model.Conf.Language(140)
		return
	}
}

func importRepoKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	msgId := util.PushMsg(model.Conf.Language(136), 1000*7)
	hexKey := arg["key"].(string)
	if err := model.ImportRepoKey(hexKey); nil != err {
		ret.Code = -1
		ret.Msg = model.Conf.Language(137)
		return
	}
	time.Sleep(1 * time.Second)
	util.PushUpdateMsg(msgId, model.Conf.Language(138), 3000)
}

func initRepoKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	msgId := util.PushMsg(model.Conf.Language(136), 1000*7)
	if err := model.InitRepoKey(); nil != err {
		ret.Code = -1
		ret.Msg = model.Conf.Language(137)
		return
	}

	time.Sleep(1 * time.Second)
	util.PushUpdateMsg(msgId, model.Conf.Language(138), 3000)

	ret.Data = map[string]interface{}{
		"key": hex.EncodeToString(model.Conf.Repo.Key),
	}
}
