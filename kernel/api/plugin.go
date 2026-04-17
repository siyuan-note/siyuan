// SiYuan - Refactor your thinking
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
	"net/http"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/plugin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func listLoadedPlugins(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = plugin.GetManager().GetLoadedPluginsInfo()
}

func getLoadedPluginInfo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	pluginName := util.GetRequestStringParam(c, "name", ret)
	if pluginName == "" {
		ret.Code = -10
		ret.Msg = "Plugin name is required"
		return
	}

	pluginInfo, found := plugin.GetManager().GetLoadedPlugin(pluginName)
	if !found {
		ret.Code = -11
		ret.Msg = fmt.Sprintf("Plugin [%s] not loaded", pluginName)
		return
	}

	ret.Data = pluginInfo
}

func pluginJsonRpcCall(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	// TODO
}
