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
	"errors"
	"fmt"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var removeUnusedAttributeView = contractHandler(apicontract.RemoveUnusedAttributeView, func(c *gin.Context, request apicontract.RemoveUnusedAttributeViewRequest) apicontract.Response[apicontract.AVIDData] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.ID, ret) {
		return contractFailure[apicontract.AVIDData](ret)
	}
	if err := model.RemoveUnusedAttributeView(request.ID); err != nil {
		return apicontract.Failure[apicontract.AVIDData](-1, err.Error())
	}
	return apicontract.Success(apicontract.AVIDData{ID: request.ID})
})

var removeUnusedAttributeViews = contractHandler(apicontract.RemoveUnusedAttributeViews, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.AVPathsData] {
	return apicontract.Success(apicontract.AVPathsData{Paths: model.RemoveUnusedAttributeViews()})
})

var getUnusedAttributeViews = contractHandler(apicontract.GetUnusedAttributeViews, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[[]*apicontract.AssetUnusedItem] {
	values := model.UnusedAttributeViews(true)
	total := len(values)
	if total > 512 {
		values = values[:512]
		util.PushMsg(fmt.Sprintf(model.Conf.Language(279), total, 512), 5000)
	}
	return apicontract.Success(assetUnusedItems(values))
})

var getAttributeViewItemIDsByBoundIDs = contractHandler(apicontract.GetAttributeViewItemIDsByBoundIDs, func(c *gin.Context, request apicontract.GetAttributeViewItemIDsByBoundIDsRequest) apicontract.Response[map[string]string] {
	return apicontract.Success(model.GetAttributeViewItemIDs(request.AvID, append([]string(nil), request.BlockIDs...)))
})

var getAttributeViewBoundBlockIDsByItemIDs = contractHandler(apicontract.GetAttributeViewBoundBlockIDsByItemIDs, func(c *gin.Context, request apicontract.GetAttributeViewBoundBlockIDsByItemIDsRequest) apicontract.Response[map[string]string] {
	return apicontract.Success(model.GetAttributeViewBoundBlockIDs(request.AvID, append([]string(nil), request.ItemIDs...)))
})

var getAttributeViewItemStatuses = contractHandler(apicontract.GetAttributeViewItemStatuses, func(c *gin.Context, request apicontract.GetAttributeViewItemStatusesRequest) apicontract.Response[map[string]string] {
	if err := holdAttributeViewRequest(c, request.BlockID, request.ID); err != nil {
		return apicontract.Failure[map[string]string](-1, model.Conf.Language(314))
	}
	values, err := model.GetAttributeViewItemStatuses(request.BlockID, request.ID, request.ViewID, request.Query, append([]string{}, request.ItemIDs...))
	if err != nil {
		return apicontract.Failure[map[string]string](-1, err.Error())
	}
	return apicontract.Success(values)
})

// getAttributeViewAddingBlockDefaultValues 用于获取添加块时的默认值。
// 存在过滤或分组条件时，添加块时需要填充默认值到过滤字段或分组字段中，前端需要调用该接口来获取这些默认值以便填充。
var getAttributeViewAddingBlockDefaultValues = contractHandler(apicontract.GetAttributeViewAddingBlockDefaultValues, func(c *gin.Context, request apicontract.GetAttributeViewAddingBlockDefaultValuesRequest) apicontract.Response[apicontract.AVValuesData] {
	values, err := model.GetAttrViewAddingBlockDefaultValues(request.AvID, request.BlockID, request.ViewID, request.GroupID, request.PreviousID, request.AddingBlockID)
	if err != nil {
		return apicontract.Failure[apicontract.AVValuesData](-1, err.Error())
	}
	if len(values) == 0 {
		values = nil
	}
	return apicontract.Success(apicontract.AVValuesData{Values: avContractMap(values, toContractAVValue)})
})

