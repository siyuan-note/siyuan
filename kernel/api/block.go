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
	"net/http"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func checkBlockRef(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	scope := ""
	if scopeArg, exists := arg["scope"]; exists {
		var valid bool
		scope, valid = scopeArg.(string)
		if !valid {
			ret.Code = -1
			ret.Msg = "Field [scope] should be of type [String]"
			return
		}
	}
	if "" == strings.TrimSpace(scope) {
		scope = "blocks"
	}
	switch scope {
	case "blocks":
		ids, parsed := parseBlockRefStringArray(arg, "ids", ret, true)
		if !parsed {
			return
		}
		var exactIDs []string
		if _, exists := arg["exactIDs"]; exists {
			exactIDs, parsed = parseBlockRefStringArray(arg, "exactIDs", ret, false)
			if !parsed {
				return
			}
		}
		var deletedIDs []string
		if _, exists := arg["deletedIDs"]; exists {
			deletedIDs, parsed = parseBlockRefStringArray(arg, "deletedIDs", ret, false)
			if !parsed {
				return
			}
		}
		for _, id := range ids {
			if util.InvalidIDPattern(id, ret) {
				return
			}
		}
		idSet := map[string]struct{}{}
		for _, id := range ids {
			idSet[id] = struct{}{}
		}
		for _, id := range exactIDs {
			if util.InvalidIDPattern(id, ret) {
				return
			}
			if _, exists := idSet[id]; !exists {
				ret.Code = -1
				ret.Msg = "Field [exactIDs] should be a subset of field [ids]"
				return
			}
		}
		for _, id := range deletedIDs {
			if util.InvalidIDPattern(id, ret) {
				return
			}
			if _, exists := idSet[id]; !exists {
				ret.Code = -1
				ret.Msg = "Field [deletedIDs] should be a subset of field [ids]"
				return
			}
		}
		notebook, valid := util.ParseJsonArg[string]("notebook", arg, ret, false, false)
		if !valid {
			return
		}
		if "" != notebook && util.InvalidIDPattern(notebook, ret) {
			return
		}
		if "" != notebook && !holdBlockRequest(c, ret, notebook) {
			return
		}
		ids = filterBlockIDsByPublishAccess(c, ids, notebook)
		exactIDs = filterBlockIDsByPublishAccess(c, exactIDs, notebook)
		deletedIDs = filterBlockIDsByPublishAccess(c, deletedIDs, notebook)
		var err error
		ret.Data, err = model.CheckBlockRefInBox(ids, exactIDs, deletedIDs, notebook)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
		}
	case "documents":
		paths, parsed := parseBlockRefStringArray(arg, "paths", ret, true)
		if !parsed {
			return
		}
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
			ret.Data = false
			return
		}
		var err error
		ret.Data, err = model.CheckDocsRef(paths)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
		}
	case "notebook":
		var notebook string
		if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("notebook", &notebook, true, true)) {
			return
		}
		if util.InvalidIDPattern(notebook, ret) {
			return
		}
		if !holdBlockRequest(c, ret, notebook) {
			return
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
				ret.Data = false
				return
			}
		}
		var err error
		ret.Data, err = model.CheckNotebookRef(notebook)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
		}
	default:
		ret.Code = -1
		ret.Msg = "invalid block ref check scope"
	}
}

func parseBlockRefStringArray(arg map[string]any, key string, ret *gulu.Result, rejectEmpty bool) (values []string, ok bool) {
	var raw []any
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg(key, &raw, true, rejectEmpty)) {
		return
	}
	for _, value := range raw {
		str, isString := value.(string)
		if !isString || "" == strings.TrimSpace(str) {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [%s] should contain non-empty strings", key)
			return nil, false
		}
		values = append(values, str)
	}
	values = gulu.Str.RemoveDuplicatedElem(values)
	return values, true
}

