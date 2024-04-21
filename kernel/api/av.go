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

func getMirrorDatabaseBlocks(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["avID"].(string)
	ret.Data = treenode.GetMirrorAttrViewBlockIDs(avID)
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

	err := model.SetDatabaseBlockView(blockID, viewID)
	if nil != err {
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
	if nil != err {
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

func addAttributeViewValues(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, _ := util.JsonArg(c, ret)
	if nil == arg {
		return
	}

	avID := arg["avID"].(string)
	blockID := ""
	if blockIDArg := arg["blockID"]; nil != blockIDArg {
		blockID = blockIDArg.(string)
	}
	var previousID string
	if nil != arg["previousID"] {
		previousID = arg["previousID"].(string)
	}
	ignoreFillFilter := true
	if nil != arg["ignoreFillFilter"] {
		ignoreFillFilter = arg["ignoreFillFilter"].(bool)
	}

	var srcs []map[string]interface{}
	for _, v := range arg["srcs"].([]interface{}) {
		src := v.(map[string]interface{})
		srcs = append(srcs, src)
	}
	err := model.AddAttributeViewBlock(nil, srcs, avID, blockID, previousID, ignoreFillFilter)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	util.PushReloadAttrView(avID)
}

func removeAttributeViewValues(c *gin.Context) {
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
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	util.PushReloadAttrView(avID)
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
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	util.PushReloadAttrView(avID)
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

	err := model.RemoveAttributeViewKey(avID, keyID)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	util.PushReloadAttrView(avID)
}

func sortAttributeViewKey(c *gin.Context) {
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

	err := model.SortAttributeViewKey(avID, viewID, keyID, previousKeyID)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	util.PushReloadAttrView(avID)
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
	if nil != err {
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
	view, attrView, err := model.RenderHistoryAttributeView(id, created)
	if nil != err {
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

	view, attrView, err := model.RenderAttributeView(id, viewID, query, page, pageSize)
	if nil != err {
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
	rowID := arg["rowID"].(string)
	cellID := arg["cellID"].(string)
	value := arg["value"].(interface{})
	blockAttributeViewKeys := model.UpdateAttributeViewCell(nil, avID, keyID, rowID, cellID, value)
	ret.Data = blockAttributeViewKeys

	util.PushReloadAttrView(avID)
}
