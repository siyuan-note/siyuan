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

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getAttributeViewItemIDsByBoundIDs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["avID"].(string)
	blockIDsArg := arg["blockIDs"].([]interface{})
	var blockIDs []string
	for _, v := range blockIDsArg {
		blockIDs = append(blockIDs, v.(string))
	}

	ret.Data = model.GetAttributeViewItemIDs(avID, blockIDs)
}

func getAttributeViewBoundBlockIDsByItemIDs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["avID"].(string)
	itemIDsArg := arg["itemIDs"].([]interface{})
	var itemIDs []string
	for _, v := range itemIDsArg {
		itemIDs = append(itemIDs, v.(string))
	}

	ret.Data = model.GetAttributeViewBoundBlockIDs(avID, itemIDs)
}

// getAttributeViewAddingBlockDefaultValues 用于获取添加块时的默认值。
// 存在过滤或分组条件时，添加块时需要填充默认值到过滤字段或分组字段中，前端需要调用该接口来获取这些默认值以便填充。
func getAttributeViewAddingBlockDefaultValues(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["avID"].(string)
	var viewID string
	if viewIDArg := arg["viewID"]; nil != viewIDArg {
		viewID = viewIDArg.(string)
	}
	var groupID string
	if groupIDArg := arg["groupID"]; nil != groupIDArg {
		groupID = groupIDArg.(string)
	}
	var previousID string
	if nil != arg["previousID"] {
		previousID = arg["previousID"].(string)
	}
	var addingBlockID string
	if nil != arg["addingBlockID"] {
		addingBlockID = arg["addingBlockID"].(string)
	}

	values := model.GetAttrViewAddingBlockDefaultValues(avID, viewID, groupID, previousID, addingBlockID)
	if 1 > len(values) {
		values = nil
	}
	ret.Data = map[string]interface{}{
		"values": values,
	}
}

func batchReplaceAttributeViewBlocks(c *gin.Context) {
	// Add kernel API `/api/av/batchReplaceAttributeViewBlocks` https://github.com/siyuan-note/siyuan/issues/15313
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["avID"].(string)
	isDetached := arg["isDetached"].(bool)
	oldNewArg := arg["oldNew"].([]interface{})
	var oldNew []map[string]string
	for _, v := range oldNewArg {
		for o, n := range v.(map[string]interface{}) {
			oldNew = append(oldNew, map[string]string{o: n.(string)})
		}
	}

	err := model.BatchReplaceAttributeViewBlocks(avID, isDetached, oldNew)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.ReloadAttrView(avID)
}

func setAttrViewGroup(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	arg, ok := util.JsonArg(c, ret)
	if !ok {
		c.JSON(http.StatusOK, ret)
		return
	}

	avID := arg["avID"].(string)
	blockID := arg["blockID"].(string)
	groupArg := arg["group"].(map[string]interface{})

	data, err := gulu.JSON.MarshalJSON(groupArg)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}
	group := &av.ViewGroup{}
	if err = gulu.JSON.UnmarshalJSON(data, group); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}

	err = model.SetAttributeViewGroup(avID, blockID, group)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()

		c.JSON(http.StatusOK, ret)
		return
	}

	ret = renderAttrView(blockID, avID, "", "", 1, -1, nil)
	c.JSON(http.StatusOK, ret)
}

func changeAttrViewLayout(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	arg, ok := util.JsonArg(c, ret)
	if !ok {
		c.JSON(http.StatusOK, ret)
		return
	}

	blockID := arg["blockID"].(string)
	avID := arg["avID"].(string)
	layoutType := arg["layoutType"].(string)
	err := model.ChangeAttrViewLayout(blockID, avID, av.LayoutType(layoutType))
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}

	ret = renderAttrView(blockID, avID, "", "", 1, -1, nil)
	c.JSON(http.StatusOK, ret)
}

func duplicateAttributeViewBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	avID := arg["avID"].(string)

	newAvID, newBlockID, err := model.DuplicateDatabaseBlock(avID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"avID":    newAvID,
		"blockID": newBlockID,
	}
}

func getAttributeViewKeysByAvID(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	avID := arg["avID"].(string)
	ret.Data = model.GetAttributeViewKeysByID(avID)
}

func getAttributeViewKeysByID(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	avID := arg["avID"].(string)
	keyIDsArg := arg["keyIDs"].([]interface{})
	var keyIDs []string
	for _, v := range keyIDsArg {
		keyIDs = append(keyIDs, v.(string))
	}
	ret.Data = model.GetAttributeViewKeysByID(avID, keyIDs...)
}

