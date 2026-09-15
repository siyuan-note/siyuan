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
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var checkBlockRef = contractHandler(apicontract.CheckBlockRef, func(c *gin.Context, request apicontract.CheckBlockRefRequest) apicontract.Response[bool] {
	ret := gulu.Ret.NewResult()
	switch request.Scope {
	case "blocks":
		ids, exactIDs, deletedIDs := request.IDs, request.ExactIDs, request.DeletedIDs
		for _, id := range ids {
			if util.InvalidIDPattern(id, ret) {
				return contractFailure[bool](ret)
			}
		}
		idSet := map[string]struct{}{}
		for _, id := range ids {
			idSet[id] = struct{}{}
		}
		for _, id := range exactIDs {
			if util.InvalidIDPattern(id, ret) {
				return contractFailure[bool](ret)
			}
			if _, exists := idSet[id]; !exists {
				ret.Code = -1
				ret.Msg = "Field [exactIDs] should be a subset of field [ids]"
				return contractFailure[bool](ret)
			}
		}
		for _, id := range deletedIDs {
			if util.InvalidIDPattern(id, ret) {
				return contractFailure[bool](ret)
			}
			if _, exists := idSet[id]; !exists {
				ret.Code = -1
				ret.Msg = "Field [deletedIDs] should be a subset of field [ids]"
				return contractFailure[bool](ret)
			}
		}
		notebook := request.Notebook
		if "" != notebook && util.InvalidIDPattern(notebook, ret) {
			return contractFailure[bool](ret)
		}
		if err := holdEncryptedBlockRequests(c, notebook, append([]string{request.ID}, request.IDs...), true); err != nil {
			return apicontract.Failure[bool](-1, err.Error())
		}
		ids = filterBlockIDsByPublishAccess(c, ids, notebook)
		exactIDs = filterBlockIDsByPublishAccess(c, exactIDs, notebook)
		deletedIDs = filterBlockIDsByPublishAccess(c, deletedIDs, notebook)
		data, err := model.CheckBlockRefInBox(ids, exactIDs, deletedIDs, notebook)
		if err != nil {
			return apicontract.CheckBlockRef.FailureWithData(-1, err.Error(), data)
		}
		return apicontract.Success(data)
	case "documents":
		paths := request.Paths
		if model.IsReadOnlyRoleContext(c) {
			publishAccess := model.GetPublishAccess()
			var accessiblePaths []string
			for _, p := range paths {
				if model.CheckBlockIdAccessableByPublishAccess(c, publishAccess, util.GetTreeID(p)) {
					accessiblePaths = append(accessiblePaths, p)
				}
			}
			paths = accessiblePaths
		}
		if 0 == len(paths) {
			return apicontract.Success(false)
		}
		data, err := model.CheckDocsRef(paths)
		if err != nil {
			return apicontract.CheckBlockRef.FailureWithData(-1, err.Error(), data)
		}
		return apicontract.Success(data)
	case "notebook":
		notebook := request.Notebook
		if util.InvalidIDPattern(notebook, ret) {
			return contractFailure[bool](ret)
		}
		if err := holdEncryptedBlockRequests(c, notebook, append([]string{request.ID}, request.IDs...), false); err != nil {
			return apicontract.Failure[bool](-1, err.Error())
		}
		if model.IsReadOnlyRoleContext(c) {
			publishAccess := model.GetPublishAccess()
			accessible := false
			for _, rootID := range treenode.GetRootBlockIDsByBoxID(notebook) {
				if model.CheckBlockIdAccessableByPublishAccessInBox(c, publishAccess, rootID, notebook) {
					accessible = true
					break
				}
			}
			if !accessible {
				return apicontract.Success(false)
			}
		}
		data, err := model.CheckNotebookRef(notebook)
		if err != nil {
			return apicontract.CheckBlockRef.FailureWithData(-1, err.Error(), data)
		}
		return apicontract.Success(data)
	default:
		ret.Code = -1
		ret.Msg = "invalid block ref check scope"
	}
	return contractFailure[bool](ret)
})

var getBlockTreeInfos = contractHandler(apicontract.GetBlockTreeInfos, func(c *gin.Context, request apicontract.BlocksQueryRequest) apicontract.Response[map[string]*apicontract.BlockTreeInfo] {
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[map[string]*apicontract.BlockTreeInfo](-1, err.Error())
	}
	ids := filterBlockIDsByPublishAccess(c, request.IDs, boxID)
	return apicontract.Success(blockTreeInfoContracts(model.GetBlockTreeInfosInBox(ids, boxID)))
})

var getBlockSiblingID = contractHandler(apicontract.GetBlockSiblingID, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[apicontract.BlockSiblingData] {
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[apicontract.BlockSiblingData](-1, err.Error())
	}
	if !isBlockPublishAccessible(c, request.ID, boxID) {
		return apicontract.Success(apicontract.BlockSiblingData{})
	}
	parent, previous, next := model.GetBlockSiblingIDInBox(request.ID, boxID)
	return apicontract.Success(apicontract.BlockSiblingData{Parent: parent, Previous: previous, Next: next})
})

var getBlockRelevantIDs = contractHandler(apicontract.GetBlockRelevantIDs, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[apicontract.BlockRelevantData] {
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[apicontract.BlockRelevantData](-1, err.Error())
	}
	if !isBlockPublishAccessible(c, request.ID, boxID) {
		return apicontract.Success(apicontract.BlockRelevantData{})
	}
	parent, previous, next, err := model.GetBlockRelevantIDsInBox(request.ID, boxID)
	if err != nil {
		return apicontract.FailureWithTimeout[apicontract.BlockRelevantData](-1, err.Error(), 7000)
	}
	return apicontract.Success(apicontract.BlockRelevantData{ParentID: parent, PreviousID: previous, NextID: next})
})