var batchReplaceAttributeViewBlocks = contractHandler(apicontract.BatchReplaceAttributeViewBlocks, func(c *gin.Context, request apicontract.BatchReplaceAttributeViewBlocksRequest) apicontract.Response[apicontract.Null] {
	var values []map[string]string
	for _, pairs := range request.OldNew {
		for oldID, newID := range pairs {
			values = append(values, map[string]string{oldID: newID})
		}
	}
	if err := model.BatchReplaceAttributeViewBlocks(request.AvID, request.IsDetached, values); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.Null{})
})

var setAttrViewGroup = contractHandler(apicontract.SetAttrViewGroup, func(c *gin.Context, request apicontract.SetAttrViewGroupRequest) apicontract.Response[apicontract.AVRenderResult] {
	if err := model.SetAttributeViewGroup(request.AvID, request.BlockID, fromContractAVViewGroup(&request.Group)); err != nil {
		return apicontract.Failure[apicontract.AVRenderResult](-1, err.Error())
	}
	var filter func(av.Viewable) av.Viewable
	if model.IsReadOnlyRoleContext(c) {
		access := model.GetPublishAccess()
		filter = func(view av.Viewable) av.Viewable { return model.FilterViewByPublishAccess(c, access, view) }
	}
	return renderAttrView(request.BlockID, request.AvID, "", "", 1, -1, nil, "", false, request.IgnoreRows, "", "", filter, false)
})

var setAttrViewFilters = contractHandler(apicontract.SetAttrViewFilters, func(c *gin.Context, request apicontract.SetAttrViewFiltersRequest) apicontract.Response[apicontract.Null] {
	values := make([]any, len(request.Data))
	for i, value := range request.Data {
		values[i] = fromContractAVViewFilter(value)
	}
	if err := model.SetAttrViewFilters(request.AvID, request.BlockID, values); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.Null{})
})

var setAttrViewContextFilter = contractHandler(apicontract.SetAttrViewContextFilter, func(c *gin.Context, request apicontract.SetAttrViewContextFilterRequest) apicontract.Response[apicontract.AVContextFilterData] {
	if err := holdAttributeViewRequest(c, request.BlockID, request.AvID); err != nil {
		return apicontract.Failure[apicontract.AVContextFilterData](-1, model.Conf.Language(314))
	}
	value, err := model.SetAttributeViewContextFilter(request.BlockID, request.AvID, request.KeyID)
	if err != nil {
		return apicontract.Failure[apicontract.AVContextFilterData](-1, err.Error())
	}
	return apicontract.Success(apicontract.AVContextFilterData{ContextFilter: toContractAVAttributeViewContextFilter(value)})
})

var setAttrViewSorts = contractHandler(apicontract.SetAttrViewSorts, func(c *gin.Context, request apicontract.SetAttrViewSortsRequest) apicontract.Response[apicontract.Null] {
	values := make([]any, len(request.Data))
	for i, value := range request.Data {
		values[i] = fromContractAVViewSort(value)
	}
	if err := model.SetAttrViewSorts(request.AvID, request.BlockID, values); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.Null{})
})

var changeAttrViewLayout = contractHandler(apicontract.ChangeAttrViewLayout, func(c *gin.Context, request apicontract.ChangeAttrViewLayoutRequest) apicontract.Response[apicontract.AVRenderResult] {
	if err := model.ChangeAttrViewLayout(request.BlockID, request.AvID, av.LayoutType(request.LayoutType)); err != nil {
		return apicontract.Failure[apicontract.AVRenderResult](-1, err.Error())
	}
	var filter func(av.Viewable) av.Viewable
	if model.IsReadOnlyRoleContext(c) {
		access := model.GetPublishAccess()
		filter = func(view av.Viewable) av.Viewable { return model.FilterViewByPublishAccess(c, access, view) }
	}
	return renderAttrView(request.BlockID, request.AvID, "", "", 1, -1, nil, "", false, false, "", "", filter, false)
})