func getMirrorDatabaseBlocks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["avID"].(string)
	blockIDs := treenode.GetMirrorAttrViewBlockIDs(avID)
	var retRefDefs []model.RefDefs
	for _, blockID := range blockIDs {
		retRefDefs = append(retRefDefs, model.RefDefs{RefID: blockID, DefIDs: []string{}})
	}
	if 1 > len(retRefDefs) {
		retRefDefs = []model.RefDefs{}
	}

	ret.Data = map[string]any{
		"refDefs": retRefDefs,
	}
}

func setDatabaseBlockView(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	blockID := arg["id"].(string)
	viewID := arg["viewID"].(string)
	avID := arg["avID"].(string)

	err := model.SetDatabaseBlockView(blockID, avID, viewID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func getAttributeViewPrimaryKeyValues(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	page := 1
	pageArg := arg["page"]
	if nil != pageArg {
		page = int(pageArg.(float64))
	}

	pageSize := -1
	pageSizeArg := arg["pageSize"]
	if nil != pageSizeArg {
		pageSize = int(pageSizeArg.(float64))
	}

	keyword := ""
	if keywordArg := arg["keyword"]; nil != keywordArg {
		keyword = keywordArg.(string)
	}
	attributeViewName, databaseBlockIDs, rows, err := model.GetAttributeViewPrimaryKeyValues(id, keyword, page, pageSize)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"name":     attributeViewName,
		"blockIDs": databaseBlockIDs,
		"rows":     rows,
	}
}

func appendAttributeViewDetachedBlocksWithValues(c *gin.Context) {
	// Add an internal kernel API `/api/av/appendAttributeViewDetachedBlocksWithValues` https://github.com/siyuan-note/siyuan/issues/11608

	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	avID := arg["avID"].(string)
	var values [][]*av.Value
	for _, blocksVals := range arg["blocksValues"].([]interface{}) {
		vals := blocksVals.([]interface{})
		var rowValues []*av.Value
		for _, val := range vals {
			data, marshalErr := gulu.JSON.MarshalJSON(val)
			if nil != marshalErr {
				ret.Code = -1
				ret.Msg = marshalErr.Error()
				return
			}
			value := av.Value{}
			if unmarshalErr := gulu.JSON.UnmarshalJSON(data, &value); nil != unmarshalErr {
				ret.Code = -1
				ret.Msg = unmarshalErr.Error()
				return
			}
			rowValues = append(rowValues, &value)
		}
		values = append(values, rowValues)
	}

	err := model.AppendAttributeViewDetachedBlocksWithValues(avID, values)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func addAttributeViewBlocks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	avID := arg["avID"].(string)
	var blockID string
	if blockIDArg := arg["blockID"]; nil != blockIDArg {
		blockID = blockIDArg.(string)
	}
	var viewID string
	if viewIDArg := arg["viewID"]; nil != viewIDArg {
		viewID = viewIDArg.(string)
	}
	var groupID string
	if groupIDArg := arg["groupID"]; nil != groupIDArg {
		groupID = groupIDArg.(string)
	}
	var previousID string
	if nil != arg["previousID"] {
		previousID = arg["previousID"].(string)
	}

	var srcs []map[string]interface{}
	for _, v := range arg["srcs"].([]interface{}) {
		src := v.(map[string]interface{})
		srcs = append(srcs, src)
	}

	var ignoreDefaultFill bool
	if nil != arg["ignoreDefaultFill"] {
		ignoreDefaultFill = arg["ignoreDefaultFill"].(bool)
	}

	err := model.AddAttributeViewBlock(nil, srcs, avID, blockID, viewID, groupID, previousID, ignoreDefaultFill, map[string]interface{}{})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.ReloadAttrView(avID)
}

func removeAttributeViewBlocks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	avID := arg["avID"].(string)
	var srcIDs []string
	for _, v := range arg["srcIDs"].([]interface{}) {
		srcIDs = append(srcIDs, v.(string))
	}

	err := model.RemoveAttributeViewBlock(srcIDs, avID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.ReloadAttrView(avID)
}

func addAttributeViewKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	avID := arg["avID"].(string)
	keyID := arg["keyID"].(string)
	keyName := arg["keyName"].(string)
	keyType := arg["keyType"].(string)
	keyIcon := arg["keyIcon"].(string)
	previousKeyID := arg["previousKeyID"].(string)

	err := model.AddAttributeViewKey(avID, keyID, keyName, keyType, keyIcon, previousKeyID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.ReloadAttrView(avID)
}

func removeAttributeViewKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	avID := arg["avID"].(string)
	keyID := arg["keyID"].(string)
	removeRelationDest := false
	if nil != arg["removeRelationDest"] {
		removeRelationDest = arg["removeRelationDest"].(bool)
	}

	err := model.RemoveAttributeViewKey(avID, keyID, removeRelationDest)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.ReloadAttrView(avID)
}

func sortAttributeViewViewKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["avID"].(string)
	viewID := ""
	if viewIDArg := arg["viewID"]; nil != viewIDArg {
		viewID = viewIDArg.(string)
	}
	keyID := arg["keyID"].(string)
	previousKeyID := arg["previousKeyID"].(string)

	err := model.SortAttributeViewViewKey(avID, viewID, keyID, previousKeyID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.ReloadAttrView(avID)
}

func sortAttributeViewKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["avID"].(string)
	keyID := arg["keyID"].(string)
	previousKeyID := arg["previousKeyID"].(string)

	err := model.SortAttributeViewKey(avID, keyID, previousKeyID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.ReloadAttrView(avID)
}

func getAttributeViewFilterSort(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	avID := arg["id"].(string)
	blockID := arg["blockID"].(string)

	filters, sorts := model.GetAttributeViewFilterSort(avID, blockID)
	ret.Data = map[string]interface{}{
		"filters": filters,
		"sorts":   sorts,
	}
}

func searchAttributeViewNonRelationKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	avID := arg["avID"].(string)
	keyword := arg["keyword"].(string)

	nonRelationKeys := model.SearchAttributeViewNonRelationKey(avID, keyword)
	ret.Data = map[string]interface{}{
		"keys": nonRelationKeys,
	}
}

func searchAttributeViewRollupDestKeys(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	avID := arg["avID"].(string)
	keyword := arg["keyword"].(string)

	rollupDestKeys := model.SearchAttributeViewRollupDestKeys(avID, keyword)
	ret.Data = map[string]interface{}{
		"keys": rollupDestKeys,
	}
}

func searchAttributeViewRelationKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	avID := arg["avID"].(string)
	keyword := arg["keyword"].(string)

	relationKeys := model.SearchAttributeViewRelationKey(avID, keyword)
	ret.Data = map[string]interface{}{
		"keys": relationKeys,
	}
}

func getAttributeView(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	id := arg["id"].(string)
	ret.Data = map[string]interface{}{
		"av": model.GetAttributeView(id),
	}
}

func searchAttributeView(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	keyword := arg["keyword"].(string)
	var excludes []string
	if nil != arg["excludes"] {
		for _, e := range arg["excludes"].([]interface{}) {
			excludes = append(excludes, e.(string))
		}
	}
	results := model.SearchAttributeView(keyword, excludes)
	ret.Data = map[string]interface{}{
		"results": results,
	}
}