var transferBlockRef = contractHandler(apicontract.TransferBlockRef, func(c *gin.Context, request apicontract.TransferBlockRefRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.FromID, ret) || util.InvalidIDPattern(request.ToID, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	var refIDs []string
	refIDs = append(refIDs, request.RefIDs...)
	if err := model.TransferBlockRef(request.FromID, request.ToID, refIDs); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 7000)
	}
	if request.ReloadUI == nil || *request.ReloadUI {
		util.ReloadUI()
	}
	return apicontract.Success(apicontract.Null{})
})

var swapBlockRef = contractHandler(apicontract.SwapBlockRef, func(c *gin.Context, request apicontract.SwapBlockRefRequest) apicontract.Response[apicontract.Null] {
	if err := model.SwapBlockRef(request.RefID, request.DefID, request.IncludeChildren, request.OriginalToEmbed); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 7000)
	}
	return apicontract.Success(apicontract.Null{})
})

var getHeadingChildrenIDs = contractHandler(apicontract.GetHeadingChildrenIDs, func(c *gin.Context, request apicontract.BlockIDRequest) apicontract.Response[[]string] {
	ret := gulu.Ret.NewResult()
	if !checkBlockPublishAccess(c, request.ID, ret) {
		return contractFailure[[]string](ret)
	}
	return apicontract.Success(model.GetHeadingChildrenIDs(request.ID))
})

var appendHeadingChildren = contractHandler(apicontract.AppendHeadingChildren, func(c *gin.Context, request apicontract.AppendHeadingChildrenRequest) apicontract.Response[apicontract.Null] {
	model.AppendHeadingChildren(request.ID, request.ChildrenDOM)
	return apicontract.Success(apicontract.Null{})
})

var getHeadingChildrenDOM = contractHandler(apicontract.GetHeadingChildrenDOM, func(c *gin.Context, request apicontract.HeadingChildrenRequest) apicontract.Response[string] {
	ret := gulu.Ret.NewResult()
	if !checkBlockPublishAccess(c, request.ID, ret) {
		return contractFailure[string](ret)
	}
	removeFoldAttr := true
	if request.RemoveFoldAttr != nil {
		removeFoldAttr = *request.RemoveFoldAttr
	}
	return apicontract.Success(model.GetHeadingChildrenDOM(request.ID, removeFoldAttr))
})

var getHeadingDeleteTransaction = contractHandler(apicontract.GetHeadingDeleteTransaction, func(c *gin.Context, request apicontract.BlockIDRequest) apicontract.Response[*apicontract.BlockTransaction] {
	id := request.ID

	transaction, err := model.GetHeadingDeleteTransaction(id)
	if err != nil {
		return apicontract.FailureWithTimeout[*apicontract.BlockTransaction](-1, err.Error(), 7000)
	}

	return blockTransactionResponse(transaction)
})

var getHeadingInsertTransaction = contractHandler(apicontract.GetHeadingInsertTransaction, func(c *gin.Context, request apicontract.BlockIDRequest) apicontract.Response[*apicontract.BlockTransaction] {
	id := request.ID

	transaction, err := model.GetHeadingInsertTransaction(id)
	if err != nil {
		return apicontract.FailureWithTimeout[*apicontract.BlockTransaction](-1, err.Error(), 7000)
	}

	return blockTransactionResponse(transaction)
})

var getDocHeadingLevelTransaction = contractHandler(apicontract.GetDocHeadingLevelTransaction, func(c *gin.Context, request apicontract.DocHeadingLevelRequest) apicontract.Response[*apicontract.DocHeadingLevelData] {
	if request.ID == "" || request.Source < 0 || request.Source > 6 || request.Target < 0 || request.Target > 6 || (request.Source == 0) != (request.Target == 0) {
		return apicontract.Failure[*apicontract.DocHeadingLevelData](-1, "invalid heading conversion parameters")
	}
	result, err := model.GetDocHeadingLevelTransaction(request.ID, request.Notebook, request.Source, request.Target, request.WithSubheadings)
	if err != nil {
		return apicontract.Failure[*apicontract.DocHeadingLevelData](-1, err.Error())
	}
	transaction, err := blockTransactionContract(result.Transaction)
	if err != nil {
		return apicontract.Failure[*apicontract.DocHeadingLevelData](-1, err.Error())
	}
	return apicontract.Success(&apicontract.DocHeadingLevelData{Counts: result.Counts[:], WithSubheadingCounts: result.WithSubheadingCounts[:], Title: result.Title, Transaction: transaction})
})

var getHeadingLevelTransaction = contractHandler(apicontract.GetHeadingLevelTransaction, func(c *gin.Context, request apicontract.HeadingLevelRequest) apicontract.Response[*apicontract.BlockTransaction] {
	ids := request.IDs
	if ids == nil {
		ids = []string{request.ID}
	}
	transaction, err := model.GetHeadingLevelBatchTransaction(ids, int(request.Level))
	if err != nil {
		return apicontract.FailureWithTimeout[*apicontract.BlockTransaction](-1, err.Error(), 7000)
	}
	return blockTransactionResponse(transaction)
})

var getHeadingFoldTransaction = contractHandler(apicontract.GetHeadingFoldTransaction, func(c *gin.Context, request apicontract.HeadingFoldRequest) apicontract.Response[*apicontract.BlockTransaction] {
	id := request.ID
	scope := request.Scope

	transaction, err := model.GetHeadingFoldTransaction(id, scope)
	if err != nil {
		return apicontract.FailureWithTimeout[*apicontract.BlockTransaction](-1, err.Error(), 7000)
	}

	return blockTransactionResponse(transaction)
})

var setBlockReminder = contractHandler(apicontract.SetBlockReminder, func(c *gin.Context, request apicontract.BlockReminderRequest) apicontract.Response[apicontract.Null] {
	if err := model.SetBlockReminder(request.ID, request.Timed); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 7000)
	}
	return apicontract.Success(apicontract.Null{})
})

var setCloudReminder = contractHandler(apicontract.SetCloudReminder, func(c *gin.Context, request apicontract.CloudReminderRequest) apicontract.Response[apicontract.Null] {
	if err := model.SetCloudReminder(request.ID, request.Content, request.Timed); err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 7000)
	}
	return apicontract.Success(apicontract.Null{})
})