func getBlockTreeInfos(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var ids []string
	idsArg := arg["ids"].([]any)
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}

	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	ids = filterBlockIDsByPublishAccess(c, ids, boxID)
	ret.Data = model.GetBlockTreeInfosInBox(ids, boxID)
}

func getBlockSiblingID(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		ret.Data = map[string]string{
			"parent":   "",
			"next":     "",
			"previous": "",
		}
		return
	}

	parent, previous, next := model.GetBlockSiblingIDInBox(id, boxID)
	ret.Data = map[string]string{
		"parent":   parent,
		"next":     next,
		"previous": previous,
	}
}

func getBlockRelevantIDs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		ret.Data = map[string]string{
			"parentID":   "",
			"previousID": "",
			"nextID":     "",
		}
		return
	}

	parentID, previousID, nextID, err := model.GetBlockRelevantIDsInBox(id, boxID)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}

	ret.Data = map[string]string{
		"parentID":   parentID,
		"previousID": previousID,
		"nextID":     nextID,
	}
}

func transferBlockRef(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	fromID := arg["fromID"].(string)
	if util.InvalidIDPattern(fromID, ret) {
		return
	}
	toID := arg["toID"].(string)
	if util.InvalidIDPattern(toID, ret) {
		return
	}

	reloadUI := true
	if nil != arg["reloadUI"] {
		reloadUI = arg["reloadUI"].(bool)
	}

	var refIDs []string
	if nil != arg["refIDs"] {
		for _, refID := range arg["refIDs"].([]any) {
			refIDs = append(refIDs, refID.(string))
		}
	}

	err := model.TransferBlockRef(fromID, toID, refIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}

	if reloadUI {
		util.ReloadUI()
	}
}

func swapBlockRef(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	refID := arg["refID"].(string)
	defID := arg["defID"].(string)
	includeChildren := arg["includeChildren"].(bool)
	err := model.SwapBlockRef(refID, defID, includeChildren)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}
}

func getHeadingChildrenIDs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if !checkBlockPublishAccess(c, id, ret) {
		return
	}

	ids := model.GetHeadingChildrenIDs(id)
	ret.Data = ids
}

func appendHeadingChildren(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	childrenDOM := arg["childrenDOM"].(string)
	model.AppendHeadingChildren(id, childrenDOM)
}

func getHeadingChildrenDOM(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if !checkBlockPublishAccess(c, id, ret) {
		return
	}

	removeFoldAttr := true
	if nil != arg["removeFoldAttr"] {
		removeFoldAttr = arg["removeFoldAttr"].(bool)
	}
	dom := model.GetHeadingChildrenDOM(id, removeFoldAttr)
	ret.Data = dom
}

func getHeadingDeleteTransaction(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)

	transaction, err := model.GetHeadingDeleteTransaction(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}

	ret.Data = transaction
}

func getHeadingInsertTransaction(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)

	transaction, err := model.GetHeadingInsertTransaction(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}

	ret.Data = transaction
}

func getHeadingLevelTransaction(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	level := int(arg["level"].(float64))

	var ids []string
	if idsArg, ok := arg["ids"].([]any); ok {
		for _, id := range idsArg {
			ids = append(ids, id.(string))
		}
		ids = gulu.Str.RemoveDuplicatedElem(ids)
	} else {
		ids = []string{arg["id"].(string)}
	}

	transaction, err := model.GetHeadingLevelBatchTransaction(ids, level)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}

	ret.Data = transaction
}

func getHeadingFoldTransaction(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	scope := arg["scope"].(string)
	transaction, err := model.GetHeadingFoldTransaction(id, scope)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}

	ret.Data = transaction
}

func setBlockReminder(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	timed := arg["timed"].(string) // yyyyMMddHHmmss
	err := model.SetBlockReminder(id, timed)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}
}

func setCloudReminder(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	timed := arg["timed"].(string) // yyyyMMddHHmmss
	content := arg["content"].(string)
	err := model.SetCloudReminder(id, content, timed)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}
}

