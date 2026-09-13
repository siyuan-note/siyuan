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
	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

var resetGraph = contractHandler(apicontract.ResetGraph, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.ResetGraphData] {
	graph := conf.NewGlobalGraph()
	model.Conf.Graph.Global = graph
	model.Conf.Save()
	return apicontract.Success(apicontract.ResetGraphData{Conf: globalGraphContract(graph)})
})

var resetLocalGraph = contractHandler(apicontract.ResetLocalGraph, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.ResetLocalGraphData] {
	graph := conf.NewLocalGraph()
	model.Conf.Graph.Local = graph
	model.Conf.Save()
	return apicontract.Success(apicontract.ResetLocalGraphData{Conf: localGraphContract(graph)})
})

func globalGraphContract(graph *conf.GlobalGraph) apicontract.GlobalGraphConf {
	return apicontract.GlobalGraphConf{MinRefs: graph.MinRefs, DailyNote: graph.DailyNote, Type: (*apicontract.GraphTypeFilter)(graph.TypeFilter), D3: (*apicontract.GraphD3)(graph.D3)}
}

func localGraphContract(graph *conf.LocalGraph) apicontract.LocalGraphConf {
	return apicontract.LocalGraphConf{DailyNote: graph.DailyNote, Type: (*apicontract.GraphTypeFilter)(graph.TypeFilter), D3: (*apicontract.GraphD3)(graph.D3)}
}

var setGraphConf = contractHandler(apicontract.SetGraphConf, func(c *gin.Context, request apicontract.SetGraphConfRequest) apicontract.Response[apicontract.GraphConfigurationData] {
	graphType := request.Type
	graphConf, err := gulu.JSON.MarshalJSON(request.Conf)
	if err != nil {
		return apicontract.Failure[apicontract.GraphConfigurationData](-1, err.Error())
	}
	switch graphType {
	case "global":
		global := conf.NewGlobalGraph()
		if err = gulu.JSON.UnmarshalJSON(graphConf, global); err != nil {
			return apicontract.Failure[apicontract.GraphConfigurationData](-1, err.Error())
		}
		if model.IsAdminRoleContext(c) && !model.IsReadOnlyRoleContext(c) {
			model.Conf.Graph.Global = global
			model.Conf.Save()
		}
		return apicontract.Success(apicontract.GlobalGraphConfiguration(globalGraphContract(global)))
	case "local":
		local := conf.NewLocalGraph()
		if err = gulu.JSON.UnmarshalJSON(graphConf, local); err != nil {
			return apicontract.Failure[apicontract.GraphConfigurationData](-1, err.Error())
		}
		if model.IsAdminRoleContext(c) && !model.IsReadOnlyRoleContext(c) {
			model.Conf.Graph.Local = local
			model.Conf.Save()
		}
		return apicontract.Success(apicontract.LocalGraphConfiguration(localGraphContract(local)))
	default:
		return apicontract.Failure[apicontract.GraphConfigurationData](-1, "")
	}
})

var getGraph = contractHandler(apicontract.GetGraph, func(c *gin.Context, request apicontract.GlobalGraphRequest) apicontract.Response[apicontract.GlobalGraphData] {
	fail := func(message string) apicontract.Response[apicontract.GlobalGraphData] {
		return apicontract.GetGraph.FailureWithData(-1, message, apicontract.GraphQueryEcho[apicontract.GlobalGraphResult](request.ReqID))
	}
	query := request.K
	graphConf, err := gulu.JSON.MarshalJSON(request.Conf)
	if err != nil {
		return fail(err.Error())
	}

	global := conf.NewGlobalGraph()
	if err = gulu.JSON.UnmarshalJSON(graphConf, global); err != nil {
		return fail(err.Error())
	}

	if model.IsAdminRoleContext(c) && !model.IsReadOnlyRoleContext(c) {
		model.Conf.Graph.Global = global
		model.Conf.Save()
	}

	boxID, nodes, links := model.BuildGraph(query)
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		nodes, links = model.FilterGraphByPublishAccess(c, publishAccess, nodes, links)
	}
	return apicontract.Success(apicontract.GraphQueryResult(apicontract.GlobalGraphResult{GraphElements: graphElementsContract(request.ReqID, boxID, nodes, links), Conf: globalGraphContract(global)}))
})

var getLocalGraph = contractHandler(apicontract.GetLocalGraph, func(c *gin.Context, request apicontract.LocalGraphRequest) apicontract.Response[apicontract.LocalGraphData] {
	fail := func(message string) apicontract.Response[apicontract.LocalGraphData] {
		return apicontract.GetLocalGraph.FailureWithData(-1, message, apicontract.GraphQueryEcho[apicontract.LocalGraphResult](request.ReqID))
	}
	if request.ID == nil {
		return apicontract.Success(apicontract.GraphQueryEcho[apicontract.LocalGraphResult](request.ReqID))
	}
	id, keyword := *request.ID, request.K
	notebook := request.Notebook
	if model.IsEncryptedBox(notebook) {
		return fail(model.Conf.Language(392))
	}
	if bt := treenode.GetBlockTree(id); bt != nil && model.IsEncryptedBox(bt.BoxID) {
		return fail(model.Conf.Language(392))
	}

	graphConf, err := gulu.JSON.MarshalJSON(request.Conf)
	if err != nil {
		return fail(err.Error())
	}

	local := conf.NewLocalGraph()
	if err = gulu.JSON.UnmarshalJSON(graphConf, local); err != nil {
		return fail(err.Error())
	}

	if model.IsAdminRoleContext(c) && !model.IsReadOnlyRoleContext(c) {
		model.Conf.Graph.Local = local
		model.Conf.Save()
	}

	boxID, nodes, links := model.BuildTreeGraph(id, keyword)
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		nodes, links = model.FilterGraphByPublishAccess(c, publishAccess, nodes, links)
	}
	return apicontract.Success(apicontract.GraphQueryResult(apicontract.LocalGraphResult{GraphElements: graphElementsContract(request.ReqID, boxID, nodes, links), ID: id, Conf: localGraphContract(local)}))
})

func graphElementsContract(reqID apicontract.JSONValue, boxID string, nodes []*model.GraphNode, links []*model.GraphLink) apicontract.GraphElements {
	result := apicontract.GraphElements{GraphCorrelation: apicontract.GraphCorrelation{ReqID: reqID}, Box: boxID}
	if nodes != nil {
		result.Nodes = make([]*apicontract.GraphNode, len(nodes))
	}
	for i, node := range nodes {
		result.Nodes[i] = (*apicontract.GraphNode)(node)
	}
	if links != nil {
		result.Links = make([]*apicontract.GraphLink, len(links))
	}
	for i, link := range links {
		if link == nil {
			continue
		}
		converted := &apicontract.GraphLink{From: link.From, To: link.To, Ref: link.Ref}
		if link.Arrows != nil {
			converted.Arrows = &apicontract.GraphArrows{To: (*apicontract.GraphArrowsTo)(link.Arrows.To)}
		}
		result.Links[i] = converted
	}
	return result
}