var getUnfoldedParentID = contractHandler(apicontract.GetUnfoldedParentID, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[apicontract.UnfoldedParentData] {
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[apicontract.UnfoldedParentData](-1, err.Error())
	}
	if !isBlockPublishAccessible(c, request.ID, boxID) {
		return apicontract.Success(apicontract.UnfoldedParentData{})
	}
	return apicontract.Success(apicontract.UnfoldedParentData{ParentID: model.GetUnfoldedParentID(request.ID)})
})

var checkBlockFold = contractHandler(apicontract.CheckBlockFold, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[apicontract.BlockFoldData] {
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, true)
	if err != nil {
		return apicontract.Failure[apicontract.BlockFoldData](-1, err.Error())
	}
	if !isBlockPublishAccessible(c, request.ID, boxID) {
		return apicontract.Success(apicontract.BlockFoldData{})
	}
	isFolded, isRoot := model.IsBlockFolded(request.ID)
	return apicontract.Success(apicontract.BlockFoldData{IsFolded: isFolded, IsRoot: isRoot})
})

var checkBlockExist = contractHandler(apicontract.CheckBlockExist, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[bool] {
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, true)
	if err != nil {
		return apicontract.Failure[bool](-1, err.Error())
	}
	if !isBlockPublishAccessible(c, request.ID, boxID) {
		return apicontract.Success(false)
	}
	return apicontract.Success(treenode.ExistBlockTree(request.ID))
})

var checkBlocksExist = contractHandler(apicontract.CheckBlocksExist, func(c *gin.Context, request apicontract.CheckBlocksExistRequest) apicontract.Response[map[string]bool] {
	var ids, leaseIDs []string
	for _, value := range request.IDs {
		if id, ok := value.StringValue(); ok {
			leaseIDs = append(leaseIDs, id)
			if ast.IsNodeIDPattern(id) {
				ids = append(ids, id)
			}
		}
	}
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, leaseIDs, true)
	if err != nil {
		return apicontract.Failure[map[string]bool](-1, err.Error())
	}
	ids = filterBlockIDsByPublishAccess(c, ids, boxID)
	return apicontract.Success(treenode.ExistBlockTreesInBox(ids, boxID))
})

var getDocInfo = contractHandler(apicontract.GetDocInfo, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[*apicontract.DocInfo] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	boxID, leaseErr := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if leaseErr != nil {
		return apicontract.Failure[*apicontract.DocInfo](-1, leaseErr.Error())
	}
	if !checkBlockPublishAccessInBox(c, id, boxID, ret) {
		return contractFailure[*apicontract.DocInfo](ret)
	}

	var info *model.BlockInfo
	var err error
	if boxID != "" {
		info, err = model.GetDocInfoInBox(id, boxID)
	} else {
		info, err = model.GetDocInfo(id)
	}
	if nil == info {
		ret.Code = -1
		if errors.Is(err, model.ErrIndexing) {
			ret.Msg = model.Conf.Language(56)
		} else if err != nil && !errors.Is(err, model.ErrTreeNotFound) {
			ret.Msg = err.Error()
		} else {
			ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
		}
		return contractFailure[*apicontract.DocInfo](ret)
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		info = model.FilterBlockInfoByPublishAccess(c, publishAccess, info)
	}
	return apicontract.Success(docInfoContract(info))
})

var getDocsInfo = contractHandler(apicontract.GetDocsInfo, func(c *gin.Context, request apicontract.DocsInfoRequest) apicontract.Response[[]*apicontract.DocInfo] {
	ret := gulu.Ret.NewResult()

	idsArg := request.IDs
	isReadOnlyRole := model.IsReadOnlyRoleContext(c)
	var publishAccess model.PublishAccess
	if isReadOnlyRole {
		publishAccess = model.GetPublishAccess()
	}
	var ids []string
	for _, id := range idsArg {
		idStr := id
		if isReadOnlyRole && !model.CheckBlockIdAccessableByPublishAccess(c, publishAccess, idStr) {
			continue
		}
		ids = append(ids, idStr)
	}
	if isReadOnlyRole && 0 < len(idsArg) && len(ids) == 0 {
		return apicontract.Success([]*apicontract.DocInfo{})
	}
	queryRefCount := request.RefCount
	queryAv := request.AV
	info := model.GetDocsInfo(ids, queryRefCount, queryAv)
	if nil == info {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(15), ids)
		return contractFailure[[]*apicontract.DocInfo](ret)
	}
	if isReadOnlyRole {
		for i, docinfo := range info {
			info[i] = model.FilterBlockInfoByPublishAccess(c, publishAccess, docinfo)
		}
	}
	return apicontract.Success(docInfoContracts(info))
})

var getRecentUpdatedBlocks = contractHandler(apicontract.GetRecentUpdatedBlocks, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[[]*apicontract.SearchBlock] {
	blocks := model.RecentUpdatedBlocks()
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		blocks = model.FilterBlocksByPublishAccess(c, publishAccess, blocks)
	}
	return apicontract.Success(searchBlockContracts(blocks))
})

var getContentWordCount = contractHandler(apicontract.GetContentWordCount, func(c *gin.Context, request apicontract.ContentWordCountRequest) apicontract.Response[apicontract.WordCountData] {
	return apicontract.Success(apicontract.WordCountData{ReqID: request.ReqID, Stat: blockStatContract(filesys.ContentStat(request.Content))})
})

var getBlocksWordCount = contractHandler(apicontract.GetBlocksWordCount, func(c *gin.Context, request apicontract.BlocksWordCountRequest) apicontract.Response[apicontract.WordCountData] {
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, true)
	if err != nil {
		return apicontract.Failure[apicontract.WordCountData](-1, err.Error())
	}
	ids := filterBlockIDsByPublishAccess(c, request.IDs, boxID)
	return apicontract.Success(apicontract.WordCountData{ReqID: request.ReqID, Stat: blockStatContract(filesys.BlocksWordCount(ids))})
})

