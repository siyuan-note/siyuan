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
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var listInvalidBlockRefs = contractHandler(apicontract.ListInvalidBlockRefs, func(c *gin.Context, request apicontract.SearchPageRequest) apicontract.Response[apicontract.SearchBlocksData] {
	page, pageSize := request.Pagination()
	var blocks []*model.Block
	var matchedBlockCount, matchedRootCount, pageCount int
	if model.IsReadOnlyRoleContext(c) {
		denyAll, excludeBoxIDs, excludeDocIDs := model.GetPublishAccessSearchExclusion(c)
		if denyAll {
			blocks = []*model.Block{}
			matchedBlockCount, matchedRootCount, pageCount = 0, 0, 0
		} else {
			blocks, matchedBlockCount, matchedRootCount, pageCount = model.ListInvalidBlockRefs(page, pageSize, excludeBoxIDs, excludeDocIDs)
		}
		publishAccess := model.GetPublishAccess()
		blocks = model.FilterBlocksByPublishAccess(c, publishAccess, blocks)
	} else {
		blocks, matchedBlockCount, matchedRootCount, pageCount = model.ListInvalidBlockRefs(page, pageSize, nil, nil)
	}
	return apicontract.Success(apicontract.SearchBlocksData{Blocks: searchBlockContracts(blocks), MatchedBlockCount: matchedBlockCount, MatchedRootCount: matchedRootCount, PageCount: pageCount})
})
var getAssetContent = contractHandler(apicontract.GetAssetContent, func(c *gin.Context, request apicontract.AssetContentRequest) apicontract.Response[apicontract.AssetContentData] {
	assetContent := model.GetAssetContent(request.ID, request.Query, int(request.QueryMethod))
	if model.IsReadOnlyRoleContext(c) && assetContent != nil {
		publishAccess := model.GetPublishAccess()
		filtered := model.FilterAssetContentByPublishAccess(c, publishAccess, []*model.AssetContent{assetContent})
		if len(filtered) > 0 {
			assetContent = filtered[0]
		} else {
			assetContent = nil
		}
	}
	return apicontract.Success(apicontract.AssetContentData{AssetContent: (*apicontract.AssetContent)(assetContent)})
})

var getAssetContentByPath = contractHandler(apicontract.GetAssetContentByPath, func(c *gin.Context, request apicontract.SearchPathRequest) apicontract.Response[apicontract.AssetContentData] {
	assetContent := model.GetAssetContentByPath(request.Path)
	if model.IsReadOnlyRoleContext(c) && assetContent != nil {
		publishAccess := model.GetPublishAccess()
		filtered := model.FilterAssetContentByPublishAccess(c, publishAccess, []*model.AssetContent{assetContent})
		if len(filtered) > 0 {
			assetContent = filtered[0]
		} else {
			assetContent = nil
		}
	}
	return apicontract.Success(apicontract.AssetContentData{AssetContent: (*apicontract.AssetContent)(assetContent)})
})

var fullTextSearchAssetContent = contractHandler(apicontract.FullTextSearchAssetContent, func(c *gin.Context, request apicontract.SearchAssetContentRequest) apicontract.Response[apicontract.SearchAssetContentData] {
	page, pageSize := request.Pagination()
	query, types, method, orderBy := request.Query, request.Types, int(request.Method), int(request.OrderBy)
	if method == 2 && !model.IsAdminRoleContext(c) {
		return apicontract.Failure[apicontract.SearchAssetContentData](-1, "SQL search requires administrator privileges")
	}

	isReadOnlyRole := model.IsReadOnlyRoleContext(c)
	searchPage, searchPageSize := page, pageSize
	if isReadOnlyRole {
		searchPage = 1
		searchPageSize = model.Conf.Search.Limit
	}
	assetContents, matchedAssetCount, pageCount, err := model.FullTextSearchAssetContent(query, types, method, orderBy, searchPage, searchPageSize)
	if err != nil {
		return apicontract.Failure[apicontract.SearchAssetContentData](-1, err.Error())
	}
	if isReadOnlyRole {
		publishAccess := model.GetPublishAccess()
		assetContents = model.FilterAssetContentByPublishAccess(c, publishAccess, assetContents)
		matchedAssetCount = len(assetContents)
		pageCount = (matchedAssetCount + pageSize - 1) / pageSize
		if page > pageCount {
			assetContents = []*model.AssetContent{}
		} else {
			from := (page - 1) * pageSize
			to := min(from+pageSize, matchedAssetCount)
			assetContents = assetContents[from:to]
		}
	}
	var result []*apicontract.AssetContent
	if assetContents != nil {
		result = make([]*apicontract.AssetContent, len(assetContents))
		for i, value := range assetContents {
			result[i] = (*apicontract.AssetContent)(value)
		}
	}
	return apicontract.Success(apicontract.SearchAssetContentData{AssetContents: result, MatchedAssetCount: matchedAssetCount, PageCount: pageCount})
})