func getUnfoldedParentID(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		ret.Data = map[string]any{
			"parentID": "",
		}
		return
	}
	parentID := model.GetUnfoldedParentID(id)
	ret.Data = map[string]any{
		"parentID": parentID,
	}
}

func checkBlockFold(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		ret.Data = map[string]any{
			"isFolded": false,
			"isRoot":   false,
		}
		return
	}
	isFolded, isRoot := model.IsBlockFolded(id)
	ret.Data = map[string]any{
		"isFolded": isFolded,
		"isRoot":   isRoot,
	}
}

func checkBlockExist(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		ret.Data = false
		return
	}
	ret.Data = treenode.ExistBlockTree(id)
}

func checkBlocksExist(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["ids"].([]any)
	var ids []string
	for _, idArg := range idsArg {
		if id, idOk := idArg.(string); idOk && ast.IsNodeIDPattern(id) {
			ids = append(ids, id)
		}
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	ids = filterBlockIDsByPublishAccess(c, ids, boxID)
	ret.Data = treenode.ExistBlockTreesInBox(ids, boxID)
}

func getDocInfo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !checkBlockPublishAccessInBox(c, id, boxID, ret) {
		return
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
		return
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		info = model.FilterBlockInfoByPublishAccess(c, publishAccess, info)
	}
	ret.Data = info
}

func getDocsInfo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	idsArg := arg["ids"].([]any)
	isReadOnlyRole := model.IsReadOnlyRoleContext(c)
	var publishAccess model.PublishAccess
	if isReadOnlyRole {
		publishAccess = model.GetPublishAccess()
	}
	var ids []string
	for _, id := range idsArg {
		idStr := id.(string)
		if isReadOnlyRole && !model.CheckBlockIdAccessableByPublishAccess(c, publishAccess, idStr) {
			continue
		}
		ids = append(ids, idStr)
	}
	if isReadOnlyRole && 0 < len(idsArg) && len(ids) == 0 {
		ret.Data = []*model.BlockInfo{}
		return
	}
	queryRefCount := arg["refCount"].(bool)
	queryAv := arg["av"].(bool)
	info := model.GetDocsInfo(ids, queryRefCount, queryAv)
	if nil == info {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(15), ids)
		return
	}
	if isReadOnlyRole {
		for i, docinfo := range info {
			info[i] = model.FilterBlockInfoByPublishAccess(c, publishAccess, docinfo)
		}
	}
	ret.Data = info
}

func getRecentUpdatedBlocks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	blocks := model.RecentUpdatedBlocks()
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		blocks = model.FilterBlocksByPublishAccess(c, publishAccess, blocks)
	}
	ret.Data = blocks
}

func getContentWordCount(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	content := arg["content"].(string)
	ret.Data = map[string]any{
		"reqId": arg["reqId"],
		"stat":  filesys.ContentStat(content),
	}
}

func getBlocksWordCount(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["ids"].([]any)
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	ids = filterBlockIDsByPublishAccess(c, ids, boxID)
	ret.Data = map[string]any{
		"reqId": arg["reqId"],
		"stat":  filesys.BlocksWordCount(ids),
	}
}

func getTreeStat(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var id string
	var includeEmbed bool
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("id", &id, true, true),
		util.BindJsonArg("includeEmbed", &includeEmbed, false, false),
	) || util.InvalidIDPattern(id, ret) {
		return
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		ret.Data = map[string]any{
			"reqId": arg["reqId"],
			"stat":  nil,
		}
		return
	}

	var accessChecker model.EmbedBlockAccessChecker
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		accessChecker = func(blockID string) bool {
			return model.CheckBlockIdAccessableByPublishAccessInBox(c, publishAccess, blockID, boxID)
		}
	}
	stat := model.GetDocumentStat(c.Request.Context(), id, boxID, includeEmbed, accessChecker)
	data := map[string]any{
		"reqId":         arg["reqId"],
		"stat":          nil,
		"containsEmbed": false,
	}
	if nil != stat {
		data["stat"] = stat.Stat
		data["containsEmbed"] = stat.ContainsEmbed
		if includeEmbed {
			data["statWithEmbed"] = stat.StatWithEmbed
			data["embedStat"] = stat.EmbedStat
		}
	}
	ret.Data = data
}

