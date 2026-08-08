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
	"path/filepath"
	"sort"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func searchHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var notebook, query, op string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("notebook", &notebook, false, false),
		util.BindJsonArg("query", &query, false, false),
		util.BindJsonArg("op", &op, false, false),
	) {
		return
	}
	typ := model.HistoryTypeDoc
	if nil != arg["type"] {
		typeVal, ok := util.ParseJsonArg[float64]("type", arg, ret, true, false)
		if !ok {
			return
		}
		typ = int(typeVal)
	}
	page := 1
	if nil != arg["page"] {
		pageVal, ok := util.ParseJsonArg[float64]("page", arg, ret, true, false)
		if !ok {
			return
		}
		page = int(pageVal)
	}
	histories, pageCount, totalCount := model.FullTextSearchHistory(query, notebook, op, typ, page)
	ret.Data = map[string]any{
		"histories":  histories,
		"pageCount":  pageCount,
		"totalCount": totalCount,
	}
}

func getHistoryItems(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var created, notebook, query, op string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("created", &created, true, true),
		util.BindJsonArg("notebook", &notebook, false, false),
		util.BindJsonArg("query", &query, false, false),
		util.BindJsonArg("op", &op, false, false),
	) {
		return
	}
	typ := model.HistoryTypeDoc
	if nil != arg["type"] {
		typeVal, ok := util.ParseJsonArg[float64]("type", arg, ret, true, false)
		if !ok {
			return
		}
		typ = int(typeVal)
	}
	histories := model.FullTextSearchHistoryItems(created, query, notebook, op, typ)
	ret.Data = map[string]any{
		"items": histories,
	}
}

func reindexHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.ReindexHistory()
}

func getNotebookHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	histories, err := model.GetNotebookHistory()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"histories": histories,
	}
}

func clearWorkspaceHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	msgId := util.PushMsg(model.Conf.Language(100), 1000*60*15)
	time.Sleep(3 * time.Second)
	err := model.ClearWorkspaceHistory()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	util.PushUpdateMsg(msgId, model.Conf.Language(99), 1000*5)
}

func getDocHistoryContent(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var historyPath, keyword string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("historyPath", &historyPath, true, true),
		util.BindJsonArg("k", &keyword, false, false),
	) {
		return
	}
	highlight := true
	if nil != arg["highlight"] {
		highlightVal, ok := util.ParseJsonArg[bool]("highlight", arg, ret, true, false)
		if !ok {
			return
		}
		highlight = highlightVal
	}
	if !holdHistoryRequest(c, historyPath, ret) {
		return
	}
	id, rootID, content, isLargeDoc, err := model.GetDocHistoryContent(historyPath, keyword, highlight)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"id":         id,
		"rootID":     rootID,
		"content":    content,
		"isLargeDoc": isLargeDoc,
	}
}

func diffDocVersions(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	leftArg, ok := arg["left"].(map[string]interface{})
	if !ok {
		ret.Code = -1
		ret.Msg = "left document version is required"
		return
	}
	rightArg, ok := arg["right"].(map[string]interface{})
	if !ok {
		ret.Code = -1
		ret.Msg = "right document version is required"
		return
	}
	left, ok := parseDocVersionRef(leftArg, ret)
	if !ok {
		return
	}
	right, ok := parseDocVersionRef(rightArg, ret)
	if !ok {
		return
	}
	boxIDs := map[string]struct{}{}
	for _, ref := range []*model.DocVersionRef{left, right} {
		boxID, resolveErr := model.ResolveDocVersionBoxID(ref)
		if resolveErr != nil {
			ret.Code = -1
			ret.Msg = resolveErr.Error()
			return
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
			ret.Code = -1
			ret.Msg = model.Conf.Language(314)
			return
		}
	}

	diff, err := model.DiffDocVersions(left, right)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = diff
}

func parseDocVersionRef(arg map[string]interface{}, ret *gulu.Result) (ref *model.DocVersionRef, ok bool) {
	var typ, id, path, snapshot string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("type", &typ, true, true),
		util.BindJsonArg("id", &id, false, false),
		util.BindJsonArg("path", &path, false, false),
		util.BindJsonArg("snapshot", &snapshot, false, false),
	) {
		return nil, false
	}
	return &model.DocVersionRef{Type: typ, ID: id, Path: path, Snapshot: snapshot}, true
}

func rollbackDocHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var historyPath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("historyPath", &historyPath, true, true),
	) {
		return
	}
	if !holdHistoryRequest(c, historyPath, ret) {
		return
	}
	err := model.RollbackDocHistory(historyPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func rollbackAssetsHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var historyPath string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("historyPath", &historyPath, true, true)) {
		return
	}
	if !holdHistoryRequest(c, historyPath, ret) {
		return
	}
	err := model.RollbackAssetsHistory(historyPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func rollbackNotebookHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var historyPath string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("historyPath", &historyPath, true, true)) {
		return
	}
	err := model.RollbackNotebookHistory(historyPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func rollbackAttributeViewHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var historyPath string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("historyPath", &historyPath, true, true)) {
		return
	}
	if !holdHistoryRequest(c, historyPath, ret) {
		return
	}
	err := model.RollbackAttributeViewHistory(historyPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

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

func createDocHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var id string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("id", &id, true, true),
	) {
		return
	}

	err := model.CreateDocHistory(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func createAssetHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var assetPath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("path", &assetPath, true, true),
	) {
		return
	}

	err := model.CreateAssetHistory(assetPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
