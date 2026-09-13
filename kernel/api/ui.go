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
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance)

	return apicontract.Success(apicontract.Null{})
})

var reloadTheme = contractHandler(apicontract.ReloadTheme, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {

	model.LoadThemes()
	util.BroadcastByType("main", "setAppearance", 0, "", model.Conf.Appearance)

	return apicontract.Success(apicontract.Null{})
})
