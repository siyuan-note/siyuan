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
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/plugin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var listLoadedPlugins = contractHandler(apicontract.ListLoadedPlugins, loadedPluginsResponse)
var listLoadedPluginsGET = contractHandler(apicontract.ListLoadedPluginsGET, loadedPluginsResponse)
var getLoadedPlugin = contractHandler(apicontract.GetLoadedPlugin, loadedPluginResponse, loadedPluginURLResponse)
var getLoadedPluginRPC = contractHandler(apicontract.GetLoadedPluginRPC, loadedPluginResponse, loadedPluginURLResponse)
var getLoadedPluginRPCByName = contractHandler(apicontract.GetLoadedPluginRPCByName, loadedPluginResponse, loadedPluginURLResponse)

func loadedPluginsResponse(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[[]*apicontract.LoadedPlugin] {
	values := plugin.GetManager().GetLoadedPluginsInfo()
	var result []*apicontract.LoadedPlugin
	if values != nil {
		result = make([]*apicontract.LoadedPlugin, len(values))
		for i, value := range values {
			result[i] = loadedPluginContract(value)
		}
	}
	return apicontract.Success(result)
}

func loadedPluginContract(value *plugin.PluginInfo) *apicontract.LoadedPlugin {
	if value == nil {
		return nil
	}
	var methods []*apicontract.PluginRPCMethod
	if value.Methods != nil {
		methods = make([]*apicontract.PluginRPCMethod, len(value.Methods))
		for i, method := range value.Methods {
			methods[i] = (*apicontract.PluginRPCMethod)(method)
		}
	}
	return &apicontract.LoadedPlugin{Name: value.Name, State: value.State, StateCode: value.StateCode, Methods: methods}
}

// 路径和查询参数优先于请求体，命中时不解析请求体。
func loadedPluginURLResponse(c *gin.Context) *apicontract.Response[*apicontract.LoadedPlugin] {
	if name := util.GetRequestUrlStringParam(c, "name"); name != "" {
		response := loadedPluginResponse(c, apicontract.LoadedPluginRequest{Name: name})
		return &response
	}
	return nil
}

func loadedPluginResponse(c *gin.Context, request apicontract.LoadedPluginRequest) apicontract.Response[*apicontract.LoadedPlugin] {
	if request.Name == "" {
		return apicontract.Failure[*apicontract.LoadedPlugin](3, "Plugin name is required")
	}
	value, found := plugin.GetManager().GetLoadedPlugin(request.Name)
	if !found {
		return apicontract.Failure[*apicontract.LoadedPlugin](4, fmt.Sprintf("Plugin [%s] not loaded", request.Name))
	}
	return apicontract.Success(loadedPluginContract(value))
}

var pluginJsonRpcHttp = contractHandler(apicontract.PluginRPCHTTP, plugin.DispatchRPCContract, plugin.PrepareRPCContract)
var pluginJsonRpcHttpByName = contractHandler(apicontract.PluginRPCHTTPByName, plugin.DispatchRPCContract, plugin.PrepareRPCContract)

var pluginJsonRpcWebSocket = contractHandler(apicontract.PluginRPCWebSocket, plugin.OpenRPCWebSocket)
var pluginJsonRpcWebSocketByName = contractHandler(apicontract.PluginRPCWebSocketByName, plugin.OpenRPCWebSocket)

var pluginPrivateWebServer = contractHandler(apicontract.PluginPrivateService, plugin.PreparePrivateService)