var findReplace = contractHandler(apicontract.FindReplace, func(c *gin.Context, request apicontract.FindReplaceRequest) apicontract.Response[apicontract.Null] {
	_, _, _, paths, boxes, types, subTypes, method, _, _ := parseSearchBlockRequest(request.SearchBlockRequest)

	k, r := request.K, request.R
	ids := append([]string(nil), request.IDs...)
	replaceTypes := request.ReplaceTypes
	if replaceTypes == nil {
		replaceTypes = map[string]bool{}
	}

	boxID := ""
	if 1 == len(boxes) && model.IsEncryptedBox(boxes[0]) {
		boxID = boxes[0]
		if err := holdEncryptedBoxRequest(c, boxID); err != nil {
			return apicontract.Failure[apicontract.Null](1, err.Error())
		}
	}

	err := model.FindReplaceInBox(k, r, replaceTypes, ids, paths, boxes, types, subTypes, method, boxID)
	if err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](1, err.Error(), 5000)
	}
	return apicontract.Success(apicontract.Null{})
})

var searchAsset = contractHandler(apicontract.SearchAssetByName, func(c *gin.Context, request apicontract.SearchAssetRequest) apicontract.Response[[]*apicontract.SearchAsset] {
	var exts []string
	exts = append(exts, request.Exts...)
	assets := model.SearchAssetsByName(request.K, exts)
	var result []*apicontract.SearchAsset
	if assets != nil {
		result = make([]*apicontract.SearchAsset, len(assets))
		for i, asset := range assets {
			result[i] = (*apicontract.SearchAsset)(asset)
		}
	}
	return apicontract.Success(result)
})

var searchTag = contractHandler(apicontract.SearchTag, func(c *gin.Context, request apicontract.SearchTagRequest) apicontract.Response[apicontract.SearchTagData] {

	k := request.K
	tags := model.SearchTags(k)
	if 1 > len(tags) {
		tags = []string{}
	}
	return apicontract.Success(apicontract.SearchTagData{Tags: tags, K: k})
})

var searchWidget = contractHandler(apicontract.SearchWidget, func(c *gin.Context, request apicontract.SearchKeywordRequest) apicontract.Response[apicontract.SearchWidgetData] {
	values := model.SearchWidget(request.K)
	var result []*apicontract.SearchWidgetResult
	if values != nil {
		result = make([]*apicontract.SearchWidgetResult, len(values))
		for i, value := range values {
			result[i] = (*apicontract.SearchWidgetResult)(value)
		}
	}
	return apicontract.Success(apicontract.SearchWidgetData{Widgets: result, K: request.K})
})