var getTreeStat = contractHandler(apicontract.GetTreeStat, func(c *gin.Context, request apicontract.TreeStatRequest) apicontract.Response[apicontract.TreeStatData] {
	ret := gulu.Ret.NewResult()
	id, includeEmbed := strings.TrimSpace(request.ID), request.IncludeEmbed
	if id == "" {
		return apicontract.Failure[apicontract.TreeStatData](-1, "Field [id] must not be empty")
	}
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.TreeStatData](ret)
	}
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[apicontract.TreeStatData](-1, err.Error())
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		return apicontract.Success(apicontract.TreeStatData{ReqID: request.ReqID})
	}
	var accessChecker model.EmbedBlockAccessChecker
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		accessChecker = func(blockID string) bool {
			return model.CheckBlockIdAccessableByPublishAccessInBox(c, publishAccess, blockID, boxID)
		}
	}
	stat := model.GetDocumentStat(c.Request.Context(), id, boxID, includeEmbed, accessChecker)
	return apicontract.Success(treeStatContract(request.ReqID, stat, includeEmbed))
})

var getDOMText = contractHandler(apicontract.GetDOMText, func(c *gin.Context, request apicontract.DOMTextRequest) apicontract.Response[string] {
	return apicontract.Success(model.GetDOMText(request.DOM))
})

var getRefText = contractHandler(apicontract.GetRefText, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[string] {
	ret := gulu.Ret.NewResult()
	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[string](ret)
	}

	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[string](-1, err.Error())
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		return apicontract.Success(model.ErrBlockNotFound.Error())
	}

	// 加密笔记本的块引解析走 InBox 版（查加密 blocktree + content db）
	var refText string
	if boxID != "" {
		refText = model.GetBlockRefTextInBox(id, boxID)
	} else {
		refText = model.GetBlockRefText(id)
	}
	if "" == refText {
		// 空块返回 id https://github.com/siyuan-note/siyuan/issues/10259
		refText = id
		return apicontract.Success(refText)
	}

	if strings.Count(refText, "\\") == len(refText) {
		// 全部都是 \ 的话使用实体 https://github.com/siyuan-note/siyuan/issues/11473
		refText = strings.ReplaceAll(refText, "\\", "&#92;")
		return apicontract.Success(refText)
	}

	return apicontract.Success(refText)
})

var getRefIDs = contractHandler(apicontract.GetRefIDs, func(c *gin.Context, request apicontract.RefIDsRequest) apicontract.Response[apicontract.RefIDsData] {
	id := request.ID
	requestedNotebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		return apicontract.Success(apicontract.RefIDsData{RefDefs: []*apicontract.RefDefs{}, OriginalRefBlockIDs: map[string]string{}})
	}
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[apicontract.RefIDsData](-1, err.Error())
	}
	refDefs, originalRefBlockIDs := model.GetBlockRefsInBox(id, boxID)
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		refDefs, originalRefBlockIDs = model.FilterRefDefsByPublishAccess(c, publishAccess, refDefs)
	}
	return apicontract.Success(apicontract.RefIDsData{RefDefs: refDefContracts(refDefs), OriginalRefBlockIDs: originalRefBlockIDs})
})

var getRefIDsByFileAnnotationID = contractHandler(apicontract.GetRefIDsByFileAnnotationID, func(c *gin.Context, request apicontract.FileAnnotationRefRequest) apicontract.Response[apicontract.RefDefsData] {
	id := request.ID
	boxID := request.Notebook
	refIDs := model.GetBlockRefIDsByFileAnnotationIDInBox(id, boxID)
	if model.IsReadOnlyRoleContext(c) {
		refIDs = model.FilterRefIDsByPublishAccess(c, model.GetPublishAccess(), refIDs)
	}
	var retRefDefs []apicontract.RefDefs
	for _, blockID := range refIDs {
		retRefDefs = append(retRefDefs, apicontract.RefDefs{RefID: blockID, DefIDs: []string{}})
	}
	if 1 > len(retRefDefs) {
		retRefDefs = []apicontract.RefDefs{}
	}

	return apicontract.Success(apicontract.RefDefsData{RefDefs: retRefDefs})
})

var getBlockDefIDsByRefText = contractHandler(apicontract.GetBlockDefIDsByRefText, func(c *gin.Context, request apicontract.RefTextQueryRequest) apicontract.Response[apicontract.RefDefsData] {
	anchor := request.Anchor
	boxID := request.Notebook
	ids := model.GetBlockDefIDsByRefTextInBox(anchor, boxID)
	ids = filterBlockIDsByPublishAccess(c, ids, "")
	var retRefDefs []apicontract.RefDefs
	for _, id := range ids {
		retRefDefs = append(retRefDefs, apicontract.RefDefs{RefID: id, DefIDs: []string{}})
	}
	if 1 > len(retRefDefs) {
		retRefDefs = []apicontract.RefDefs{}
	}

	return apicontract.Success(apicontract.RefDefsData{RefDefs: retRefDefs})
})

var getBlockBreadcrumb = contractHandler(apicontract.GetBlockBreadcrumb, func(c *gin.Context, request apicontract.BlockBreadcrumbRequest) apicontract.Response[[]*apicontract.BlockPath] {
	ret := gulu.Ret.NewResult()
	id, excludeTypes := request.ID, request.ExcludeTypes
	boxID := request.Notebook
	if err := holdEncryptedBlockRequests(c, boxID, append([]string{request.ID}, request.IDs...), false); err != nil {
		return apicontract.Failure[[]*apicontract.BlockPath](-1, err.Error())
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		return apicontract.Success([]*apicontract.BlockPath{})
	}

	var blockPath []*model.BlockPath
	var err error
	if boxID != "" {
		blockPath, err = model.BuildBlockBreadcrumbInBox(id, excludeTypes, boxID)
	} else {
		blockPath, err = model.BuildBlockBreadcrumb(id, excludeTypes)
	}
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.BlockPath](ret)
	}

	return apicontract.Success(blockPathContracts(blockPath))
})