func renderSnapshotAttributeView(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	index := arg["snapshot"].(string)
	id := arg["id"].(string)
	view, attrView, err := model.RenderRepoSnapshotAttributeView(index, id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	var views []map[string]interface{}
	for _, v := range attrView.Views {
		view := map[string]interface{}{
			"id":               v.ID,
			"icon":             v.Icon,
			"name":             v.Name,
			"hideAttrViewName": v.HideAttrViewName,
			"type":             v.LayoutType,
		}

		views = append(views, view)
	}

	ret.Data = map[string]interface{}{
		"name":     attrView.Name,
		"id":       attrView.ID,
		"viewType": view.GetType(),
		"viewID":   view.GetID(),
		"views":    views,
		"view":     view,
		"isMirror": av.IsMirror(attrView.ID),
	}
}

func renderHistoryAttributeView(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	created := arg["created"].(string)
	blockIDArg := arg["blockID"]
	var blockID string
	if nil != blockIDArg {
		blockID = blockIDArg.(string)
	}
	viewIDArg := arg["viewID"]
	var viewID string
	if nil != viewIDArg {
		viewID = viewIDArg.(string)
	}
	page := 1
	pageArg := arg["page"]
	if nil != pageArg {
		page = int(pageArg.(float64))
	}

	pageSize := -1
	pageSizeArg := arg["pageSize"]
	if nil != pageSizeArg {
		pageSize = int(pageSizeArg.(float64))
	}

	query := ""
	queryArg := arg["query"]
	if nil != queryArg {
		query = queryArg.(string)
	}

	groupPaging := map[string]interface{}{}
	groupPagingArg := arg["groupPaging"]
	if nil != groupPagingArg {
		groupPaging = groupPagingArg.(map[string]interface{})
	}

	view, attrView, err := model.RenderHistoryAttributeView(blockID, id, viewID, query, page, pageSize, groupPaging, created)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	var views []map[string]interface{}
	for _, v := range attrView.Views {
		view := map[string]interface{}{
			"id":               v.ID,
			"icon":             v.Icon,
			"name":             v.Name,
			"hideAttrViewName": v.HideAttrViewName,
			"type":             v.LayoutType,
		}

		views = append(views, view)
	}

	ret.Data = map[string]interface{}{
		"name":     attrView.Name,
		"id":       attrView.ID,
		"viewType": view.GetType(),
		"viewID":   view.GetID(),
		"views":    views,
		"view":     view,
		"isMirror": av.IsMirror(attrView.ID),
	}
}

func renderAttributeView(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	arg, ok := util.JsonArg(c, ret)
	if !ok {
		c.JSON(http.StatusOK, ret)
		return
	}

	id := arg["id"].(string)
	blockIDArg := arg["blockID"]
	var blockID string
	if nil != blockIDArg {
		blockID = blockIDArg.(string)
	}
	viewIDArg := arg["viewID"]
	var viewID string
	if nil != viewIDArg {
		viewID = viewIDArg.(string)
	}
	page := 1
	pageArg := arg["page"]
	if nil != pageArg {
		page = int(pageArg.(float64))
	}

	pageSize := -1
	pageSizeArg := arg["pageSize"]
	if nil != pageSizeArg {
		pageSize = int(pageSizeArg.(float64))
	}

	query := ""
	queryArg := arg["query"]
	if nil != queryArg {
		query = queryArg.(string)
	}

	groupPaging := map[string]interface{}{}
	groupPagingArg := arg["groupPaging"]
	if nil != groupPagingArg {
		groupPaging = groupPagingArg.(map[string]interface{})
	}

	ret = renderAttrView(blockID, id, viewID, query, page, pageSize, groupPaging)
	c.JSON(http.StatusOK, ret)
}

func renderAttrView(blockID, avID, viewID, query string, page, pageSize int, groupPaging map[string]interface{}) (ret *gulu.Result) {
	ret = gulu.Ret.NewResult()
	view, attrView, err := model.RenderAttributeView(blockID, avID, viewID, query, page, pageSize, groupPaging)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	var views []map[string]interface{}
	for _, v := range attrView.Views {
		view := map[string]interface{}{
			"id":               v.ID,
			"icon":             v.Icon,
			"name":             v.Name,
			"desc":             v.Desc,
			"hideAttrViewName": v.HideAttrViewName,
			"type":             v.LayoutType,
			"pageSize":         v.PageSize,
		}

		views = append(views, view)
	}

	ret.Data = map[string]interface{}{
		"name":     attrView.Name,
		"id":       attrView.ID,
		"viewType": view.GetType(),
		"viewID":   view.GetID(),
		"views":    views,
		"view":     view,
		"isMirror": av.IsMirror(attrView.ID),
	}
	return
}

func getCurrentAttrViewImages(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	viewIDArg := arg["viewID"]
	var viewID string
	if nil != viewIDArg {
		viewID = viewIDArg.(string)
	}

	query := ""
	queryArg := arg["query"]
	if nil != queryArg {
		query = queryArg.(string)
	}

	images, err := model.GetCurrentAttributeViewImages(id, viewID, query)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = images
}

func getAttributeViewKeys(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	blockAttributeViewKeys := model.GetBlockAttributeViewKeys(id)
	ret.Data = blockAttributeViewKeys
}

func setAttributeViewBlockAttr(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["avID"].(string)
	keyID := arg["keyID"].(string)
	var itemID string
	if _, ok := arg["itemID"]; ok {
		itemID = arg["itemID"].(string)
	} else if _, ok := arg["rowID"]; ok {
		// TODO 计划于 2026 年 6 月 30 日后删除 https://github.com/siyuan-note/siyuan/issues/15708#issuecomment-3239694546
		itemID = arg["rowID"].(string)
	}
	value := arg["value"].(interface{})
	updatedVal, err := model.UpdateAttributeViewCell(nil, avID, keyID, itemID, value)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"value": updatedVal,
	}

	model.ReloadAttrView(avID)
}

func batchSetAttributeViewBlockAttrs(c *gin.Context) {
	// Add kernel API `/api/av/batchSetAttributeViewBlockAttrs` https://github.com/siyuan-note/siyuan/issues/15310
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["avID"].(string)
	values := arg["values"].([]interface{})
	err := model.BatchUpdateAttributeViewCells(nil, avID, values)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	model.ReloadAttrView(avID)
}