var duplicateAttributeViewBlock = contractHandler(apicontract.DuplicateAttributeViewBlock, func(c *gin.Context, request apicontract.DuplicateAttributeViewBlockRequest) apicontract.Response[apicontract.AVDuplicateData] {
	avID, blockID, err := model.DuplicateDatabaseBlock(request.AvID)
	if err != nil {
		return apicontract.Failure[apicontract.AVDuplicateData](-1, err.Error())
	}
	return apicontract.Success(apicontract.AVDuplicateData{AvID: avID, BlockID: blockID})
})

var getAttributeViewKeysByAvID = contractHandler(apicontract.GetAttributeViewKeysByAvID, func(c *gin.Context, request apicontract.GetAttributeViewKeysByAvIDRequest) apicontract.Response[[]*apicontract.AVKey] {
	return apicontract.Success(avContractSlice(model.GetAttributeViewKeysByID(request.AvID), toContractAVKey))
})

var getAttributeViewKeysByID = contractHandler(apicontract.GetAttributeViewKeysByID, func(c *gin.Context, request apicontract.GetAttributeViewKeysByIDRequest) apicontract.Response[[]*apicontract.AVKey] {
	if model.IsReadOnlyRoleContext(c) && !model.CheckAttributeViewAccessableByPublishAccess(c, model.GetPublishAccess(), request.AvID) {
		return apicontract.Failure[[]*apicontract.AVKey](-1, av.ErrAttributeViewNotFound.Error())
	}
	if request.KeyIDsError != nil {
		return apicontract.Failure[[]*apicontract.AVKey](-1, request.KeyIDsError.Error())
	}
	return apicontract.Success(avContractSlice(model.GetAttributeViewKeysByID(request.AvID, request.KeyIDs...), toContractAVKey))
})

var getMirrorDatabaseBlocks = contractHandler(apicontract.GetMirrorDatabaseBlocks, func(c *gin.Context, request apicontract.GetMirrorDatabaseBlocksRequest) apicontract.Response[apicontract.RefDefsData] {
	values := []apicontract.RefDefs{}
	for _, id := range treenode.GetMirrorAttrViewBlockIDs(request.AvID) {
		values = append(values, apicontract.RefDefs{RefID: id, DefIDs: []string{}})
	}
	return apicontract.Success(apicontract.RefDefsData{RefDefs: values})
})

