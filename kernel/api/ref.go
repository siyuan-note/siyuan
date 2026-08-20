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
	"net/http"
	"strconv"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func refreshBacklink(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) || util.InvalidIDPattern(id, ret) {
		return
	}
	model.RefreshBacklink(id)
	model.FlushTxQueue()
}

func isBacklinkDocAccessible(c *gin.Context, refTreeID string) bool {
	if !model.IsReadOnlyRoleContext(c) {
		return true
	}

	return model.CheckBlockIdAccessableByPublishAccess(c, model.GetPublishAccess(), refTreeID)
}

func getBackmentionDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	defID := arg["defID"].(string)
	refTreeID := arg["refTreeID"].(string)
	knownRevision, _ := arg["knownRevision"].(string)
	keyword := arg["keyword"].(string)
	var notebook string
	if val, ok := arg["notebook"]; ok {
		notebook = val.(string)
	}
	encryptedNotebookDenied := isEncryptedNotebookDeniedForPublish(c, notebook)
	if notebook != "" && !model.IsEncryptedBox(notebook) {
		notebook = ""
	}
	if !encryptedNotebookDenied {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			ret.Code = 1
			ret.Msg = err.Error()
			return
		}
	}
	containChildren := model.Conf.Editor.BacklinkContainChildren
	if val, ok := arg["containChildren"]; ok {
		containChildren = val.(bool)
	}
	highlight := true
	if val, ok := arg["highlight"]; ok {
		highlight = val.(bool)
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
		ret.Data = &backlinkContextResult{Unchanged: true, Revision: revision}
		return
	}
	ret.Data = &backlinkContextResult{Revision: revision, Backmentions: items, Keywords: keywords}
}

func getBacklinkDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	defID := arg["defID"].(string)
	refTreeID := arg["refTreeID"].(string)
	knownRevision, _ := arg["knownRevision"].(string)
	keyword := arg["keyword"].(string)
	var notebook string
	if val, ok := arg["notebook"]; ok {
		notebook = val.(string)
	}
	encryptedNotebookDenied := isEncryptedNotebookDeniedForPublish(c, notebook)
	if notebook != "" && !model.IsEncryptedBox(notebook) {
		notebook = ""
	}
	if !encryptedNotebookDenied {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			ret.Code = 1
			ret.Msg = err.Error()
			return
		}
	}
	containChildren := model.Conf.Editor.BacklinkContainChildren
	if val, ok := arg["containChildren"]; ok {
		containChildren = val.(bool)
	}
	highlight := true
	if val, ok := arg["highlight"]; ok {
		highlight = val.(bool)
	}

	var backlinks []*model.Backlink
	var keywords []string
	if encryptedNotebookDenied || !isBacklinkDocAccessible(c, refTreeID) {
		backlinks, keywords = []*model.Backlink{}, []string{}
	} else if notebook != "" && model.IsEncryptedBox(notebook) {
		backlinks, keywords = model.GetBacklinkDocInBox(defID, refTreeID, keyword, containChildren, highlight, notebook)
	} else {
		backlinks, keywords = model.GetBacklinkDoc(defID, refTreeID, keyword, containChildren, highlight)
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
		ret.Data = &backlinkContextResult{Unchanged: true, Revision: revision}
		return
	}
	ret.Data = &backlinkContextResult{Revision: revision, Backlinks: items, Keywords: keywords}
}