var getBlockBreadcrumbChildren = contractHandler(apicontract.GetBlockBreadcrumbChildren, func(c *gin.Context, request apicontract.BlockBreadcrumbChildrenRequest) apicontract.Response[*apicontract.BlockBreadcrumbChildren] {
	ret := gulu.Ret.NewResult()
	id, excludeTypes := request.ID, request.ExcludeTypes
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[*apicontract.BlockBreadcrumbChildren](ret)
	}
	offset, limit := 0, 64
	if request.Offset != nil {
		offset = int(*request.Offset)
	}
	if request.Limit != nil {
		limit = int(*request.Limit)
	}
	boxID := request.Notebook
	if err := holdEncryptedBlockRequests(c, boxID, append([]string{request.ID}, request.IDs...), false); err != nil {
		return apicontract.Failure[*apicontract.BlockBreadcrumbChildren](-1, err.Error())
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		return apicontract.Success(&apicontract.BlockBreadcrumbChildren{Items: []*apicontract.BlockPath{}})
	}

	children, err := model.GetBlockBreadcrumbChildrenInBox(id, excludeTypes, offset, limit, boxID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[*apicontract.BlockBreadcrumbChildren](ret)
	}
	if children == nil {
		return apicontract.Success[*apicontract.BlockBreadcrumbChildren](nil)
	}
	return apicontract.Success(&apicontract.BlockBreadcrumbChildren{Items: blockPathContracts(children.Items), HasMore: children.HasMore})
})

var getBlockIndex = contractHandler(apicontract.GetBlockIndex, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[int] {
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, true)
	if err != nil {
		return apicontract.Failure[int](-1, err.Error())
	}
	if !isBlockPublishAccessible(c, request.ID, boxID) {
		return apicontract.Success(0)
	}
	return apicontract.Success(model.GetBlockIndex(request.ID))
})

var getBlocksIndexes = contractHandler(apicontract.GetBlocksIndexes, func(c *gin.Context, request apicontract.BlocksQueryRequest) apicontract.Response[map[string]int] {
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[map[string]int](-1, err.Error())
	}
	ids := filterBlockIDsByPublishAccess(c, request.IDs, boxID)
	return apicontract.Success(model.GetBlocksIndexes(ids))
})

var getDocBlocksOrders = contractHandler(apicontract.GetDocBlocksOrders, func(c *gin.Context, request apicontract.DocOrdersRequest) apicontract.Response[[]string] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.ID, ret) || !checkBlockPublishAccess(c, request.ID, ret) {
		return contractFailure[[]string](ret)
	}
	orders, err := model.GetDocBlocksOrders(request.ID)
	if err != nil {
		return apicontract.Failure[[]string](-1, err.Error())
	}
	return apicontract.Success(orders)
})

var getBlockInfo = contractHandler(apicontract.GetBlockInfo, func(c *gin.Context, request apicontract.BlockInfoRequest) apicontract.Response[apicontract.BlockInfoData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.BlockInfoData](ret)
	}
	boxID := ""
	if request.Notebook != "" && model.IsEncryptedBox(request.Notebook) {
		boxID = request.Notebook
	}
	// 普通文档的索引可能尚未就绪，先恢复索引，再按实际归属取得响应租约。
	if boxID == "" && !model.IsReadOnlyRoleContext(c) && treenode.GetBlockTree(id) == nil {
		if err := model.ReindexMissingNormalBlock(id); setGetBlockInfoError(ret, id, err) {
			return contractFailure[apicontract.BlockInfoData](ret)
		}
	}
	ids := append([]string{id}, request.IDs...)
	if err := holdEncryptedBlockRequests(c, boxID, ids, false); err != nil {
		ret.Code, ret.Msg = -1, err.Error()
		return contractFailure[apicontract.BlockInfoData](ret)
	}
	blockTree, publishAccessRequired, publishMetadataVisible, publishAccessible := getBlockInfoPublishAccess(c, id, boxID)
	if !publishAccessible {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
		return contractFailure[apicontract.BlockInfoData](ret)
	}
	if publishAccessRequired && !publishMetadataVisible {
		return apicontract.Success[apicontract.BlockInfoData](apicontract.PublishedBlockInfo{
			BlockInfoCommon:       apicontract.BlockInfoCommon{RootID: blockTree.RootID, RootTitleEmpty: true},
			PublishAccessRequired: true,
		})
	}

	// 仅在此处使用带重建索引的加载函数，其他地方不要使用
	var tree *parse.Tree
	var err error
	if boxID != "" {
		tree, err = model.LoadTreeByBlockIDWithReindexInBox(id, boxID)
	} else {
		tree, err = model.LoadTreeByBlockIDWithReindex(id)
	}
	if setGetBlockInfoError(ret, id, err) {
		return contractFailure[apicontract.BlockInfoData](ret)
	}

	block, _ := model.GetBlock(id, tree)
	if nil == block {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
		return contractFailure[apicontract.BlockInfoData](ret)
	}

	root, err := model.GetBlock(block.RootID, tree)
	if errors.Is(err, model.ErrIndexing) {
		return apicontract.FailureWithText[apicontract.BlockInfoData](3, ret.Msg, model.Conf.Language(56))
	}
	rootTitle := root.IAL["title"]
	rootTitle = html.UnescapeString(rootTitle)
	icon := html.UnescapeString(root.IAL["icon"])
	if publishAccessRequired {
		return apicontract.Success[apicontract.BlockInfoData](apicontract.PublishedBlockInfo{
			BlockInfoCommon: apicontract.BlockInfoCommon{
				RootID: block.RootID, RootTitle: rootTitle, RootTitleEmpty: root.IAL[model.NodeAttrTitleEmpty] == "true", RootIcon: icon,
			},
			PublishAccessRequired: true,
		})
	}

	var rootChildID string
	b := block
	for range 128 {
		parentID := b.ParentID
		if "" == parentID {
			rootChildID = b.ID
			break
		}
		if b, _ = model.GetBlock(parentID, tree); nil == b {
			logging.LogErrorf("not found parent")
			break
		}
	}

	return apicontract.Success[apicontract.BlockInfoData](apicontract.FullBlockInfo{
		BlockInfoCommon: apicontract.BlockInfoCommon{
			RootID: block.RootID, RootTitle: rootTitle, RootTitleEmpty: root.IAL[model.NodeAttrTitleEmpty] == "true", RootIcon: icon,
		},
		Box: block.Box, Path: block.Path, RootChildID: rootChildID,
	})
})

