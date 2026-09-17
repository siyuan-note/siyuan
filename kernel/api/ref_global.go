package api

import (
	"fmt"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func globalBacklinkQuery(c *gin.Context, request apicontract.GlobalBacklinkQuery) (model.GlobalBacklinkQuery, error) {
	query := model.GlobalBacklinkQuery{ID: request.ID, Notebook: request.Notebook, Keyword: request.Keyword, Sort: request.Sort, ContainChildren: request.ContainChildren, SourceFilter: backlinkSourceFilterModel(request.SourceFilter)}
	if !ast.IsNodeIDPattern(query.ID) || query.Sort != 1 && query.Sort != 2 {
		return query, fmt.Errorf("invalid backlink query")
	}
	if isEncryptedNotebookDeniedForPublish(c, query.Notebook) || !isBacklinkDocAccessible(c, query.ID) {
		return query, fmt.Errorf("backlink access denied")
	}
	if !model.IsEncryptedBox(query.Notebook) {
		query.Notebook = ""
	}
	if err := holdEncryptedBoxRequest(c, query.Notebook); err != nil {
		return query, err
	}
	return query, nil
}

var getGlobalBacklinks = contractHandler(apicontract.GetGlobalBacklinks, func(c *gin.Context, request apicontract.GlobalBacklinkListRequest) apicontract.Response[apicontract.GlobalBacklinkListData] {
	query, err := globalBacklinkQuery(c, request.GlobalBacklinkQuery)
	if err != nil {
		return apicontract.Failure[apicontract.GlobalBacklinkListData](1, err.Error())
	}
	token, items, total, start, expired, err := model.GetGlobalBacklinks(query, request.Snapshot, request.Offset, request.AnchorID, func(id string) bool { return isBacklinkDocAccessible(c, id) })
	if err != nil {
		return apicontract.Failure[apicontract.GlobalBacklinkListData](1, err.Error())
	}
	ret := apicontract.GlobalBacklinkListData{Snapshot: token, Expired: expired, Total: total, Offset: start, Items: []*apicontract.GlobalBacklinkItem{}}
	for _, item := range items {
		ret.Items = append(ret.Items, &apicontract.GlobalBacklinkItem{ID: item.ID, RootID: item.RootID, Box: item.Box, HPath: item.HPath, Anchor: item.Anchor})
	}
	return apicontract.Success(ret)
})

var getGlobalBacklinkContexts = contractHandler(apicontract.GetGlobalBacklinkContexts, func(c *gin.Context, request apicontract.GlobalBacklinkContextRequest) apicontract.Response[apicontract.GlobalBacklinkContextData] {
	query, err := globalBacklinkQuery(c, request.GlobalBacklinkQuery)
	if err != nil {
		return apicontract.Failure[apicontract.GlobalBacklinkContextData](1, err.Error())
	}
	if len(request.IDs) > 20 {
		return apicontract.Failure[apicontract.GlobalBacklinkContextData](-1, "too many backlink contexts")
	}
	items, expired, err := model.GetGlobalBacklinkContexts(query, request.Snapshot, request.IDs, func(id string) bool { return isBacklinkDocAccessible(c, id) })
	if err != nil {
		return apicontract.Failure[apicontract.GlobalBacklinkContextData](1, err.Error())
	}
	return apicontract.Success(apicontract.GlobalBacklinkContextData{Expired: expired, Items: backlinkContextContracts(newBacklinkContextResponses(items))})
})