func getDOMText(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	dom := arg["dom"].(string)
	ret.Data = model.GetDOMText(dom)
}

func getRefText(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		ret.Data = model.ErrBlockNotFound.Error()
		return
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
		ret.Data = refText
		return
	}

	if strings.Count(refText, "\\") == len(refText) {
		// 全部都是 \ 的话使用实体 https://github.com/siyuan-note/siyuan/issues/11473
		refText = strings.ReplaceAll(refText, "\\", "&#92;")
		ret.Data = refText
		return
	}

	ret.Data = refText
}

func getRefIDs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	if nil == arg["id"] {
		arg["id"] = ""
	}

	id := arg["id"].(string)
	requestedNotebook, _ := arg["notebook"].(string)
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		ret.Data = map[string]any{
			"refDefs":             []model.RefDefs{},
			"originalRefBlockIDs": map[string]string{},
		}
		return
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	refDefs, originalRefBlockIDs := model.GetBlockRefsInBox(id, boxID)
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		refDefs, originalRefBlockIDs = model.FilterRefDefsByPublishAccess(c, publishAccess, refDefs)
	}
	ret.Data = map[string]any{
		"refDefs":             refDefs,
		"originalRefBlockIDs": originalRefBlockIDs,
	}
}

func getRefIDsByFileAnnotationID(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	boxID, _ := arg["notebook"].(string)
	refIDs := model.GetBlockRefIDsByFileAnnotationIDInBox(id, boxID)
	if model.IsReadOnlyRoleContext(c) {
		refIDs = model.FilterRefIDsByPublishAccess(c, model.GetPublishAccess(), refIDs)
	}
	var retRefDefs []model.RefDefs
	for _, blockID := range refIDs {
		retRefDefs = append(retRefDefs, model.RefDefs{RefID: blockID, DefIDs: []string{}})
	}
	if 1 > len(retRefDefs) {
		retRefDefs = []model.RefDefs{}
	}

	ret.Data = map[string]any{
		"refDefs": retRefDefs,
	}
}

func getBlockDefIDsByRefText(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	anchor := arg["anchor"].(string)
	boxID, _ := arg["notebook"].(string)
	ids := model.GetBlockDefIDsByRefTextInBox(anchor, boxID)
	ids = filterBlockIDsByPublishAccess(c, ids, "")
	var retRefDefs []model.RefDefs
	for _, id := range ids {
		retRefDefs = append(retRefDefs, model.RefDefs{RefID: id, DefIDs: []string{}})
	}
	if 1 > len(retRefDefs) {
		retRefDefs = []model.RefDefs{}
	}

	ret.Data = map[string]any{
		"refDefs": retRefDefs,
	}
}

func getBlockBreadcrumb(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	excludeTypesArg := arg["excludeTypes"]
	var excludeTypes []string
	if nil != excludeTypesArg {
		for _, excludeType := range excludeTypesArg.([]any) {
			excludeTypes = append(excludeTypes, excludeType.(string))
		}
	}

	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		ret.Data = []*model.BlockPath{}
		return
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
		return
	}

	ret.Data = blockPath
}

