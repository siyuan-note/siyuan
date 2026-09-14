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