var removeTemplate = contractHandler(apicontract.RemoveSearchTemplate, func(c *gin.Context, request apicontract.SearchPathRequest) apicontract.Response[apicontract.Null] {
	if err := model.RemoveTemplate(request.Path); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var searchTemplate = contractHandler(apicontract.SearchTemplate, func(c *gin.Context, request apicontract.SearchKeywordRequest) apicontract.Response[apicontract.SearchTemplateData] {
	values := model.SearchTemplate(request.K)
	var result []*apicontract.SearchTemplateResult
	if values != nil {
		result = make([]*apicontract.SearchTemplateResult, len(values))
		for i, value := range values {
			result[i] = (*apicontract.SearchTemplateResult)(value)
		}
	}
	return apicontract.Success(apicontract.SearchTemplateData{Templates: result, K: request.K})
})

var getEmbedBlock = contractHandler(apicontract.GetEmbedBlock, func(c *gin.Context, request apicontract.GetEmbedBlockRequest) apicontract.Response[apicontract.EmbedBlocksData] {
	embedBlockID, headingMode, breadcrumb := request.EmbedBlockID, int(request.HeadingMode), request.Breadcrumb
	includeIDs := append([]string(nil), request.IncludeIDs...)
	notebook := ""
	if model.IsEncryptedBox(request.Notebook) {
		notebook = request.Notebook
	}
	isReadOnlyRole := model.IsReadOnlyRoleContext(c)
	var blocks []*model.EmbedBlock
	if isReadOnlyRole {
		publishAccess := model.GetPublishAccess()
		if !model.CheckBlockIdAccessableByPublishAccess(c, publishAccess, embedBlockID) {
			return apicontract.Failure[apicontract.EmbedBlocksData](-1, fmt.Sprintf(model.Conf.Language(15), embedBlockID))
		}
		blocks = model.GetEmbedBlockForPublish(embedBlockID, includeIDs, headingMode, breadcrumb)
		blocks = model.FilterEmbedBlocksByPublishAccess(c, publishAccess, blocks)
	} else {
		if notebook == "" {
			blocks = model.GetEmbedBlock(embedBlockID, includeIDs, headingMode, breadcrumb)
		} else {
			blocks = model.GetEmbedBlockInBox(embedBlockID, includeIDs, headingMode, breadcrumb, notebook)
		}
	}
	return apicontract.Success(apicontract.EmbedBlocksData{Blocks: embedBlockContracts(blocks)})
})

var updateEmbedBlock = contractHandler(apicontract.UpdateEmbedBlock, func(c *gin.Context, request apicontract.UpdateEmbedBlockRequest) apicontract.Response[apicontract.Null] {
	if err := model.UpdateEmbedBlock(request.ID, request.Content); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
}, func(c *gin.Context) *apicontract.Response[apicontract.Null] {
	if model.IsReadOnlyRoleContext(c) {
		response := apicontract.Success(apicontract.Null{})
		return &response
	}
	return nil
})

var searchEmbedBlock = contractHandler(apicontract.SearchEmbedBlock, func(c *gin.Context, request apicontract.SearchEmbedBlockRequest) apicontract.Response[apicontract.EmbedBlocksData] {
	embedBlockID, headingMode, breadcrumb := request.EmbedBlockID, int(request.HeadingMode), request.Breadcrumb
	stmt, boxID := request.Stmt, request.Notebook
	var excludeIDs []string
	for _, id := range request.ExcludeIDs {
		if id != nil {
			excludeIDs = append(excludeIDs, *id)
		}
	}
	isReadOnlyRole := model.IsReadOnlyRoleContext(c)
	var publishAccess model.PublishAccess
	if isReadOnlyRole {
		publishAccess = model.GetPublishAccess()
		if !model.CheckBlockIdAccessableByPublishAccess(c, publishAccess, embedBlockID) {
			return apicontract.Failure[apicontract.EmbedBlocksData](-1, fmt.Sprintf(model.Conf.Language(15), embedBlockID))
		}
		var err error
		stmt, boxID, err = model.GetQueryEmbedStatement(embedBlockID)
		if nil != err {
			return apicontract.Failure[apicontract.EmbedBlocksData](-1, err.Error())
		}
	}

	if err := sql.CheckSingleStatement(stmt); nil != err {
		return apicontract.Failure[apicontract.EmbedBlocksData](-1, err.Error())
	}
	if err := sql.CheckReadonlyStatementInBox(stmt, boxID); nil != err {
		return apicontract.Failure[apicontract.EmbedBlocksData](-1, err.Error())
	}

	var blocks []*model.EmbedBlock
	if isReadOnlyRole {
		blocks = model.SearchEmbedBlockForPublish(embedBlockID, stmt, excludeIDs, headingMode, breadcrumb, boxID)
		blocks = model.FilterEmbedBlocksByPublishAccess(c, publishAccess, blocks)
	} else {
		blocks = model.SearchEmbedBlockInBox(embedBlockID, stmt, excludeIDs, headingMode, breadcrumb, boxID)
	}
	return apicontract.Success(apicontract.EmbedBlocksData{Blocks: embedBlockContracts(blocks)})
})

var searchRefBlock = contractHandler(apicontract.SearchRefBlock, func(c *gin.Context, request apicontract.SearchRefBlockRequest) apicontract.Response[apicontract.SearchRefData] {
	echo := apicontract.SearchRefEcho(request.ReqID)
	if request.ID == nil {
		return apicontract.Success(echo)
	}
	notebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, notebook) {
		keyword, err := request.Keyword()
		if err != nil {
			return apicontract.SearchRefBlock.FailureWithData(-1, err.Error(), echo)
		}
		return apicontract.Success(apicontract.SearchRefBlocks(apicontract.SearchRefResult{SearchRefCorrelation: apicontract.SearchRefCorrelation{ReqID: request.ReqID}, Blocks: []*apicontract.SearchBlock{}, K: util.EscapeHTML(keyword)}))
	}
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		return apicontract.SearchRefBlock.FailureWithData(-1, err.Error(), echo)
	}
	params, err := request.Parameters()
	if err != nil {
		return apicontract.SearchRefBlock.FailureWithData(-1, err.Error(), echo)
	}
	rootID, id, keyword, beforeLen := params.RootID, params.ID, params.K, int(params.BeforeLen)
	isSquareBrackets, isDatabase := params.IsSquareBrackets, params.IsDatabase
	// 加密笔记本内的块引搜索走 InBox 版（只搜该 box 自己的加密 db，阻止跨加密边界引用）
	var blocks []*model.Block
	var newDoc bool
	if notebook != "" && model.IsEncryptedBox(notebook) {
		blocks, newDoc = model.SearchRefBlockInBox(id, rootID, keyword, beforeLen, isSquareBrackets, isDatabase, notebook)
	} else {
		blocks, newDoc = model.SearchRefBlock(id, rootID, keyword, beforeLen, isSquareBrackets, isDatabase)
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		blocks = model.FilterBlocksByPublishAccess(c, publishAccess, blocks)
	}
	return apicontract.Success(apicontract.SearchRefBlocks(apicontract.SearchRefResult{SearchRefCorrelation: apicontract.SearchRefCorrelation{ReqID: request.ReqID}, Blocks: searchBlockContracts(blocks), NewDoc: newDoc, K: util.EscapeHTML(keyword)}))
})

