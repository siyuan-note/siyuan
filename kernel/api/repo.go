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
	"os"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
		ret.Msg = model.Conf.Language(137)
		return
	}
}

func initRepoKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	util.PushMsg(model.Conf.Language(136), 1000*7)
	if err := os.RemoveAll(model.Conf.Repo.GetSaveDir()); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err := os.MkdirAll(model.Conf.Repo.GetSaveDir(), 0755); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err := model.InitRepoKey(); nil != err {
		ret.Code = -1
		ret.Msg = model.Conf.Language(137)
		return
	}

	time.Sleep(1 * time.Second)
	util.PushMsg(model.Conf.Language(138), 3000)
}
