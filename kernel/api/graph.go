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
	"net/http"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func resetGraph(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	graph := conf.NewGlobalGraph()
	model.Conf.Graph.Global = graph
	model.Conf.Save()
	ret.Data = map[string]interface{}{
		"conf": graph,
	}
}

func resetLocalGraph(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	graph := conf.NewLocalGraph()
	model.Conf.Graph.Local = graph
	model.Conf.Save()
	ret.Data = map[string]interface{}{
		"conf": graph,
	}
}

func getGraph(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	reqId := arg["reqId"]
	ret.Data = map[string]interface{}{"reqId": reqId}

	var query string
	var confArg map[string]any
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("k", true, &query),
		util.BindJsonArg("conf", true, &confArg),
	) {
		return
	}
	graphConf, err := gulu.JSON.MarshalJSON(confArg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	global := conf.NewGlobalGraph()
	if err = gulu.JSON.UnmarshalJSON(graphConf, global); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.Conf.Graph.Global = global
	model.Conf.Save()

	boxID, nodes, links := model.BuildGraph(query)
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		publishIgnore := model.GetInvisiblePublishAccess(publishAccess)
		nodes, links = model.FilterGraphByPublishIgnore(publishIgnore, nodes, links)
	}
	ret.Data = map[string]interface{}{
		"nodes": nodes,
		"links": links,
		"conf":  global,
		"box":   boxID,
		"reqId": arg["reqId"],
	}
	util.RandomSleep(200, 500)
}

func getLocalGraph(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	reqId := arg["reqId"]
	ret.Data = map[string]interface{}{"reqId": reqId}
	if nil == arg["id"] {
		return
	}

	var keyword, id string
	var confArg map[string]any
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("k", true, &keyword),
		util.BindJsonArg("id", true, &id),
		util.BindJsonArg("conf", true, &confArg),
	) {
		return
	}

	graphConf, err := gulu.JSON.MarshalJSON(confArg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	local := conf.NewLocalGraph()
	if err = gulu.JSON.UnmarshalJSON(graphConf, local); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.Conf.Graph.Local = local
	model.Conf.Save()

	boxID, nodes, links := model.BuildTreeGraph(id, keyword)
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		publishIgnore := model.GetInvisiblePublishAccess(publishAccess)
		nodes, links = model.FilterGraphByPublishIgnore(publishIgnore, nodes, links)
	}
	ret.Data = map[string]interface{}{
		"id":    id,
		"box":   boxID,
		"nodes": nodes,
		"links": links,
		"conf":  local,
		"reqId": arg["reqId"],
	}
	util.RandomSleep(200, 500)
}