var setDatabaseBlockView = contractHandler(apicontract.SetDatabaseBlockView, func(c *gin.Context, request apicontract.SetDatabaseBlockViewRequest) apicontract.Response[apicontract.Null] {
	if err := model.SetDatabaseBlockView(request.ID, request.AvID, request.ViewID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var getAttributeViewPrimaryKeyValues = contractHandler(apicontract.GetAttributeViewPrimaryKeyValues, func(c *gin.Context, request apicontract.GetAttributeViewPrimaryKeyValuesRequest) apicontract.Response[apicontract.AVPrimaryValuesData] {
	name, blockIDs, rows, total, err := model.GetAttributeViewPrimaryKeyValues(request.ID, request.Keyword, avNonemptyStrings(request.BlockIDs), avPage(request.Page, 1), avPage(request.PageSize, -1))
	if err != nil {
		return apicontract.Failure[apicontract.AVPrimaryValuesData](-1, err.Error())
	}
	return apicontract.Success(apicontract.AVPrimaryValuesData{Name: name, BlockIDs: blockIDs, Rows: toContractAVKeyValues(rows), Total: total})
})

var getAttributeViewRelationCandidates = contractHandler(apicontract.GetAttributeViewRelationCandidates, func(c *gin.Context, request apicontract.GetAttributeViewRelationCandidatesRequest) apicontract.Response[apicontract.AVRelationCandidatesData] {
	avID := request.AvID
	if avID == "" {
		avID = request.ID
	}
	name, blockIDs, colors, columns, selectedRows, rows, total, err := model.GetAttributeViewRelationCandidates(avID, request.KeyID, request.Keyword, avNonemptyStrings(request.SelectedBlockIDs), avPage(request.Page, 1), avPage(request.PageSize, -1))
	if err != nil {
		return apicontract.Failure[apicontract.AVRelationCandidatesData](-1, err.Error())
	}
	notebookID := ""
	if len(blockIDs) > 0 {
		if tree := treenode.GetBlockTree(blockIDs[0]); tree != nil {
			notebookID = tree.BoxID
		}
	}
	return apicontract.Success(apicontract.AVRelationCandidatesData{Name: name, BlockIDs: blockIDs, CustomColors: avContractSlice(colors, toContractAVAttributeViewCustomColor), NotebookID: notebookID, Columns: avContractSlice(columns, toContractAVTableColumn), SelectedRows: avContractSlice(selectedRows, toContractAVTableRow), Rows: avContractSlice(rows, toContractAVTableRow), Total: total})
})

var appendAttributeViewDetachedBlocksWithValues = contractHandler(apicontract.AppendAttributeViewDetachedBlocksWithValues, func(c *gin.Context, request apicontract.AppendAttributeViewDetachedBlocksWithValuesRequest) apicontract.Response[apicontract.Null] {
	var values [][]*av.Value
	for _, row := range request.BlocksValues {
		var rowValues []*av.Value
		for _, value := range row {
			if value == nil {
				value = &apicontract.AVValue{}
			}
			rowValues = append(rowValues, fromContractAVValue(value))
		}
		values = append(values, rowValues)
	}
	if err := model.AppendAttributeViewDetachedBlocksWithValues(request.AvID, values); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var addAttributeViewBlocks = contractHandler(apicontract.AddAttributeViewBlocks, func(c *gin.Context, request apicontract.AddAttributeViewBlocksRequest) apicontract.Response[apicontract.Null] {
	var srcs []map[string]any
	for _, value := range request.Srcs {
		src := map[string]any{"id": value.ID, "isDetached": value.IsDetached}
		if value.ItemID != nil {
			src["itemID"] = *value.ItemID
		}
		if value.Content != nil {
			src["content"] = *value.Content
		}
		srcs = append(srcs, src)
	}
	if err := model.AddAttributeViewBlock(nil, srcs, request.AvID, request.BlockID, request.ViewID, request.GroupID, request.PreviousID, request.IgnoreDefaultFill); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.Null{})
})

var removeAttributeViewBlocks = contractHandler(apicontract.RemoveAttributeViewBlocks, func(c *gin.Context, request apicontract.RemoveAttributeViewBlocksRequest) apicontract.Response[apicontract.Null] {
	if err := model.RemoveAttributeViewBlock(append([]string(nil), request.SrcIDs...), request.AvID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.Null{})
})

var addAttributeViewKey = contractHandler(apicontract.AddAttributeViewKey, func(c *gin.Context, request apicontract.AddAttributeViewKeyRequest) apicontract.Response[apicontract.Null] {
	if err := model.AddAttributeViewKey(request.AvID, request.BlockID, request.KeyID, request.KeyName, request.KeyType, request.KeyIcon, request.PreviousKeyID, av.DateDisplayFormatFull); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.Null{})
})

var removeAttributeViewKey = contractHandler(apicontract.RemoveAttributeViewKey, func(c *gin.Context, request apicontract.RemoveAttributeViewKeyRequest) apicontract.Response[apicontract.Null] {
	if err := model.RemoveAttributeViewKey(request.AvID, request.KeyID, request.RemoveRelationDest); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.Null{})
})

var sortAttributeViewViewKey = contractHandler(apicontract.SortAttributeViewViewKey, func(c *gin.Context, request apicontract.SortAttributeViewViewKeyRequest) apicontract.Response[apicontract.Null] {
	if err := model.SortAttributeViewViewKey(request.AvID, request.ViewID, request.KeyID, request.PreviousKeyID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.Null{})
})

var sortAttributeViewKey = contractHandler(apicontract.SortAttributeViewKey, func(c *gin.Context, request apicontract.SortAttributeViewKeyRequest) apicontract.Response[apicontract.Null] {
	if err := model.SortAttributeViewKey(request.AvID, request.KeyID, request.PreviousKeyID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.Null{})
})

var getAttributeViewFilterSort = contractHandler(apicontract.GetAttributeViewFilterSort, func(c *gin.Context, request apicontract.GetAttributeViewFilterSortRequest) apicontract.Response[apicontract.AVFilterSortData] {
	filters, sorts := model.GetAttributeViewFilterSort(request.ID, request.BlockID)
	return apicontract.Success(apicontract.AVFilterSortData{Filters: avContractSlice(filters, toContractAVViewFilter), Sorts: avContractSlice(sorts, toContractAVViewSort)})
})

var searchAttributeViewRollupDestKeys = contractHandler(apicontract.SearchAttributeViewRollupDestKeys, func(c *gin.Context, request apicontract.SearchAttributeViewRollupDestKeysRequest) apicontract.Response[apicontract.AVKeysData] {
	return apicontract.Success(apicontract.AVKeysData{Keys: avContractSlice(model.SearchAttributeViewRollupDestKeys(request.AvID, request.Keyword), toContractAVKey)})
})

var searchAttributeViewRelationKey = contractHandler(apicontract.SearchAttributeViewRelationKey, func(c *gin.Context, request apicontract.SearchAttributeViewRelationKeyRequest) apicontract.Response[apicontract.AVKeysData] {
	return apicontract.Success(apicontract.AVKeysData{Keys: avContractSlice(model.SearchAttributeViewRelationKey(request.AvID, request.Keyword), toContractAVKey)})
})

var getAttributeView = contractHandler(apicontract.GetAttributeView, func(c *gin.Context, request apicontract.GetAttributeViewRequest) apicontract.Response[apicontract.AVData] {
	return apicontract.Success(apicontract.AVData{Av: toContractAVAttributeViewData(model.NewAttributeViewData(model.GetAttributeView(request.ID)))})
})

var getAttributeViewPasteRows = contractHandler(apicontract.GetAttributeViewPasteRows, func(c *gin.Context, request apicontract.GetAttributeViewPasteRowsRequest) apicontract.Response[apicontract.AVPasteRowsData] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.AvID, ret) || util.InvalidIDPattern(request.BlockID, ret) || util.InvalidIDPattern(request.StartItemID, ret) || (request.ViewID != "" && util.InvalidIDPattern(request.ViewID, ret)) || (request.GroupID != "" && util.InvalidIDPattern(request.GroupID, ret)) {
		return contractFailure[apicontract.AVPasteRowsData](ret)
	}
	count := int(request.Count)
	if request.Count != float64(count) || count < 1 || count > 100000 {
		return apicontract.Failure[apicontract.AVPasteRowsData](-1, "invalid paste row count")
	}
	view, keys, err := model.GetAttributeViewPasteRows(request.BlockID, request.AvID, request.ViewID, request.GroupID, request.Query, request.StartItemID, count)
	if err != nil {
		return apicontract.Failure[apicontract.AVPasteRowsData](-1, err.Error())
	}
	return apicontract.Success(apicontract.AVPasteRowsData{View: toContractAVTable(view), InferableKeyIDs: keys})
})