func setGetBlockInfoError(ret *gulu.Result, id string, err error) bool {
	if err == nil {
		return false
	}
	ret.Code = -1
	switch {
	case errors.Is(err, model.ErrIndexing):
		ret.Code = 3
		ret.Msg = model.Conf.Language(56)
	case errors.Is(err, treenode.ErrSpecTooNew):
		ret.Msg = model.Conf.Language(275)
	case errors.Is(err, model.ErrBoxUnindexed):
		ret.Msg = "" // 加载时已经推送提示。
	case errors.Is(err, model.ErrTreeNotFound):
		ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
	default:
		ret.Msg = err.Error()
	}
	return true
}

func getBlockInfoPublishAccess(c *gin.Context, id, boxID string) (blockTree *treenode.BlockTree, passwordRequired, metadataVisible, accessible bool) {
	if !model.IsReadOnlyRoleContext(c) {
		return nil, false, true, true
	}

	blockTree = treenode.GetBlockTreeInBox(id, boxID)
	publishAccess := model.GetPublishAccess()
	switch model.GetBlockTreePublishAccessStatus(c, publishAccess, blockTree) {
	case model.PublishAccessAllowed:
		return blockTree, false, true, true
	case model.PublishAccessPasswordRequired:
		metadataVisible = model.CheckBlockTreeDiscoverableByPublishAccess(publishAccess, blockTree)
		if metadataVisible || blockTree.ID == blockTree.RootID {
			return blockTree, true, metadataVisible, true
		}
	}
	return blockTree, false, false, false
}

func checkBlockPublishAccess(c *gin.Context, id string, ret *gulu.Result) bool {
	return checkBlockPublishAccessInBox(c, id, "", ret)
}

func checkBlockPublishAccessInBox(c *gin.Context, id, boxID string, ret *gulu.Result) bool {
	if isBlockPublishAccessible(c, id, boxID) {
		return true
	}

	ret.Code = -1
	ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
	return false
}

func isBlockPublishAccessible(c *gin.Context, id, boxID string) bool {
	if !model.IsReadOnlyRoleContext(c) {
		return true
	}

	return model.CheckBlockIdAccessableByPublishAccessInBox(c, model.GetPublishAccess(), id, boxID)
}

func filterBlockIDsByPublishAccess(c *gin.Context, ids []string, boxID string) []string {
	if !model.IsReadOnlyRoleContext(c) {
		return ids
	}

	publishAccess := model.GetPublishAccess()
	ret := make([]string, 0, len(ids))
	for _, id := range ids {
		if model.CheckBlockIdAccessableByPublishAccessInBox(c, publishAccess, id, boxID) {
			ret = append(ret, id)
		}
	}
	return ret
}

var getBlockDOM = contractHandler(apicontract.GetBlockDOM, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[apicontract.BlockDOMData] {
	id := request.ID
	requestedNotebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		return apicontract.Success(apicontract.BlockDOMData{ID: id})
	}
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[apicontract.BlockDOMData](-1, err.Error())
	}
	dom := model.GetBlockDOMInBox(id, boxID)

	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		publishIgnore := model.GetDisablePublishAccess(publishAccess)
		bt := treenode.GetBlockTreeInBox(id, boxID)
		if nil == bt {
			dom = ""
		} else {
			passwordID, password := model.GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if (password != "" && !model.CheckPublishAuthCookie(c, passwordID, password)) || !model.CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
				dom = ""
			}
		}
	}

	return apicontract.Success(apicontract.BlockDOMData{ID: id, DOM: dom})
})

var getOrderedListContinueStart = contractHandler(apicontract.GetOrderedListContinueStart, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[apicontract.OrderedListStartData] {
	ret := gulu.Ret.NewResult()
	id := strings.TrimSpace(request.ID)
	if id == "" {
		return apicontract.Failure[apicontract.OrderedListStartData](-1, "Field [id] must not be empty")
	}
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.OrderedListStartData](ret)
	}
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[apicontract.OrderedListStartData](-1, err.Error())
	}
	start, found := model.GetOrderedListContinueStartInBox(id, boxID)
	return apicontract.Success(apicontract.OrderedListStartData{Start: start, Found: found})
})

var getBlockDOMs = contractHandler(apicontract.GetBlockDOMs, func(c *gin.Context, request apicontract.BlocksQueryRequest) apicontract.Response[map[string]string] {
	ids := request.IDs

	requestedNotebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		return apicontract.Success(map[string]string{})
	}
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[map[string]string](-1, err.Error())
	}
	doms := model.GetBlockDOMsInBox(ids, boxID)

	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		publishIgnore := model.GetDisablePublishAccess(publishAccess)
		filterBlockDOMsByPublishAccess(c, doms, ids, boxID, publishAccess, publishIgnore)
	}

	return apicontract.Success(doms)
})

var getBlockDOMWithEmbed = contractHandler(apicontract.GetBlockDOMWithEmbed, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[apicontract.BlockDOMData] {
	id := request.ID
	requestedNotebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		return apicontract.Success(apicontract.BlockDOMData{ID: id})
	}
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[apicontract.BlockDOMData](-1, err.Error())
	}
	isReadOnlyRole := model.IsReadOnlyRoleContext(c)
	var publishAccess model.PublishAccess
	var accessChecker model.EmbedBlockAccessChecker
	if isReadOnlyRole {
		publishAccess = model.GetPublishAccess()
		accessChecker = func(blockID string) bool {
			return model.CheckBlockIdAccessableByPublishAccessInBox(c, publishAccess, blockID, boxID)
		}
	}
	dom := model.GetBlockDOMWithEmbedInBoxWithAccessChecker(id, boxID, accessChecker)

	if isReadOnlyRole {
		publishIgnore := model.GetDisablePublishAccess(publishAccess)
		bt := treenode.GetBlockTreeInBox(id, boxID)
		if nil == bt {
			dom = ""
		} else {
			passwordID, password := model.GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if (password != "" && !model.CheckPublishAuthCookie(c, passwordID, password)) || !model.CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
				dom = ""
			}
		}
	}

	return apicontract.Success(apicontract.BlockDOMData{ID: id, DOM: dom})
})

