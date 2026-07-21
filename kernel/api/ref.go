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

	id := arg["id"].(string)
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
	if !isBacklinkDocAccessible(c, refTreeID) {
		ret.Data = map[string]any{
			"backmentions": []*model.Backlink{},
			"keywords":     []string{},
		}
		return
	}
	keyword := arg["keyword"].(string)
	var notebook string
	if val, ok := arg["notebook"]; ok {
		notebook = val.(string)
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
	if notebook != "" && model.IsEncryptedBox(notebook) {
		backlinks, keywords = model.GetBackmentionDocInBox(defID, refTreeID, keyword, containChildren, highlight, notebook)
	} else {
		backlinks, keywords = model.GetBackmentionDoc(defID, refTreeID, keyword, containChildren, highlight)
	}
	ret.Data = map[string]any{
		"backmentions": backlinks,
		"keywords":     keywords,
	}
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
	if !isBacklinkDocAccessible(c, refTreeID) {
		ret.Data = map[string]any{
			"backlinks": []*model.Backlink{},
			"keywords":  []string{},
		}
		return
	}
	keyword := arg["keyword"].(string)
	var notebook string
	if val, ok := arg["notebook"]; ok {
		notebook = val.(string)
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
	if notebook != "" && model.IsEncryptedBox(notebook) {
		backlinks, keywords = model.GetBacklinkDocInBox(defID, refTreeID, keyword, containChildren, highlight, notebook)
	} else {
		backlinks, keywords = model.GetBacklinkDoc(defID, refTreeID, keyword, containChildren, highlight)
	}
	ret.Data = map[string]any{
		"backlinks": backlinks,
		"keywords":  keywords,
	}
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
	var boxID string
	var backlinks, backmentions []*model.Path
	var linkRefsCount, mentionsCount int
	// 加密笔记本的反链面板走 InBox 版（查加密 content db）
	if notebook, ok := arg["notebook"].(string); ok && notebook != "" && model.IsEncryptedBox(notebook) {
		boxID, backlinks, backmentions, linkRefsCount, mentionsCount = model.GetBacklink2InBox(id, keyword, mentionKeyword, sort, mentionSort, containChildren, notebook)
	} else {
		boxID, backlinks, backmentions, linkRefsCount, mentionsCount = model.GetBacklink2(id, keyword, mentionKeyword, sort, mentionSort, containChildren)
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		backlinks = model.FilterPathsByPublishAccess(c, publishAccess, backlinks)
		backmentions = model.FilterPathsByPublishAccess(c, publishAccess, backmentions)
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
	if notebook, ok := arg["notebook"].(string); ok && notebook != "" && model.IsEncryptedBox(notebook) {
		boxID, backlinks, backmentions, linkRefsCount, mentionsCount = model.GetBacklinkInBox(id, keyword, mentionKeyword, beforeLen, containChildren, notebook)
	} else {
		boxID, backlinks, backmentions, linkRefsCount, mentionsCount = model.GetBacklink(id, keyword, mentionKeyword, beforeLen, containChildren)
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		backlinks = model.FilterPathsByPublishAccess(c, publishAccess, backlinks)
		backmentions = model.FilterPathsByPublishAccess(c, publishAccess, backmentions)
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
