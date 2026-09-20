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
	"encoding/json"
	"strconv"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var refreshBacklink = contractHandler(apicontract.RefreshBacklink, func(c *gin.Context, request apicontract.RefreshBacklinkRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	if util.InvalidIDPattern(request.ID, ret) {
		return contractFailure[apicontract.Null](ret)
	}
	model.RefreshBacklink(request.ID)
	model.FlushTxQueue()
	return apicontract.Success(apicontract.Null{})
})

func isBacklinkDocAccessible(c *gin.Context, refTreeID string) bool {
	if !model.IsReadOnlyRoleContext(c) {
		return true
	}

	return model.CheckBlockIdAccessableByPublishAccess(c, model.GetPublishAccess(), refTreeID)
}

var getBackmentionDoc = contractHandler(apicontract.GetBackmentionDoc, func(c *gin.Context, request apicontract.BackmentionDocumentRequest) apicontract.Response[apicontract.BacklinkContextData] {
	defID, refTreeID := request.DefID, request.RefTreeID
	knownRevision, keyword, notebook := request.KnownRevision, request.Keyword, request.Notebook
	encryptedNotebookDenied := isEncryptedNotebookDeniedForPublish(c, notebook)
	if notebook != "" && !model.IsEncryptedBox(notebook) {
		notebook = ""
	}
	if !encryptedNotebookDenied {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			return apicontract.Failure[apicontract.BacklinkContextData](1, err.Error())
		}
	}
	containChildren := model.Conf.Editor.BacklinkContainChildren
	if request.ContainChildren != nil {
		containChildren = *request.ContainChildren
	}
	highlight := true
	if request.Highlight != nil {
		highlight = *request.Highlight
	}

	var backlinks []*model.Backlink
	var keywords []string
	if encryptedNotebookDenied || !isBacklinkDocAccessible(c, refTreeID) {
		backlinks, keywords = []*model.Backlink{}, []string{}
	} else if notebook != "" && model.IsEncryptedBox(notebook) {
		backlinks, keywords = model.GetBackmentionDocInBox(defID, refTreeID, keyword, containChildren, highlight, notebook)
	} else {
		backlinks, keywords = model.GetBackmentionDoc(defID, refTreeID, keyword, containChildren, highlight)
	}
	keywords = canonicalBacklinkKeywords(keywords)
	items := newBacklinkContextResponses(backlinks)
	revision := hashBacklinkRevision("bc1:", struct {
		DefID           string
		RefTreeID       string
		Keyword         string
		Notebook        string
		ContainChildren bool
		Highlight       bool
		Items           []*backlinkContextResponse
		Keywords        []string
	}{defID, refTreeID, keyword, notebook, containChildren, highlight, items, keywords})
	if knownRevision == revision {
		return apicontract.Success(apicontract.BacklinkContextData{Unchanged: true, Revision: revision})
	}
	return apicontract.Success(apicontract.BacklinkContextData{Revision: revision, Backmentions: backlinkContextContracts(items), Keywords: keywords})
})

func backlinkContextContracts(items []*backlinkContextResponse) []*apicontract.BacklinkContext {
	if items == nil {
		return nil
	}
	ret := make([]*apicontract.BacklinkContext, len(items))
	for i, item := range items {
		if item == nil {
			continue
		}
		value := &apicontract.BacklinkContext{Type: item.Type, ReferenceBlockID: item.ReferenceBlockID, ID: item.ID,
			DOM: item.DOM, BlockPaths: blockPathContracts(item.BlockPaths), Expand: item.Expand, Revision: item.Revision}
		if item.AttributeViewTargets != nil {
			value.AttributeViewTargets = make([]*apicontract.BacklinkAttributeViewTarget, len(item.AttributeViewTargets))
			for j, target := range item.AttributeViewTargets {
				if target == nil {
					continue
				}
				converted := &apicontract.BacklinkAttributeViewTarget{BlockID: target.BlockID}
				if target.Matches != nil {
					converted.Matches = make([]*apicontract.BacklinkAttributeViewMatch, len(target.Matches))
					for k, match := range target.Matches {
						converted.Matches[k] = (*apicontract.BacklinkAttributeViewMatch)(match)
					}
				}
				value.AttributeViewTargets[j] = converted
			}
		}
		ret[i] = value
	}
	return ret
}