var getAttributeViewFieldViews = contractHandler(apicontract.GetAttributeViewFieldViews, func(c *gin.Context, request apicontract.GetAttributeViewFieldViewsRequest) apicontract.Response[apicontract.AVFieldViewsData] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.AvID, ret) || util.InvalidIDPattern(request.KeyID, ret) {
		return contractFailure[apicontract.AVFieldViewsData](ret)
	}
	views, err := model.GetAttributeViewFieldViews(request.AvID, request.KeyID)
	if err != nil {
		return apicontract.Failure[apicontract.AVFieldViewsData](-1, err.Error())
	}
	return apicontract.Success(apicontract.AVFieldViewsData{Views: avContractSlice(views, toContractAVAttributeViewFieldView)})
})

var createAttributeViewItem = contractHandler(apicontract.CreateAttributeViewItem, func(c *gin.Context, request apicontract.CreateAttributeViewItemRequest) apicontract.Response[apicontract.AVCreateItemResult] {
	value, err := model.CreateAttributeViewItem(request.AvID, request.BlockID, request.ViewID, request.TemplateID, request.PreviousID, request.GroupID, request.CalendarDate)
	return createAVItemResponse(value, err, request.App, request.Session)
})

var createAttributeViewItemWithMarkdown = contractHandler(apicontract.CreateAttributeViewItemWithMarkdown, func(c *gin.Context, request apicontract.CreateAttributeViewItemWithMarkdownRequest) apicontract.Response[apicontract.AVCreateItemResult] {
	value, err := model.CreateAttributeViewItemWithMarkdown(request.AvID, request.BlockID, request.ViewID, request.TemplateID, request.PreviousID, request.GroupID, &model.CreateAttributeViewItemMarkdown{Title: request.Title, Markdown: request.Markdown, Tags: request.Tags, WithMath: request.WithMath, ClippingHref: request.ClippingHref, ListDocTree: request.ListDocTree})
	return createAVItemResponse(value, err, request.App, request.Session)
})

