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
	"path/filepath"
	"sort"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var searchHistory = contractHandler(apicontract.SearchHistory, func(c *gin.Context, request apicontract.SearchHistoryRequest) apicontract.Response[apicontract.SearchHistoryData] {
	typ := model.HistoryTypeDoc
	if request.Type != nil {
		typ = int(*request.Type)
	}
	page := 1
	if request.Page != nil {
		page = int(*request.Page)
	}
	histories, pageCount, totalCount := model.FullTextSearchHistory(request.Query, request.Notebook, request.Op, typ, page)
	return apicontract.Success(apicontract.SearchHistoryData{Histories: histories, PageCount: pageCount, TotalCount: totalCount})
})

var getHistoryItems = contractHandler(apicontract.GetHistoryItems, func(c *gin.Context, request apicontract.HistoryItemsRequest) apicontract.Response[apicontract.HistoryItemsData] {
	typ := model.HistoryTypeDoc
	if request.Type != nil {
		typ = int(*request.Type)
	}
	histories := model.FullTextSearchHistoryItems(request.Created, request.Query, request.Notebook, request.Op, typ)
	return apicontract.Success(apicontract.HistoryItemsData{Items: historyItemContracts(histories)})
})

var reindexHistory = contractHandler(apicontract.ReindexHistory, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	model.ReindexHistory()
	return apicontract.Success(apicontract.Null{})
})

var getNotebookHistory = contractHandler(apicontract.GetNotebookHistory, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.NotebookHistoryData] {
	histories, err := model.GetNotebookHistory()
	if err != nil {
		return apicontract.Failure[apicontract.NotebookHistoryData](-1, err.Error())
	}
	var result []*apicontract.History
	if histories != nil {
		result = make([]*apicontract.History, len(histories))
		for i, history := range histories {
			if history != nil {
				result[i] = &apicontract.History{HCreated: history.HCreated, Items: historyItemContracts(history.Items)}
			}
		}
	}
	return apicontract.Success(apicontract.NotebookHistoryData{Histories: result})
})

func historyItemContracts(items []*model.HistoryItem) []*apicontract.HistoryItem {
	if items == nil {
		return nil
	}
	result := make([]*apicontract.HistoryItem, len(items))
	for i, item := range items {
		result[i] = (*apicontract.HistoryItem)(item)
	}
	return result
}

var clearWorkspaceHistory = contractHandler(apicontract.ClearWorkspaceHistory, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	msgID := util.PushMsg(model.Conf.Language(100), 1000*60*15)
	time.Sleep(3 * time.Second)
	if err := model.ClearWorkspaceHistory(); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	util.PushUpdateMsg(msgID, model.Conf.Language(99), 1000*5)
	return apicontract.Success(apicontract.Null{})
})

var getDocHistoryContent = contractHandler(apicontract.GetDocHistoryContent, func(c *gin.Context, request apicontract.DocHistoryContentRequest) apicontract.Response[apicontract.DocHistoryContentData] {
	ret := gulu.Ret.NewResult()
	historyPath, keyword := request.HistoryPath, request.K
	highlight := true
	if request.Highlight != nil {
		highlight = *request.Highlight
	}
	if !holdHistoryRequest(c, historyPath, ret) {
		return contractFailure[apicontract.DocHistoryContentData](ret)
	}
	id, rootID, content, isLargeDoc, err := model.GetDocHistoryContent(historyPath, keyword, highlight)
	if err != nil {
		return apicontract.Failure[apicontract.DocHistoryContentData](-1, err.Error())
	}
	return apicontract.Success(apicontract.DocHistoryContentData{ID: id, RootID: rootID, Content: content, IsLargeDoc: isLargeDoc})
})

