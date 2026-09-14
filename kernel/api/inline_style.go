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
	"github.com/siyuan-note/siyuan/kernel/apicontract"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getInlineStyles = contractHandler(apicontract.GetInlineStyles, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[*apicontract.InlineStyles] {
	ret := gulu.Ret.NewResult()

	styles, err := model.GetInlineStyles()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[*apicontract.InlineStyles](ret)
	}
	return apicontract.Success(inlineStylesContract(styles))
})

var setInlineStyles = contractHandler(apicontract.SetInlineStyles, func(c *gin.Context, request apicontract.SetInlineStylesRequest) apicontract.Response[*apicontract.InlineStyles] {
	ret := gulu.Ret.NewResult()

	app := request.App
	input := inlineStylesModel(&apicontract.InlineStyles{Version: int(request.Version), Styles: request.Styles, Builtin: request.Builtin, Order: request.Order, AV: request.AV})
	var saved *model.InlineStyles
	var changed bool
	var err error
	if request.Version == 1 {
		saved, changed, err = model.SetInlineStyles(input.Styles)
	} else {
		saved, changed, err = model.SetInlineStylesData(input)
	}
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[*apicontract.InlineStyles](ret)
	}
	if changed {
		evt := util.NewCmdResult("reloadInlineStyles", 0, util.PushModeBroadcastMainExcludeSelfApp)
		evt.AppId = app
		util.PushEvent(evt)
		util.ReloadPublishServiceSessions()
	}

	return apicontract.Success(inlineStylesContract(saved))
})

var setWorkspaceAVPalette = contractHandler(apicontract.SetWorkspaceAVPalette, func(c *gin.Context, request apicontract.WorkspaceAVPaletteRequest) apicontract.Response[*apicontract.InlineStyles] {
	ret := gulu.Ret.NewResult()

	app := request.App
	update := workspaceAVPaletteUpdateModel(&apicontract.WorkspaceAVPaletteUpdate{Colors: request.Colors, Order: request.Order, BuiltinColors: request.BuiltinColors})
	saved, changed, err := model.SetWorkspaceAVPalette(update)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[*apicontract.InlineStyles](ret)
	}
	if changed {
		evt := util.NewCmdResult("reloadInlineStyles", 0, util.PushModeBroadcastMainExcludeSelfApp)
		evt.AppId = app
		util.PushEvent(evt)
		util.ReloadPublishServiceSessions()
	}

	return apicontract.Success(inlineStylesContract(saved))
})