var createAttributeViewItemDocs = contractHandler(apicontract.CreateAttributeViewItemDocs, func(c *gin.Context, request apicontract.CreateAttributeViewItemDocsRequest) apicontract.Response[apicontract.AVCreateItemDocsResult] {
	value, err := model.CreateAttributeViewItemDocs(request.AvID, request.BlockID, request.SaveMode, avNonemptyStrings(request.ItemIDs))
	if err != nil {
		if errors.Is(err, model.ErrBoxNotFound) {
			return apicontract.CreateAttributeViewItemDocs.FailureWithData(1, "", apicontract.NewAVCreateItemDocsResultError(apicontract.AVUnavailableNotebook{UnavailableNotebook: true}))
		}
		return apicontract.Failure[apicontract.AVCreateItemDocsResult](-1, err.Error())
	}
	if value.Transaction != nil {
		pushTransactions(request.App, request.Session, []*model.Transaction{value.Transaction})
	}
	return apicontract.Success(apicontract.NewAVCreateItemDocsResult(*toContractAVCreateAttributeViewItemDocsResult(value)))
})

var searchAttributeView = contractHandler(apicontract.SearchAttributeView, func(c *gin.Context, request apicontract.SearchAttributeViewRequest) apicontract.Response[apicontract.AVSearchData] {
	values := model.SearchAttributeViewWithOptions(model.SearchAttributeViewOptions{Keyword: request.Keyword, ExcludeAvIDs: append([]string(nil), request.Excludes...), CurrentAvID: request.AvID, CurrentBlockID: request.BlockID, IncludeViewMatches: request.IncludeViewMatches})
	return apicontract.Success(apicontract.AVSearchData{Results: avContractSlice(values, toContractAVAvSearchResult)})
})

var renderSnapshotAttributeView = contractHandler(apicontract.RenderSnapshotAttributeView, func(c *gin.Context, request apicontract.RenderSnapshotAttributeViewRequest) apicontract.Response[apicontract.AVArchiveRenderData] {
	if err := holdAttributeViewRequest(c, request.BlockID, request.ID); err != nil {
		return apicontract.Failure[apicontract.AVArchiveRenderData](-1, model.Conf.Language(314))
	}
	boxID, err := model.ResolveRepoSnapshotAttributeViewBoxID(request.Snapshot, request.ID)
	if err != nil {
		return apicontract.Failure[apicontract.AVArchiveRenderData](-1, err.Error())
	}
	if err = holdEncryptedBoxRequest(c, boxID); err != nil {
		return apicontract.Failure[apicontract.AVArchiveRenderData](-1, model.Conf.Language(314))
	}
	view, attrView, err := model.RenderRepoSnapshotAttributeView(request.Snapshot, request.ID, request.ViewID, request.CarrierViewID, fromContractAVCalendarRange(request.CalendarRange))
	if err != nil {
		return apicontract.Failure[apicontract.AVArchiveRenderData](-1, err.Error())
	}
	return apicontract.Success(avArchiveRenderData(attrView, view))
})