var diffDocVersions = contractHandler(apicontract.DiffDocVersions, func(c *gin.Context, request apicontract.DiffDocVersionsRequest) apicontract.Response[*apicontract.DocVersionDiffResult] {
	left, right := (*model.DocVersionRef)(&request.Left), (*model.DocVersionRef)(&request.Right)
	boxIDs := map[string]struct{}{}
	for _, ref := range []*model.DocVersionRef{left, right} {
		boxID, resolveErr := model.ResolveDocVersionBoxID(ref)
		if resolveErr != nil {
			return apicontract.Failure[*apicontract.DocVersionDiffResult](-1, resolveErr.Error())
		}
		if boxID != "" {
			boxIDs[boxID] = struct{}{}
		}
	}
	sortedBoxIDs := make([]string, 0, len(boxIDs))
	for boxID := range boxIDs {
		sortedBoxIDs = append(sortedBoxIDs, boxID)
	}
	sort.Strings(sortedBoxIDs)
	for _, boxID := range sortedBoxIDs {
		if err := holdEncryptedBoxRequest(c, boxID); err != nil {
			return apicontract.Failure[*apicontract.DocVersionDiffResult](-1, model.Conf.Language(314))
		}
	}

	diff, err := model.DiffDocVersions(left, right)
	if err != nil {
		return apicontract.Failure[*apicontract.DocVersionDiffResult](-1, err.Error())
	}
	return apicontract.Success(docVersionDiffContract(diff))
})

var rollbackDocHistory = contractHandler(apicontract.RollbackDocHistory, func(c *gin.Context, request apicontract.HistoryPathRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	if !holdHistoryRequest(c, request.HistoryPath, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	if err := model.RollbackDocHistory(request.HistoryPath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var rollbackAssetsHistory = contractHandler(apicontract.RollbackAssetsHistory, func(c *gin.Context, request apicontract.HistoryPathRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	if !holdHistoryRequest(c, request.HistoryPath, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	if err := model.RollbackAssetsHistory(request.HistoryPath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var rollbackNotebookHistory = contractHandler(apicontract.RollbackNotebookHistory, func(c *gin.Context, request apicontract.HistoryPathRequest) apicontract.Response[apicontract.Null] {
	if err := model.RollbackNotebookHistory(request.HistoryPath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var rollbackAttributeViewHistory = contractHandler(apicontract.RollbackAttributeViewHistory, func(c *gin.Context, request apicontract.HistoryPathRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	if !holdHistoryRequest(c, request.HistoryPath, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	if err := model.RollbackAttributeViewHistory(request.HistoryPath); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

func holdHistoryRequest(c *gin.Context, historyPath string, ret *gulu.Result) bool {
	absolutePath := filepath.Join(util.WorkspaceDir, historyPath)
	boxID := model.ExtractBoxIDFromHistoryPath(absolutePath)
	if err := holdEncryptedBoxRequest(c, boxID); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return false
	}
	return true
}

var createDocHistory = contractHandler(apicontract.CreateDocHistory, func(c *gin.Context, request apicontract.CreateDocHistoryRequest) apicontract.Response[apicontract.Null] {
	err := model.CreateDocHistory(request.ID)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var createAssetHistory = contractHandler(apicontract.CreateAssetHistory, func(c *gin.Context, request apicontract.CreateAssetHistoryRequest) apicontract.Response[apicontract.Null] {
	err := model.CreateAssetHistory(request.Path)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

func docVersionDiffContract(diff *model.DocVersionDiffResult) *apicontract.DocVersionDiffResult {
	if diff == nil {
		return nil
	}
	result := &apicontract.DocVersionDiffResult{Left: (*apicontract.DocVersionDiffContent)(diff.Left), Right: (*apicontract.DocVersionDiffContent)(diff.Right),
		Large: diff.Large, Fallback: diff.Fallback, Message: diff.Message, TitleModified: diff.TitleModified}
	if diff.Differences != nil {
		result.Differences = make([]*apicontract.DocVersionDifference, len(diff.Differences))
		for i, difference := range diff.Differences {
			result.Differences[i] = (*apicontract.DocVersionDifference)(difference)
		}
	}
	return result
}