var getBacklinkDoc = contractHandler(apicontract.GetBacklinkDoc, func(c *gin.Context, request apicontract.BacklinkDocumentRequest) apicontract.Response[apicontract.BacklinkContextData] {
	defID, refTreeID := request.DefID, request.RefTreeID
	knownRevision, keyword, notebook := request.KnownRevision, request.Keyword, request.Notebook
	encryptedNotebookDenied := isEncryptedNotebookDeniedForPublish(c, notebook)
	if notebook != "" && !model.IsEncryptedBox(notebook) {
		notebook = ""
	}
	if !encryptedNotebookDenied {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			return apicontract.Failure[apicontract.BacklinkContextData](1, err.Error())
		}
	}
	containChildren := model.Conf.Editor.BacklinkContainChildren
	if request.ContainChildren != nil {
		containChildren = *request.ContainChildren
	}
	highlight := true
	if request.Highlight != nil {
		highlight = *request.Highlight
	}

	var backlinks []*model.Backlink
	var keywords []string
	if encryptedNotebookDenied || !isBacklinkDocAccessible(c, refTreeID) {
		backlinks, keywords = []*model.Backlink{}, []string{}
	} else if notebook != "" && model.IsEncryptedBox(notebook) {
		backlinks, keywords = model.GetBacklinkDocInBoxWithSort(defID, refTreeID, keyword, containChildren, highlight, notebook, request.BlockSort, backlinkSourceFilterModel(request.SourceFilter))
	} else {
		backlinks, keywords = model.GetBacklinkDocWithSort(defID, refTreeID, keyword, containChildren, highlight, request.BlockSort, backlinkSourceFilterModel(request.SourceFilter))
	}
	keywords = canonicalBacklinkKeywords(keywords)
	items := newBacklinkContextResponses(backlinks)
	revision := hashBacklinkRevision("bc1:", struct {
		DefID           string
		RefTreeID       string
		Keyword         string
		Notebook        string
		ContainChildren bool
		Highlight       bool
		BlockSort       int
		Items           []*backlinkContextResponse
		Keywords        []string
	}{defID, refTreeID, keyword, notebook, containChildren, highlight, request.BlockSort, items, keywords})
	if knownRevision == revision {
		return apicontract.Success(apicontract.BacklinkContextData{Unchanged: true, Revision: revision})
	}
	return apicontract.Success(apicontract.BacklinkContextData{Revision: revision, Backlinks: backlinkContextContracts(items), Keywords: keywords})
})

func backlinkSourceFilterModel(filter *apicontract.BacklinkSourceFilter) *model.BacklinkSourceFilter {
	if filter == nil {
		return nil
	}
	return model.NormalizeBacklinkSourceFilter(&model.BacklinkSourceFilter{DailyNote: filter.DailyNote, ExcludeSelf: filter.ExcludeSelf,
		ExcludedRefDefIDs: filter.ExcludedRefDefIDs, ExcludedNotebookIDs: filter.ExcludedNotebookIDs})
}