var renderHistoryAttributeView = contractHandler(apicontract.RenderHistoryAttributeView, func(c *gin.Context, request apicontract.RenderHistoryAttributeViewRequest) apicontract.Response[apicontract.AVArchiveRenderData] {
	if err := holdAttributeViewRequest(c, request.BlockID, request.ID); err != nil {
		return apicontract.Failure[apicontract.AVArchiveRenderData](-1, model.Conf.Language(314))
	}
	boxID, err := model.ResolveHistoryAttributeViewBoxID(request.ID, request.Created)
	if err != nil {
		return apicontract.Failure[apicontract.AVArchiveRenderData](-1, err.Error())
	}
	if err = holdEncryptedBoxRequest(c, boxID); err != nil {
		return apicontract.Failure[apicontract.AVArchiveRenderData](-1, model.Conf.Language(314))
	}
	view, attrView, err := model.RenderHistoryAttributeView(request.ID, request.ViewID, request.CarrierViewID, request.Query, avPage(request.Page, 1), avPage(request.PageSize, -1), avGroupPaging(request.GroupPaging), request.Created, fromContractAVCalendarRange(request.CalendarRange))
	if err != nil {
		return apicontract.Failure[apicontract.AVArchiveRenderData](-1, err.Error())
	}
	return apicontract.Success(avArchiveRenderData(attrView, view))
})

var renderAttributeView = contractHandler(apicontract.RenderAttributeView, func(c *gin.Context, request apicontract.RenderAttributeViewRequest) apicontract.Response[apicontract.AVRenderResult] {
	if err := holdAttributeViewRequest(c, request.BlockID, request.ID); err != nil {
		return apicontract.Failure[apicontract.AVRenderResult](-1, model.Conf.Language(314))
	}
	readOnly := model.IsReadOnlyRoleContext(c)
	var filter func(av.Viewable) av.Viewable
	if readOnly {
		access := model.GetPublishAccess()
		if !model.CheckAttributeViewBlockAccessableByPublishAccess(c, access, request.ID, request.BlockID) {
			return apicontract.Failure[apicontract.AVRenderResult](-1, av.ErrAttributeViewNotFound.Error())
		}
		filter = func(view av.Viewable) av.Viewable {
			return model.FilterAttributeViewByPublishAccess(c, access, request.ID, request.BlockID, view)
		}
	}
	create := true
	if request.CreateIfNotExist != nil {
		create = *request.CreateIfNotExist
	}
	return renderAttrView(request.BlockID, request.ID, request.ViewID, request.Query, avPage(request.Page, 1), avPage(request.PageSize, -1), avGroupPaging(request.GroupPaging), av.LayoutType(request.InitialLayout), create, request.IgnoreRows, request.TargetItemID, request.TargetGroupID, filter, readOnly, fromContractAVCalendarRange(request.CalendarRange))
})

func holdAttributeViewRequest(c *gin.Context, blockID, avID string) error {
	if blockID != "" {
		block := treenode.GetBlockTree(blockID)
		if nil == block {
			for _, encryptedBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
				if block = treenode.GetBlockTreeInBox(blockID, encryptedBoxID); nil != block {
					break
				}
			}
		}
		if nil != block {
			if model.IsEncryptedBox(block.BoxID) {
				return holdEncryptedBoxRequest(c, block.BoxID)
			}
			// 已解析的普通载体是权威上下文，不得再按 avID 回退到已打开的加密笔记本。
			return nil
		}
	}
	if _, boxID := av.FindAttributeViewPath(avID); boxID != "" {
		return holdEncryptedBoxRequest(c, boxID)
	}
	return nil
}

var getCurrentAttrViewImages = contractHandler(apicontract.GetCurrentAttrViewImages, func(c *gin.Context, request apicontract.GetCurrentAttrViewImagesRequest) apicontract.Response[[]string] {
	if err := holdAttributeViewRequest(c, request.BlockID, request.ID); err != nil {
		return apicontract.Failure[[]string](-1, model.Conf.Language(314))
	}
	images, err := model.GetCurrentAttributeViewImages(c, request.ID, request.BlockID, request.ViewID, request.Query)
	if err != nil {
		return apicontract.Failure[[]string](-1, err.Error())
	}
	return apicontract.Success(images)
})