func getBacklink2(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	if nil == arg["id"] {
		return
	}

	id := arg["id"].(string)
	knownRevision, _ := arg["knownRevision"].(string)
	keyword := arg["k"].(string)
	mentionKeyword := arg["mk"].(string)
	sortArg := arg["sort"]
	sort := util.SortModeUpdatedDESC
	if nil != sortArg {
		sort, _ = strconv.Atoi(sortArg.(string))
	}
	mentionSortArg := arg["mSort"]
	mentionSort := util.SortModeUpdatedDESC
	if nil != mentionSortArg {
		mentionSort, _ = strconv.Atoi(mentionSortArg.(string))
	}
	containChildren := model.Conf.Editor.BacklinkContainChildren
	if val, ok := arg["containChildren"]; ok {
		containChildren = val.(bool)
	}
	sourceFilter := parseBacklinkSourceFilter(arg)
	var boxID string
	var backlinks, backmentions []*model.Path
	var linkRefsCount, mentionsCount int
	// 加密笔记本的反链面板走 InBox 版（查加密 content db）
	notebook, _ := arg["notebook"].(string)
	if !isEncryptedNotebookDeniedForPublish(c, notebook) {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			ret.Code = 1
			ret.Msg = err.Error()
			return
		}
		if notebook != "" && model.IsEncryptedBox(notebook) {
			boxID, backlinks, backmentions, linkRefsCount, mentionsCount = model.GetBacklink2InBoxWithFilter(id, keyword, mentionKeyword, sort, mentionSort, containChildren, notebook, sourceFilter)
		} else {
			boxID, backlinks, backmentions, linkRefsCount, mentionsCount = model.GetBacklink2WithFilter(id, keyword, mentionKeyword, sort, mentionSort, containChildren, sourceFilter)
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
		ret.Data = &backlinkListResponse{Unchanged: true, Revision: response.Revision}
		return
	}
	ret.Data = response
}

func parseBacklinkSourceFilter(arg map[string]any) *model.BacklinkSourceFilter {
	filterArg, ok := arg["sourceFilter"].(map[string]any)
	if !ok {
		return nil
	}

	filter := &model.BacklinkSourceFilter{}
	filter.DailyNote, _ = filterArg["dailyNote"].(string)
	filter.ExcludeSelf, _ = filterArg["excludeSelf"].(bool)
	if notebookIDs, ok := filterArg["excludedNotebookIDs"].([]any); ok {
		for _, notebookID := range notebookIDs {
			if id, ok := notebookID.(string); ok {
				filter.ExcludedNotebookIDs = append(filter.ExcludedNotebookIDs, id)
			}
		}
	}
	return model.NormalizeBacklinkSourceFilter(filter)
}

func getBacklink(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	if nil == arg["id"] {
		return
	}

	id := arg["id"].(string)
	keyword := arg["k"].(string)
	mentionKeyword := arg["mk"].(string)
	beforeLen := 12
	if nil != arg["beforeLen"] {
		beforeLen = int(arg["beforeLen"].(float64))
	}
	containChildren := model.Conf.Editor.BacklinkContainChildren
	if val, ok := arg["containChildren"]; ok {
		containChildren = val.(bool)
	}
	var boxID string
	var backlinks, backmentions []*model.Path
	var linkRefsCount, mentionsCount int
	// 加密笔记本的反链面板走 InBox 版（查加密 content db）
	notebook, _ := arg["notebook"].(string)
	if !isEncryptedNotebookDeniedForPublish(c, notebook) {
		if err := holdEncryptedBoxRequest(c, notebook); err != nil {
			ret.Code = 1
			ret.Msg = err.Error()
			return
		}
		if notebook != "" && model.IsEncryptedBox(notebook) {
			boxID, backlinks, backmentions, linkRefsCount, mentionsCount = model.GetBacklinkInBox(id, keyword, mentionKeyword, beforeLen, containChildren, notebook)
		} else {
			boxID, backlinks, backmentions, linkRefsCount, mentionsCount = model.GetBacklink(id, keyword, mentionKeyword, beforeLen, containChildren)
		}
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		backlinks = model.FilterPathsByPublishAccess(c, publishAccess, backlinks)
		backmentions = model.FilterPathsByPublishAccess(c, publishAccess, backmentions)
		linkRefsCount = countBacklinkPaths(backlinks)
		mentionsCount = countBacklinkPaths(backmentions)
	}
	ret.Data = map[string]any{
		"backlinks":     backlinks,
		"linkRefsCount": linkRefsCount,
		"backmentions":  backmentions,
		"mentionsCount": mentionsCount,
		"k":             keyword,
		"mk":            mentionKeyword,
		"box":           boxID,
	}
	util.RandomSleep(200, 500)
}
