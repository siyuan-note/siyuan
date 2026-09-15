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
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var loadPetals = contractHandler(apicontract.LoadPetals, func(c *gin.Context, request apicontract.LoadPetalsRequest) apicontract.Response[[]*apicontract.Petal] {
	if model.IsReadOnlyRoleContext(c) {
		c.Header("Cache-Control", "private, no-store")
	}
	values := model.LoadPetals(request.Frontend, model.IsReadOnlyRoleContext(c))
	var result []*apicontract.Petal
	if values != nil {
		result = make([]*apicontract.Petal, len(values))
	}
	for i, value := range values {
		item, err := petalContract(value)
		if err != nil {
			return apicontract.Failure[[]*apicontract.Petal](-1, err.Error())
		}
		result[i] = item
	}
	return apicontract.Success(result)
})

var setPetalEnabled = contractHandler(apicontract.SetPetalEnabled, func(c *gin.Context, request apicontract.SetPetalEnabledRequest) apicontract.Response[*apicontract.Petal] {
	data, err := model.SetPetalEnabled(request.PackageName, request.Enabled)
	if err != nil {
		return apicontract.Failure[*apicontract.Petal](-1, err.Error())
	}
	if request.Enabled {
		reloadPluginSet := hashset.New(request.PackageName)
		model.PushReloadPlugin(nil, nil, reloadPluginSet, nil, request.App, "")
	} else {
		unloadPluginSet := hashset.New(request.PackageName)
		model.PushReloadPlugin(nil, unloadPluginSet, nil, nil, request.App, "")
	}
	result, err := petalContract(data)
	if err != nil {
		return apicontract.Failure[*apicontract.Petal](-1, err.Error())
	}
	return apicontract.Success(result)
})

var setPetalPublishEnabled = contractHandler(apicontract.SetPetalPublishEnabled, func(c *gin.Context, request apicontract.SetPetalPublishEnabledRequest) apicontract.Response[*apicontract.Petal] {
	data, err := model.SetPetalPublishEnabled(request.PackageName, request.Enabled)
	if err != nil {
		return apicontract.Failure[*apicontract.Petal](-1, err.Error())
	}
	util.ReloadPublishServiceSessions()
	result, err := petalContract(data)
	if err != nil {
		return apicontract.Failure[*apicontract.Petal](-1, err.Error())
	}
	return apicontract.Success(result)
})
