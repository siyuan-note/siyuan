package api

import (
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func docTreeAccess(c *gin.Context, notebook string) (model.DocTreeAccess, error) {
	access := model.DocTreeAccess{Published: model.IsReadOnlyRoleContext(c), RefBoxes: []string{""}}
	if access.Published {
		access.Policy = model.GetPublishAccess()
		access.PolicyRevision = model.DocTreePublishAccessRevision(access.Policy)
	} else {
		// 文档引用数也可能来自其他加密笔记本，相应租约同样保留至响应写入完成。
		boxes := sql.GetEncryptedBoxIDs()
		sort.Strings(boxes)
		for _, boxID := range boxes {
			if err := holdEncryptedBoxRequest(c, boxID); err != nil {
				return access, err
			}
			access.RefBoxes = append(access.RefBoxes, boxID)
		}
	}
	sort.Strings(access.RefBoxes)
	return access, holdEncryptedBoxRequest(c, notebook)
}

var listDocTreeRange = contractHandler(apicontract.ListDocTreeRange, func(c *gin.Context, request apicontract.FileTreeRangeRequest) apicontract.Response[apicontract.FileTreeRangeData] {
	access, err := docTreeAccess(c, request.Notebook)
	if err != nil {
		return apicontract.Failure[apicontract.FileTreeRangeData](-1, err.Error())
	}
	limit := *model.Conf.LoadFileTree().DocTreeBatchSize
	if request.Limit != nil {
		limit = *request.Limit
	}
	rangeData, err := model.ListDocTreeRange(c.Request.Context(), request.Notebook, request.ParentID, request.Offset, limit, request.Revision, access)
	if err != nil {
		return apicontract.Failure[apicontract.FileTreeRangeData](-1, err.Error())
	}
	return apicontract.Success(apicontract.FileTreeRangeData{Box: rangeData.Box, ParentID: rangeData.ParentID,
		Path: rangeData.Path, Files: fileTreeFileContracts(rangeData.Files), Total: rangeData.Total, Offset: rangeData.Offset,
		Limit: rangeData.Limit, EffectiveSortMode: rangeData.SortMode, Revision: rangeData.Revision, Stale: rangeData.Stale})
})

var locateDocTreeItem = contractHandler(apicontract.LocateDocTreeItem, func(c *gin.Context, request apicontract.FileTreeLocateRequest) apicontract.Response[apicontract.FileTreeLocateData] {
	access, err := docTreeAccess(c, request.Notebook)
	if err != nil {
		return apicontract.Failure[apicontract.FileTreeLocateData](-1, err.Error())
	}
	locations, err := model.LocateDocTreeItem(c.Request.Context(), request.Notebook, request.ID, access)
	if err != nil {
		return apicontract.Failure[apicontract.FileTreeLocateData](-1, err.Error())
	}
	data := apicontract.FileTreeLocateData{Box: request.Notebook, ID: request.ID, Steps: []apicontract.FileTreeLocateStep{}}
	for _, location := range locations {
		data.Steps = append(data.Steps, apicontract.FileTreeLocateStep{ParentID: location.ParentID, Path: location.Path,
			ID: location.ID, Index: location.Index, Total: location.Total, EffectiveSortMode: location.SortMode, Revision: location.Revision})
	}
	return apicontract.Success(data)
})
