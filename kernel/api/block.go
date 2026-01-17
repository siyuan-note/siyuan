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
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/html"
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

	idsArg := arg["ids"].([]interface{})
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}
	ids = gulu.Str.RemoveDuplicatedElem(ids)

	ret.Data = model.CheckBlockRef(ids)
}

func getBlockTreeInfos(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var ids []string
	idsArg := arg["ids"].([]interface{})
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}

	ret.Data = model.GetBlockTreeInfos(ids)
}

func getBlockSiblingID(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	parent, previous, next := model.GetBlockSiblingID(id)
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
	parentID, previousID, nextID, err := model.GetBlockRelevantIDs(id)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
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
		for _, refID := range arg["refIDs"].([]interface{}) {
			refIDs = append(refIDs, refID.(string))
		}
	}

	err := model.TransferBlockRef(fromID, toID, refIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
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
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
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
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
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
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
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

	id := arg["id"].(string)
	level := int(arg["level"].(float64))

	transaction, err := model.GetHeadingLevelTransaction(id, level)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
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
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
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
	parentID := model.GetUnfoldedParentID(id)
	ret.Data = map[string]interface{}{
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
	isFolded, isRoot := model.IsBlockFolded(id)
	ret.Data = map[string]interface{}{
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
	b, err := model.GetBlock(id, nil)
	if errors.Is(err, model.ErrIndexing) {
		ret.Code = 0
		ret.Data = false
		return
	}
	ret.Data = nil != b
}

func getDocInfo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	info := model.GetDocInfo(id)
	if nil == info {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
		return
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
	idsArg := arg["ids"].([]interface{})
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}
	queryRefCount := arg["refCount"].(bool)
	queryAv := arg["av"].(bool)
	info := model.GetDocsInfo(ids, queryRefCount, queryAv)
	if nil == info {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(15), ids)
		return
	}
	ret.Data = info
}

func getRecentUpdatedBlocks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	blocks := model.RecentUpdatedBlocks()
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

	idsArg := arg["ids"].([]interface{})
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}
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

	id := arg["id"].(string)
	ret.Data = map[string]any{
		"reqId": arg["reqId"],
		"stat":  filesys.StatTree(id),
	}
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

	refText := model.GetBlockRefText(id)
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
	refDefs, originalRefBlockIDs := model.GetBlockRefs(id)
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
	refIDs := model.GetBlockRefIDsByFileAnnotationID(id)
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
	excludeIDsArg := arg["excludeIDs"].([]interface{})
	var excludeIDs []string
	for _, excludeID := range excludeIDsArg {
		excludeIDs = append(excludeIDs, excludeID.(string))
	}
	excludeIDs = nil // 不限制虚拟引用搜索自己 https://ld246.com/article/1633243424177
	ids := model.GetBlockDefIDsByRefText(anchor, excludeIDs)
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
		for _, excludeType := range excludeTypesArg.([]interface{}) {
			excludeTypes = append(excludeTypes, excludeType.(string))
		}
	}

	blockPath, err := model.BuildBlockBreadcrumb(id, excludeTypes)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = blockPath
}

func getBlockIndex(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
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

	idsArg := arg["ids"].([]interface{})
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}
	index := model.GetBlocksIndexes(ids)
	ret.Data = index
}

func getBlockInfo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)

	// 仅在此处使用带重建索引的加载函数，其他地方不要使用
	tree, err := model.LoadTreeByBlockIDWithReindex(id)
	if errors.Is(err, model.ErrIndexing) {
		ret.Code = 3
		ret.Msg = model.Conf.Language(56)
		return
	} else if errors.Is(err, treenode.ErrSpecTooNew) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(275)
		return
	} else if errors.Is(err, model.ErrBoxUnindexed) {
		ret.Code = -1
		ret.Msg = "" // 加载的时候已经推送过提示了，这里不需要再提示
		return
	}

	block, _ := model.GetBlock(id, tree)
	if nil == block {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
		return
	}

	var rootChildID string
	b := block
	for i := 0; i < 128; i++ {
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

	root, err := model.GetBlock(block.RootID, tree)
	if errors.Is(err, model.ErrIndexing) {
		ret.Code = 3
		ret.Data = model.Conf.Language(56)
		return
	}
	rootTitle := root.IAL["title"]
	rootTitle = html.UnescapeString(rootTitle)
	icon := root.IAL["icon"]
	ret.Data = map[string]string{
		"box":         block.Box,
		"path":        block.Path,
		"rootID":      block.RootID,
		"rootTitle":   rootTitle,
		"rootChildID": rootChildID,
		"rootIcon":    icon,
	}
}

func getBlockDOM(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	dom := model.GetBlockDOM(id)
	ret.Data = map[string]string{
		"id":  id,
		"dom": dom,
	}
}

func getBlockDOMs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["ids"].([]interface{})
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}

	doms := model.GetBlockDOMs(ids)
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
	dom := model.GetBlockDOMWithEmbed(id)
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

	idsArg := arg["ids"].([]interface{})
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}

	doms := model.GetBlockDOMsWithEmbed(ids)
	ret.Data = doms
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

	kramdown := model.GetBlockKramdown(id, mode)
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

	idsArg := arg["ids"].([]interface{})
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

	kramdowns := model.GetBlockKramdowns(ids, mode)
	ret.Data = kramdowns
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

	ret.Data = model.GetChildBlocks(id)
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

	ret.Data = model.GetTailChildBlocks(id, n)
}
