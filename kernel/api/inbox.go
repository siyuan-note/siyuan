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
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var removeShorthands = contractHandler(apicontract.RemoveShorthands, func(c *gin.Context, request apicontract.RemoveShorthandsRequest) apicontract.Response[apicontract.Null] {
	var ids []string
	ids = append(ids, request.IDs...)
	if err := model.RemoveCloudShorthands(ids); err != nil {
		return apicontract.Failure[apicontract.Null](1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var getShorthand = contractHandler(apicontract.GetShorthand, func(c *gin.Context, request apicontract.TrimmedIDRequest) apicontract.Response[*apicontract.Shorthand] {
	data, err := model.GetCloudShorthand(request.ID)
	if err != nil {
		return apicontract.Failure[*apicontract.Shorthand](1, err.Error())
	}
	result, err := decodeCloudInbox[apicontract.Shorthand](data)
	if err != nil {
		return apicontract.Failure[*apicontract.Shorthand](1, err.Error())
	}
	return apicontract.Success(result)
})

var getShorthands = contractHandler(apicontract.GetShorthands, func(c *gin.Context, request apicontract.ShorthandsRequest) apicontract.Response[*apicontract.ShorthandsData] {
	data, err := model.GetCloudShorthands(int(request.Page))
	if err != nil {
		return apicontract.Failure[*apicontract.ShorthandsData](1, err.Error())
	}
	result, err := decodeCloudInbox[apicontract.ShorthandsData](data)
	if err != nil {
		return apicontract.Failure[*apicontract.ShorthandsData](1, err.Error())
	}
	return apicontract.Success(result)
})
