// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var pandoc = contractHandler(apicontract.Pandoc, func(c *gin.Context, request apicontract.PandocRequest) apicontract.Response[apicontract.PandocData] {
	dirStr := request.Dir

	var dir string
	if dirStr != "" {
		dir = dirStr
	} else {
		dir = gulu.Rand.String(7)
	}
	path, err := util.ConvertPandoc(dir, request.Args...)
	if err != nil {
		return apicontract.Failure[apicontract.PandocData](-1, err.Error())
	}

	return apicontract.Success(apicontract.PandocData{Path: path})
})