var getBlockDOMsWithEmbed = contractHandler(apicontract.GetBlockDOMsWithEmbed, func(c *gin.Context, request apicontract.BlocksQueryRequest) apicontract.Response[map[string]string] {
	ids := request.IDs

	requestedNotebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		return apicontract.Success(map[string]string{})
	}
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[map[string]string](-1, err.Error())
	}
	isReadOnlyRole := model.IsReadOnlyRoleContext(c)
	var publishAccess model.PublishAccess
	var accessChecker model.EmbedBlockAccessChecker
	if isReadOnlyRole {
		publishAccess = model.GetPublishAccess()
		accessChecker = func(blockID string) bool {
			return model.CheckBlockIdAccessableByPublishAccessInBox(c, publishAccess, blockID, boxID)
		}
	}
	doms := model.GetBlockDOMsWithEmbedInBoxWithAccessChecker(ids, boxID, accessChecker)

	if isReadOnlyRole {
		publishIgnore := model.GetDisablePublishAccess(publishAccess)
		filterBlockDOMsByPublishAccess(c, doms, ids, boxID, publishAccess, publishIgnore)
	}

	return apicontract.Success(doms)
})

func encryptedNotebookFromArg(arg map[string]any) string {
	notebook, _ := arg["notebook"].(string)
	if notebook != "" && model.IsEncryptedBox(notebook) {
		return notebook
	}
	return ""
}

func holdBlockRequest(c *gin.Context, ret *gulu.Result, boxID string, arg map[string]any, allowMissingIDs ...bool) bool {
	var ids []string
	if id, ok := arg["id"].(string); ok {
		ids = append(ids, id)
	}
	if values, ok := arg["ids"].([]any); ok {
		for _, value := range values {
			if id, ok := value.(string); ok {
				ids = append(ids, id)
			}
		}
	}
	// 存在性与状态检查需要接受已删除的块 ID；输出块内容的接口必须在准入时确定全部归属。
	allowMissing := len(allowMissingIDs) > 0 && allowMissingIDs[0]
	if err := holdEncryptedBlockRequests(c, boxID, ids, allowMissing); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return false
	}
	return true
}

func isEncryptedNotebookDeniedForPublish(c *gin.Context, notebook string) bool {
	return notebook != "" && model.IsReadOnlyRoleContext(c) && model.IsEncryptedBoxDeniedByPublishAccess(notebook)
}

func filterBlockDOMsByPublishAccess(c *gin.Context, doms map[string]string, ids []string, boxID string, publishAccess model.PublishAccess, publishIgnore model.PublishAccess) {
	for _, id := range ids {
		if _, ok := doms[id]; !ok {
			continue
		}
		bt := treenode.GetBlockTreeInBox(id, boxID)
		if nil == bt {
			doms[id] = ""
			continue
		}
		passwordID, password := model.GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
		if (password != "" && !model.CheckPublishAuthCookie(c, passwordID, password)) || !model.CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
			doms[id] = ""
		}
	}
}

var getBlockKramdown = contractHandler(apicontract.GetBlockKramdown, func(c *gin.Context, request apicontract.BlockKramdownRequest) apicontract.Response[apicontract.BlockKramdownData] {
	ret := gulu.Ret.NewResult()
	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.BlockKramdownData](ret)
	}

	// md：Markdown 标记符模式，使用标记符导出
	// textmark：文本标记模式，使用 span 标签导出
	// https://github.com/siyuan-note/siyuan/issues/13183
	mode := "md"
	if request.Mode != nil {
		mode = *request.Mode
		if "md" != mode && "textmark" != mode {
			ret.Code = -1
			ret.Msg = "Invalid mode"
			return contractFailure[apicontract.BlockKramdownData](ret)
		}
	}

	requestedNotebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		return apicontract.Success(apicontract.BlockKramdownData{ID: id})
	}
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[apicontract.BlockKramdownData](-1, err.Error())
	}
	var kramdown string
	if boxID != "" {
		kramdown = model.GetBlockKramdownInBox(id, mode, boxID)
	} else {
		kramdown = model.GetBlockKramdown(id, mode)
	}

	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		publishIgnore := model.GetDisablePublishAccess(publishAccess)
		bt := treenode.GetBlockTreeInBox(id, boxID)
		if nil == bt {
			kramdown = ""
		} else {
			passwordID, password := model.GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if (password != "" && !model.CheckPublishAuthCookie(c, passwordID, password)) || !model.CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
				kramdown = ""
			}
		}
	}

	return apicontract.Success(apicontract.BlockKramdownData{ID: id, Kramdown: kramdown})
})

var getBlockKramdowns = contractHandler(apicontract.GetBlockKramdowns, func(c *gin.Context, request apicontract.BlocksKramdownRequest) apicontract.Response[map[string]string] {
	ret := gulu.Ret.NewResult()
	var ids []string
	for _, id := range request.IDs {
		if !util.InvalidIDPattern(id, nil) {
			ids = append(ids, id)
		}
	}

	// md：Markdown 标记符模式，使用标记符导出
	// textmark：文本标记模式，使用 span 标签导出
	// https://github.com/siyuan-note/siyuan/issues/13183
	mode := "md"
	if request.Mode != nil {
		mode = *request.Mode
		if "md" != mode && "textmark" != mode {
			ret.Code = -1
			ret.Msg = "Invalid mode"
			return contractFailure[map[string]string](ret)
		}
	}

	requestedNotebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		return apicontract.Success(map[string]string{})
	}
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[map[string]string](-1, err.Error())
	}
	var kramdowns map[string]string
	if boxID != "" {
		kramdowns = model.GetBlockKramdownsInBox(ids, mode, boxID)
	} else {
		kramdowns = model.GetBlockKramdowns(ids, mode)
	}

	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		publishIgnore := model.GetDisablePublishAccess(publishAccess)
		filterBlockKramdownsByPublishAccess(c, kramdowns, ids, boxID, publishAccess, publishIgnore)
	}

	return apicontract.Success(kramdowns)
})