var getBacklink2 = contractHandler(apicontract.GetBacklink2, func(c *gin.Context, request apicontract.BacklinkListRequest) apicontract.Response[apicontract.BacklinkListData] {
	if request.ID == nil {
		return apicontract.Success(apicontract.BacklinkListData{})
	}
	id, knownRevision := *request.ID, request.KnownRevision
	keyword, mentionKeyword := request.K, request.MK
	includeMentions := true
	if request.IncludeMentions != nil {
		includeMentions = *request.IncludeMentions
	}
	includeBacklinks := request.IncludeBacklinks == nil || *request.IncludeBacklinks
	sort := util.SortModeUpdatedDESC
	if request.Sort != nil {
		sort, _ = strconv.Atoi(*request.Sort)
	}
	mentionSort := util.SortModeUpdatedDESC
	if request.MentionSort != nil {
		mentionSort, _ = strconv.Atoi(*request.MentionSort)
	}
	containChildren := model.Conf.Editor.BacklinkContainChildren
	if request.ContainChildren != nil {
		containChildren = *request.ContainChildren
	}
	sourceFilter := backlinkSourceFilterModel(request.SourceFilter)
	if request.RefDefCandidates {
		empty := apicontract.BacklinkDefinitionsResult([]*apicontract.BacklinkRefDef{})
		notebook := request.Notebook
		if model.IsReadOnlyRoleContext(c) || isEncryptedNotebookDeniedForPublish(c, notebook) {
			return apicontract.Success(empty)
		}
		if err := holdEncryptedBoxRequest(c, notebook); nil != err {
			return apicontract.GetBacklink2.FailureWithData(1, err.Error(), empty)
		}
		if !model.IsEncryptedBox(notebook) {
			notebook = ""
		}
		defs, err := model.GetBacklinkRefDefs(id, keyword, containChildren, notebook, sourceFilter)
		if nil != err {
			return apicontract.GetBacklink2.FailureWithData(1, err.Error(), empty)
		}
		var converted []*apicontract.BacklinkRefDef
		if defs != nil {
			converted = make([]*apicontract.BacklinkRefDef, len(defs))
			for i, def := range defs {
				converted[i] = (*apicontract.BacklinkRefDef)(def)
			}
		}
		return apicontract.Success(apicontract.BacklinkDefinitionsResult(converted))
	}
	var boxID string
	var backlinks, backmentions []*model.Path
	var linkRefsCount, mentionsCount int
	// 加密笔记本的反链面板走 InBox 版（查加密 content db）
	notebook := request.Notebook
	if !isEncryptedNotebookDeniedForPublish(c, notebook) {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			return apicontract.Failure[apicontract.BacklinkListData](1, err.Error())
		}
		if notebook != "" && model.IsEncryptedBox(notebook) {
			boxID, backlinks, backmentions, linkRefsCount, mentionsCount = model.GetBacklink2InBoxWithOptions(id, keyword, mentionKeyword, sort, mentionSort, containChildren, notebook, sourceFilter, includeMentions, includeBacklinks)
		} else {
			boxID, backlinks, backmentions, linkRefsCount, mentionsCount = model.GetBacklink2InBoxWithOptions(id, keyword, mentionKeyword, sort, mentionSort, containChildren, "", sourceFilter, includeMentions, includeBacklinks)
		}
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		backlinks = model.FilterPathsByPublishAccess(c, publishAccess, backlinks)
		backmentions = model.FilterPathsByPublishAccess(c, publishAccess, backmentions)
		linkRefsCount = countBacklinkPaths(backlinks)
		mentionsCount = countBacklinkPaths(backmentions)
	}
	backlinkResponses := newBacklinkPathResponses(backlinks)
	backmentionResponses := newBacklinkPathResponses(backmentions)
	response := &backlinkListResponse{
		Backlinks:     backlinkResponses,
		LinkRefsCount: linkRefsCount,
		Backmentions:  backmentionResponses,
		MentionsCount: mentionsCount,
		K:             keyword,
		MK:            mentionKeyword,
		Box:           boxID,
	}
	response.Revision = hashBacklinkRevision("bl1:", struct {
		ID              string
		Keyword         string
		MentionKeyword  string
		Sort            int
		MentionSort     int
		ContainChildren bool
		Notebook        string
		SourceFilter    *model.BacklinkSourceFilter
		Backlinks       []string
		LinkRefsCount   int
		Backmentions    []string
		MentionsCount   int
		Box             string
	}{
		id,
		keyword,
		mentionKeyword,
		sort,
		mentionSort,
		containChildren,
		notebook,
		sourceFilter,
		backlinkPathRevisions(backlinkResponses),
		linkRefsCount,
		backlinkPathRevisions(backmentionResponses),
		mentionsCount,
		boxID,
	})
	if knownRevision == response.Revision {
		return apicontract.Success(apicontract.BacklinkListResult(apicontract.BacklinkList{Unchanged: true, Revision: response.Revision}))
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		return apicontract.Failure[apicontract.BacklinkListData](-1, err.Error())
	}
	var result apicontract.BacklinkList
	if err = json.Unmarshal(encoded, &result); err != nil {
		return apicontract.Failure[apicontract.BacklinkListData](-1, err.Error())
	}
	return apicontract.Success(apicontract.BacklinkListResult(result))
})

func parseBacklinkSourceFilter(arg map[string]any) *model.BacklinkSourceFilter {
	filterArg, ok := arg["sourceFilter"].(map[string]any)
	if !ok {
		return nil
	}

	filter := &model.BacklinkSourceFilter{}
	filter.DailyNote, _ = filterArg["dailyNote"].(string)
	filter.ExcludeSelf, _ = filterArg["excludeSelf"].(bool)
	if ids, ok := filterArg["excludedRefDefIDs"].([]any); ok {
		for _, value := range ids {
			if id, ok := value.(string); ok {
				filter.ExcludedRefDefIDs = append(filter.ExcludedRefDefIDs, id)
			}
		}
	}
	if notebookIDs, ok := filterArg["excludedNotebookIDs"].([]any); ok {
		for _, notebookID := range notebookIDs {
			if id, ok := notebookID.(string); ok {
				filter.ExcludedNotebookIDs = append(filter.ExcludedNotebookIDs, id)
			}
		}
	}
	return model.NormalizeBacklinkSourceFilter(filter)
}