var fullTextSearchBlock = contractHandler(apicontract.FullTextSearchBlock, func(c *gin.Context, request apicontract.FullTextSearchBlockRequest) apicontract.Response[*apicontract.FullTextSearchBlockData] {
	page, pageSize, query, paths, boxes, types, subTypes, method, orderBy, groupBy := parseSearchBlockRequest(request.SearchBlockRequest)

	// SQL mode requires admin privileges, consistent with /api/query/sql
	if method == 2 && !model.IsAdminRoleContext(c) {
		return apicontract.Failure[*apicontract.FullTextSearchBlockData](-1, "SQL search requires administrator privileges")
	}

	// SQL mode is blocked in read-only mode, consistent with /api/query/sql
	if method == 2 && util.ReadOnly {
		return apicontract.FailureWithTimeout[*apicontract.FullTextSearchBlockData](-1, model.Conf.Language(34), 5000)
	}

	notebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, notebook) {
		return apicontract.Success(&apicontract.FullTextSearchBlockData{SearchBlocksData: apicontract.SearchBlocksData{Blocks: []*apicontract.SearchBlock{}}})
	}

	var blocks []*model.Block
	var matchedBlockCount, matchedRootCount, pageCount int
	var docMode bool
	searchHPath := true
	if request.SearchHPath != nil {
		searchHPath = *request.SearchHPath
	}
	// 加密笔记本的全文搜索走 InBox 版（查加密 content db + blocks_fts）
	var excludeBoxIDs, excludeDocIDs []string
	if model.IsReadOnlyRoleContext(c) {
		denyAll, deniedBoxIDs, deniedDocIDs := model.GetPublishAccessSearchExclusion(c)
		if denyAll {
			return apicontract.Success(&apicontract.FullTextSearchBlockData{SearchBlocksData: apicontract.SearchBlocksData{Blocks: []*apicontract.SearchBlock{}}})
		}
		excludeBoxIDs, excludeDocIDs = deniedBoxIDs, deniedDocIDs
	}
	if notebook != "" && model.IsEncryptedBox(notebook) {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			return apicontract.Failure[*apicontract.FullTextSearchBlockData](-1, err.Error())
		}
		blocks, matchedBlockCount, matchedRootCount, pageCount, docMode = model.FullTextSearchBlockInBoxWithHPathContext(c.Request.Context(), query, boxes, paths, types, subTypes, method, orderBy, groupBy, page, pageSize, notebook, searchHPath, excludeBoxIDs, excludeDocIDs)
	} else {
		blocks, matchedBlockCount, matchedRootCount, pageCount, docMode = model.FullTextSearchBlockInBoxWithHPathContext(c.Request.Context(), query, boxes, paths, types, subTypes, method, orderBy, groupBy, page, pageSize, "", searchHPath, excludeBoxIDs, excludeDocIDs)
	}
	if c.Request.Context().Err() != nil {
		return apicontract.Success[*apicontract.FullTextSearchBlockData](nil)
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		blocks = model.FilterBlocksByPublishAccess(c, publishAccess, blocks)
	}
	return apicontract.Success(&apicontract.FullTextSearchBlockData{SearchBlocksData: apicontract.SearchBlocksData{Blocks: searchBlockContracts(blocks), MatchedBlockCount: matchedBlockCount, MatchedRootCount: matchedRootCount, PageCount: pageCount}, DocMode: docMode})
})

