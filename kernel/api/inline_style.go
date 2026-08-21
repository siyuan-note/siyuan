// SiYuan - From thought to insight, with agents
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
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getInlineStyles(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	styles, err := model.GetInlineStyles()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = styles
}

func setInlineStyles(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	var stylesArg []any
	var version float64
	var app string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("version", &version, true, false),
		util.BindJsonArg("styles", &stylesArg, true, false),
		util.BindJsonArg("app", &app, false, false),
	) {
		return
	}
	if version != model.InlineStylesVersion {
		ret.Code = -1
		ret.Msg = "unsupported inline styles version"
		return
	}

	data, err := gulu.JSON.MarshalJSON(stylesArg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	styles := []*model.InlineStyle{}
	if err = gulu.JSON.UnmarshalJSON(data, &styles); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	saved, changed, err := model.SetInlineStyles(styles)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = saved
	if changed {
		evt := util.NewCmdResult("reloadInlineStyles", 0, util.PushModeBroadcastMainExcludeSelfApp)
		evt.AppId = app
		util.PushEvent(evt)
		util.ReloadPublishServiceSessions()
	}
}