var getAttributeViewKeys = contractHandler(apicontract.GetAttributeViewKeys, func(c *gin.Context, request apicontract.GetAttributeViewKeysRequest) apicontract.Response[[]*apicontract.AVBlockAttributeViewKeys] {
	var values []*model.BlockAttributeViewKeys
	if request.AvID != "" && (request.ItemID != "" || request.ValueID != "") {
		values = model.GetAttributeViewItemKeys(request.AvID, request.ItemID, request.ValueID)
	} else {
		values = model.GetBlockAttributeViewKeys(request.ID)
	}
	if model.IsReadOnlyRoleContext(c) {
		values = model.FilterBlockAttributeViewKeysByPublishAccess(c, model.GetPublishAccess(), values)
	}
	return apicontract.Success(avContractSlice(values, toContractAVBlockAttributeViewKeys))
})

var getAttributeViewSearchTarget = contractHandler(apicontract.GetAttributeViewSearchTarget, func(c *gin.Context, request apicontract.GetAttributeViewSearchTargetRequest) apicontract.Response[*apicontract.AVAttributeViewSearchTarget] {
	return apicontract.Success(toContractAVAttributeViewSearchTarget(model.GetAttributeViewSearchTarget(request.ID, append([]string(nil), request.Keywords...))))
})

var getAttributeViewBacklinks = contractHandler(apicontract.GetAttributeViewBacklinks, func(c *gin.Context, request apicontract.GetAttributeViewBacklinksRequest) apicontract.Response[*apicontract.AVAttributeViewBacklinks] {
	values := model.GetAttributeViewBacklinks(request.ID, request.AvID, request.ItemID, request.ValueID)
	if model.IsReadOnlyRoleContext(c) {
		values = model.FilterAttributeViewBacklinksByPublishAccess(c, model.GetPublishAccess(), values)
	}
	return apicontract.Success(toContractAVAttributeViewBacklinks(values))
})

var setAttributeViewBlockAttr = contractHandler(apicontract.SetAttributeViewBlockAttr, func(c *gin.Context, request apicontract.SetAttributeViewBlockAttrRequest) apicontract.Response[apicontract.AVValueData] {
	itemID := ""
	if request.ItemID != nil {
		itemID = *request.ItemID
	} else if request.RowID != nil {
		msg := fmt.Sprintf("[%s] parameter [%s] is deprecated, visit [https://github.com/siyuan-note/siyuan/issues/15727] for details", c.Request.RequestURI, "rowID")
		logging.LogWarn(msg)
		return apicontract.Failure[apicontract.AVValueData](-1, msg)
	}
	value, err := model.UpdateAttributeViewCell(nil, request.AvID, request.KeyID, itemID, request.Value)
	if err != nil {
		return apicontract.Failure[apicontract.AVValueData](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.AVValueData{Value: toContractAVValue(value)})
})

var batchSetAttributeViewBlockAttrs = contractHandler(apicontract.BatchSetAttributeViewBlockAttrs, func(c *gin.Context, request apicontract.BatchSetAttributeViewBlockAttrsRequest) apicontract.Response[apicontract.Null] {
	values := make([]any, len(request.Values))
	for i, value := range request.Values {
		fields := map[string]any{"keyID": value.KeyID, "value": value.Value}
		if value.ItemID != nil {
			fields["itemID"] = *value.ItemID
		}
		if value.RowID != nil {
			fields["rowID"] = *value.RowID
		}
		values[i] = fields
	}
	if err := model.BatchUpdateAttributeViewCells(nil, request.AvID, values); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.ReloadAttrView(request.AvID)
	return apicontract.Success(apicontract.Null{})
})

func avPage(value *float64, fallback int) int {
	if value == nil {
		return fallback
	}
	return int(*value)
}
func avNonemptyStrings(values []string) []string {
	var ret []string
	for _, value := range values {
		if value != "" {
			ret = append(ret, value)
		}
	}
	return ret
}