func parseSearchBlockRequest(request apicontract.SearchBlockRequest) (page, pageSize int, query string, paths, boxes []string, types, subTypes map[string]bool, method, orderBy, groupBy int) {
	page, pageSize = request.Pagination()
	query, types, subTypes = request.Query, request.Types, request.SubTypes.Selected()
	method, orderBy, groupBy = int(request.Method), int(request.OrderBy), int(request.GroupBy)
	pathsArg := request.Paths
	if nil != pathsArg {
		for _, p := range pathsArg {
			path := p
			box := strings.TrimSpace(strings.Split(path, "/")[0])
			path = strings.TrimSpace(strings.TrimPrefix(path, box))
			// 入口校验：拒绝带 SQL 元字符的非法笔记本 ID 与文档路径，阻止 SQL 注入。
			// 与既有静默去重风格一致，对非法整条丢弃而非中断请求。
			if !model.IsValidSearchBoxPath(box, path) {
				continue
			}
			if "" != box {
				boxes = append(boxes, box)
			}
			if "" != path {
				paths = append(paths, path)
			}
		}
		paths = gulu.Str.RemoveDuplicatedElem(paths)
		boxes = gulu.Str.RemoveDuplicatedElem(boxes)
	}

	return
}

var semanticSearchBlock = contractHandler(apicontract.SemanticSearchBlock, func(c *gin.Context, request apicontract.SearchBlockRequest) apicontract.Response[apicontract.SearchBlocksData] {
	page, pageSize, query, paths, boxes, types, subTypes, _, _, _ := parseSearchBlockRequest(request)

	var excludeBoxIDs, excludeDocIDs []string
	if model.IsReadOnlyRoleContext(c) {
		denyAll, deniedBoxIDs, deniedDocIDs := model.GetPublishAccessSearchExclusion(c)
		if denyAll {
			return apicontract.Success(apicontract.SearchBlocksData{Blocks: []*apicontract.SearchBlock{}})
		}
		excludeBoxIDs, excludeDocIDs = deniedBoxIDs, deniedDocIDs
	}

	blocks, matchedBlockCount, matchedRootCount, pageCount := model.SemanticSearchBlock(query, boxes, paths, types, subTypes, page, pageSize, excludeBoxIDs, excludeDocIDs)
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		blocks = model.FilterBlocksByPublishAccess(c, publishAccess, blocks)
	}
	return apicontract.Success(apicontract.SearchBlocksData{Blocks: searchBlockContracts(blocks), MatchedBlockCount: matchedBlockCount, MatchedRootCount: matchedRootCount, PageCount: pageCount})
})

func embedBlockContracts(values []*model.EmbedBlock) []*apicontract.EmbedBlock {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.EmbedBlock, len(values))
	for i, value := range values {
		if value != nil {
			result[i] = &apicontract.EmbedBlock{Block: searchBlockContracts([]*model.Block{value.Block})[0], BlockPaths: blockPathContracts(value.BlockPaths), AllowChildOperation: value.AllowChildOperation}
		}
	}
	return result
}
