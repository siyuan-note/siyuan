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

var reloadTag = contractHandler(apicontract.ReloadTag, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {

	model.ReloadTag()

	return apicontract.Success(apicontract.Null{})
})

var reloadFiletree = contractHandler(apicontract.ReloadFiletree, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {

	model.ReloadFiletree()

	return apicontract.Success(apicontract.Null{})
})

var reloadProtyle = contractHandler(apicontract.ReloadProtyle, func(c *gin.Context, request apicontract.BlockIDRequest) apicontract.Response[apicontract.Null] {

	id := request.ID
	model.ReloadProtyle(id)

	return apicontract.Success(apicontract.Null{})
})

var reloadAttributeView = contractHandler(apicontract.ReloadAttributeView, func(c *gin.Context, request apicontract.BlockIDRequest) apicontract.Response[apicontract.Null] {

	id := request.ID
	model.ReloadAttrView(id)

	return apicontract.Success(apicontract.Null{})
})

var reloadUI = contractHandler(apicontract.ReloadUI, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {

	util.ReloadUI()

	return apicontract.Success(apicontract.Null{})
})

var reloadIcon = contractHandler(apicontract.ReloadIcon, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {

	model.LoadIcons()
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance.Load())

	return apicontract.Success(apicontract.Null{})
})

var reloadTheme = contractHandler(apicontract.ReloadTheme, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {

	model.LoadThemes()
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance.Load())

	return apicontract.Success(apicontract.Null{})
})
