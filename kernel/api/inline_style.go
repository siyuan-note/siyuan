// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getInlineStyles = contractHandler(apicontract.GetInlineStyles, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[*apicontract.InlineStyles] {

	styles, err := model.GetInlineStyles()
	if err != nil {
		return apicontract.Failure[*apicontract.InlineStyles](-1, err.Error())
	}
	return apicontract.Success(inlineStylesContract(styles))
})

var setInlineStyles = contractHandler(apicontract.SetInlineStyles, func(c *gin.Context, request apicontract.SetInlineStylesRequest) apicontract.Response[*apicontract.InlineStyles] {

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
		return apicontract.Failure[*apicontract.InlineStyles](-1, err.Error())
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

	app := request.App
	update := workspaceAVPaletteUpdateModel(&apicontract.WorkspaceAVPaletteUpdate{Colors: request.Colors, Order: request.Order, BuiltinColors: request.BuiltinColors})
	saved, changed, err := model.SetWorkspaceAVPalette(update)
	if err != nil {
		return apicontract.Failure[*apicontract.InlineStyles](-1, err.Error())
	}
	if changed {
		evt := util.NewCmdResult("reloadInlineStyles", 0, util.PushModeBroadcastMainExcludeSelfApp)
		evt.AppId = app
		util.PushEvent(evt)
		util.ReloadPublishServiceSessions()
	}

	return apicontract.Success(inlineStylesContract(saved))
})