func getBlockBreadcrumbChildren(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	var excludeTypes []string
	if excludeTypesArg := arg["excludeTypes"]; nil != excludeTypesArg {
		for _, excludeType := range excludeTypesArg.([]any) {
			excludeTypes = append(excludeTypes, excludeType.(string))
		}
	}

	offset := 0
	if offsetArg := arg["offset"]; nil != offsetArg {
		offset = int(offsetArg.(float64))
	}
	limit := 64
	if limitArg := arg["limit"]; nil != limitArg {
		limit = int(limitArg.(float64))
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		ret.Data = &model.BlockBreadcrumbChildren{Items: []*model.BlockPath{}}
		return
	}

	children, err := model.GetBlockBreadcrumbChildrenInBox(id, excludeTypes, offset, limit, boxID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = children
}

func getBlockIndex(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	if !isBlockPublishAccessible(c, id, boxID) {
		ret.Data = 0
		return
	}
	index := model.GetBlockIndex(id)
	ret.Data = index
}

func getBlocksIndexes(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["ids"].([]any)
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	ids = filterBlockIDsByPublishAccess(c, ids, boxID)
	index := model.GetBlocksIndexes(ids)
	ret.Data = index
}

func getDocBlocksOrders(c *gin.Context) {
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
	if !checkBlockPublishAccess(c, id, ret) {
		return
	}

	orders, err := model.GetDocBlocksOrders(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = orders
}

func getBlockInfo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	if util.InvalidIDPattern(id, ret) {
		return
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	blockTree, publishAccessRequired, publishMetadataVisible, publishAccessible := getBlockInfoPublishAccess(c, id, boxID)
	if !publishAccessible {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
		return
	}
	if publishAccessRequired && !publishMetadataVisible {
		ret.Data = map[string]any{
			"rootID":                blockTree.RootID,
			"rootTitle":             "",
			"rootTitleEmpty":        true,
			"rootIcon":              "",
			"publishAccessRequired": true,
		}
		return
	}

	// 仅在此处使用带重建索引的加载函数，其他地方不要使用
	var tree *parse.Tree
	var err error
	if boxID != "" {
		tree, err = model.LoadTreeByBlockIDWithReindexInBox(id, boxID)
	} else {
		tree, err = model.LoadTreeByBlockIDWithReindex(id)
	}
	if err != nil {
		if errors.Is(err, model.ErrIndexing) {
			ret.Code = 3
			ret.Msg = model.Conf.Language(56)
			return
		}
		if errors.Is(err, treenode.ErrSpecTooNew) {
			ret.Code = -1
			ret.Msg = model.Conf.Language(275)
			return
		}
		if errors.Is(err, model.ErrBoxUnindexed) {
			ret.Code = -1
			ret.Msg = "" // 加载的时候已经推送过提示了，这里不需要再提示
			return
		}
		if errors.Is(err, model.ErrTreeNotFound) {
			ret.Code = -1
			ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
			return
		}
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	block, _ := model.GetBlock(id, tree)
	if nil == block {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
		return
	}

	root, err := model.GetBlock(block.RootID, tree)
	if errors.Is(err, model.ErrIndexing) {
		ret.Code = 3
		ret.Data = model.Conf.Language(56)
		return
	}
	rootTitle := root.IAL["title"]
	rootTitle = html.UnescapeString(rootTitle)
	icon := html.UnescapeString(root.IAL["icon"])
	if publishAccessRequired {
		ret.Data = map[string]any{
			"rootID":                block.RootID,
			"rootTitle":             rootTitle,
			"rootTitleEmpty":        root.IAL[model.NodeAttrTitleEmpty] == "true",
			"rootIcon":              icon,
			"publishAccessRequired": true,
		}
		return
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

	ret.Data = map[string]any{
		"box":            block.Box,
		"path":           block.Path,
		"rootID":         block.RootID,
		"rootTitle":      rootTitle,
		"rootTitleEmpty": root.IAL[model.NodeAttrTitleEmpty] == "true",
		"rootChildID":    rootChildID,
		"rootIcon":       icon,
	}
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

func getBlockDOM(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	requestedNotebook, _ := arg["notebook"].(string)
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		ret.Data = map[string]string{"id": id, "dom": ""}
		return
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
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

	ret.Data = map[string]string{
		"id":  id,
		"dom": dom,
	}
}

func getOrderedListContinueStart(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	if util.InvalidIDPattern(id, ret) {
		return
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	start, found := model.GetOrderedListContinueStartInBox(id, boxID)
	ret.Data = map[string]any{
		"start": start,
		"found": found,
	}
}

func getBlockDOMs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["ids"].([]any)
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}

	requestedNotebook, _ := arg["notebook"].(string)
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		ret.Data = map[string]string{}
		return
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	doms := model.GetBlockDOMsInBox(ids, boxID)

	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		publishIgnore := model.GetDisablePublishAccess(publishAccess)
		filterBlockDOMsByPublishAccess(c, doms, ids, boxID, publishAccess, publishIgnore)
	}

	ret.Data = doms
}

func getBlockDOMWithEmbed(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	requestedNotebook, _ := arg["notebook"].(string)
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		ret.Data = map[string]string{"id": id, "dom": ""}
		return
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
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

	ret.Data = map[string]string{
		"id":  id,
		"dom": dom,
	}
}

func getBlockDOMsWithEmbed(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["ids"].([]any)
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}

	requestedNotebook, _ := arg["notebook"].(string)
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		ret.Data = map[string]string{}
		return
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
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

	ret.Data = doms
}

func encryptedNotebookFromArg(arg map[string]any) string {
	notebook, _ := arg["notebook"].(string)
	if notebook != "" && model.IsEncryptedBox(notebook) {
		return notebook
	}
	return ""
}

func holdBlockRequest(c *gin.Context, ret *gulu.Result, boxID string) bool {
	if err := holdEncryptedBoxRequest(c, boxID); err != nil {
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

func getBlockKramdown(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	// md：Markdown 标记符模式，使用标记符导出
	// textmark：文本标记模式，使用 span 标签导出
	// https://github.com/siyuan-note/siyuan/issues/13183
	mode := "md"
	if modeArg := arg["mode"]; nil != modeArg {
		mode = modeArg.(string)
		if "md" != mode && "textmark" != mode {
			ret.Code = -1
			ret.Msg = "Invalid mode"
			return
		}
	}

	requestedNotebook, _ := arg["notebook"].(string)
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		ret.Data = map[string]string{"id": id, "kramdown": ""}
		return
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
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

	ret.Data = map[string]string{
		"id":       id,
		"kramdown": kramdown,
	}
}

func getBlockKramdowns(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["ids"].([]any)
	var ids []string
	for _, id := range idsArg {
		idStr := id.(string)
		// 验证 ID 格式，跳过无效的 ID
		if !util.InvalidIDPattern(idStr, nil) {
			ids = append(ids, idStr)
		}
	}

	// md：Markdown 标记符模式，使用标记符导出
	// textmark：文本标记模式，使用 span 标签导出
	// https://github.com/siyuan-note/siyuan/issues/13183
	mode := "md"
	if modeArg := arg["mode"]; nil != modeArg {
		mode = modeArg.(string)
		if "md" != mode && "textmark" != mode {
			ret.Code = -1
			ret.Msg = "Invalid mode"
			return
		}
	}

	requestedNotebook, _ := arg["notebook"].(string)
	if isEncryptedNotebookDeniedForPublish(c, requestedNotebook) {
		ret.Data = map[string]string{}
		return
	}
	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
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

	ret.Data = kramdowns
}

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

func getChildBlocks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	ret.Data = model.GetChildBlocksInBox(id, boxID)
}

func getTailChildBlocks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	var n int
	nArg := arg["n"]
	if nil != nArg {
		n = int(nArg.(float64))
	}
	if 1 > n {
		n = 7
	}

	boxID := encryptedNotebookFromArg(arg)
	if !holdBlockRequest(c, ret, boxID) {
		return
	}
	ret.Data = model.GetTailChildBlocksInBox(id, n, boxID)
}