func filterBlockKramdownsByPublishAccess(c *gin.Context, kramdowns map[string]string, ids []string, boxID string, publishAccess model.PublishAccess, publishIgnore model.PublishAccess) {
	for _, id := range ids {
		if _, ok := kramdowns[id]; !ok {
			continue
		}
		bt := treenode.GetBlockTreeInBox(id, boxID)
		if nil == bt {
			kramdowns[id] = ""
			continue
		}
		passwordID, password := model.GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
		if (password != "" && !model.CheckPublishAuthCookie(c, passwordID, password)) || !model.CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
			kramdowns[id] = ""
		}
	}
}

var getChildBlocks = contractHandler(apicontract.GetChildBlocks, func(c *gin.Context, request apicontract.BlockQueryRequest) apicontract.Response[[]*apicontract.ChildBlock] {
	ret := gulu.Ret.NewResult()
	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[[]*apicontract.ChildBlock](ret)
	}

	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[[]*apicontract.ChildBlock](-1, err.Error())
	}
	return apicontract.Success(childBlockContracts(model.GetChildBlocksInBox(id, boxID)))
})

var getTailChildBlocks = contractHandler(apicontract.GetTailChildBlocks, func(c *gin.Context, request apicontract.TailChildBlocksRequest) apicontract.Response[[]*apicontract.ChildBlock] {
	ret := gulu.Ret.NewResult()
	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[[]*apicontract.ChildBlock](ret)
	}

	var n int
	if request.N != nil {
		n = int(*request.N)
	}
	if 1 > n {
		n = 7
	}

	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, request.IDs, false)
	if err != nil {
		return apicontract.Failure[[]*apicontract.ChildBlock](-1, err.Error())
	}
	return apicontract.Success(childBlockContracts(model.GetTailChildBlocksInBox(id, n, boxID)))
})

func blockStatContract(stat *util.BlockStatResult) *apicontract.BlockStat {
	if stat == nil {
		return nil
	}
	return &apicontract.BlockStat{RuneCount: stat.RuneCount, WordCount: stat.WordCount, LinkCount: stat.LinkCount,
		ImageCount: stat.ImageCount, RefCount: stat.RefCount, BlockCount: stat.BlockCount}
}

func childBlockContracts(blocks []*model.ChildBlock) []*apicontract.ChildBlock {
	if blocks == nil {
		return nil
	}
	result := make([]*apicontract.ChildBlock, len(blocks))
	for i, block := range blocks {
		if block != nil {
			result[i] = &apicontract.ChildBlock{ID: block.ID, Type: block.Type, SubType: block.SubType, Content: block.Content, Markdown: block.Markdown}
		}
	}
	return result
}

func refDefContracts(values []*model.RefDefs) []*apicontract.RefDefs {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.RefDefs, len(values))
	for i, value := range values {
		if value != nil {
			result[i] = &apicontract.RefDefs{RefID: value.RefID, DefIDs: value.DefIDs}
		}
	}
	return result
}

func blockTreeInfoContracts(values map[string]*model.BlockTreeInfo) map[string]*apicontract.BlockTreeInfo {
	if values == nil {
		return nil
	}
	result := make(map[string]*apicontract.BlockTreeInfo, len(values))
	for id, value := range values {
		if value == nil {
			result[id] = nil
		} else {
			converted := apicontract.BlockTreeInfo(*value)
			result[id] = &converted
		}
	}
	return result
}

func blockPathContracts(values []*model.BlockPath) []*apicontract.BlockPath {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.BlockPath, len(values))
	for i, value := range values {
		if value != nil {
			result[i] = &apicontract.BlockPath{ID: value.ID, Name: value.Name, Type: value.Type, SubType: value.SubType, Children: blockPathContracts(value.Children), HasChildren: value.HasChildren}
		}
	}
	return result
}

func docInfoContract(info *model.BlockInfo) *apicontract.DocInfo {
	if info == nil {
		return nil
	}
	var views []*apicontract.DocAttrView
	if info.AttrViews != nil {
		views = make([]*apicontract.DocAttrView, len(info.AttrViews))
		for i, value := range info.AttrViews {
			if value != nil {
				converted := apicontract.DocAttrView(*value)
				views[i] = &converted
			}
		}
	}
	return &apicontract.DocInfo{ID: info.ID, RootID: info.RootID, Name: info.Name, RefCount: info.RefCount, SubFileCount: info.SubFileCount, RefIDs: info.RefIDs, IAL: info.IAL, Icon: info.Icon, AttrViews: views}
}

func docInfoContracts(values []*model.BlockInfo) []*apicontract.DocInfo {
	if values == nil {
		return nil
	}
	ret := make([]*apicontract.DocInfo, len(values))
	for i, value := range values {
		ret[i] = docInfoContract(value)
	}
	return ret
}

func treeStatContract(reqID apicontract.JSONValue, stat *model.DocumentStat, includeEmbed bool) apicontract.TreeStatData {
	containsEmbed := false
	ret := apicontract.TreeStatData{ReqID: reqID, ContainsEmbed: &containsEmbed}
	if stat != nil {
		ret.Stat = blockStatContract(stat.Stat)
		containsEmbed = stat.ContainsEmbed
		if includeEmbed {
			withEmbed := blockStatContract(stat.StatWithEmbed)
			ret.StatWithEmbed = &withEmbed
			var embed *apicontract.EmbedStat
			if stat.EmbedStat != nil {
				converted := apicontract.EmbedStat(*stat.EmbedStat)
				embed = &converted
			}
			ret.EmbedStat = &embed
		}
	}
	return ret
}
