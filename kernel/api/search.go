// SiYuan - Build Your Eternal Digital Garden
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
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func findReplace(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	k := arg["k"].(string)
	r := arg["r"].(string)
	methodArg := arg["method"]
	var method int // 0：文本，1：查询语法，2：SQL，3：正则表达式
	if nil != methodArg {
		method = int(methodArg.(float64))
	}
	idsArg := arg["ids"].([]interface{})
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}
	err := model.FindReplace(k, r, ids, method)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
	return
}

func searchAsset(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	k := arg["k"].(string)
	ret.Data = model.SearchAssetsByName(k)
	return
}

func searchTag(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	k := arg["k"].(string)
	tags := model.SearchTags(k)
	if 1 > len(tags) {
		tags = []string{}
	}
	ret.Data = map[string]interface{}{
		"tags": tags,
		"k":    k,
	}
}

func searchWidget(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	keyword := arg["k"].(string)
	blocks := model.SearchWidget(keyword)
	ret.Data = map[string]interface{}{
		"blocks": blocks,
		"k":      keyword,
	}
}

func removeTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)
	err := model.RemoveTemplate(path)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func searchTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	keyword := arg["k"].(string)
	blocks := model.SearchTemplate(keyword)
	ret.Data = map[string]interface{}{
		"blocks": blocks,
		"k":      keyword,
	}
}

func searchEmbedBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	embedBlockID := arg["embedBlockID"].(string)
	stmt := arg["stmt"].(string)
	excludeIDsArg := arg["excludeIDs"].([]interface{})
	var excludeIDs []string
	for _, excludeID := range excludeIDsArg {
		excludeIDs = append(excludeIDs, excludeID.(string))
	}
	headingMode := 0 // 0：带标题下方块
	headingModeArg := arg["headingMode"]
	if nil != headingModeArg {
		headingMode = int(headingModeArg.(float64))
	}
	breadcrumb := false
	breadcrumbArg := arg["breadcrumb"]
	if nil != breadcrumbArg {
		breadcrumb = breadcrumbArg.(bool)
	}

	blocks := model.SearchEmbedBlock(embedBlockID, stmt, excludeIDs, headingMode, breadcrumb)
	ret.Data = map[string]interface{}{
		"blocks": blocks,
	}
}

func searchRefBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	reqId := arg["reqId"]
	ret.Data = map[string]interface{}{"reqId": reqId}
	if nil == arg["id"] {
		return
	}

	onlyDoc := false
	if nil != arg["onlyDoc"] {
		onlyDoc = arg["onlyDoc"].(bool)
	}

	rootID := arg["rootID"].(string)
	id := arg["id"].(string)
	keyword := arg["k"].(string)
	beforeLen := int(arg["beforeLen"].(float64))
	blocks, newDoc := model.SearchRefBlock(id, rootID, keyword, beforeLen, onlyDoc)
	ret.Data = map[string]interface{}{
		"blocks": blocks,
		"newDoc": newDoc,
		"k":      util.EscapeHTML(keyword),
		"reqId":  arg["reqId"],
	}
}

func fullTextSearchBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	query := arg["query"].(string)
	pathsArg := arg["paths"]
	var paths, boxes []string
	if nil != pathsArg {
		for _, p := range pathsArg.([]interface{}) {
			path := p.(string)
			box := strings.TrimSpace(strings.Split(path, "/")[0])
			if "" != box {
				boxes = append(boxes, box)
			}
			path = strings.TrimSpace(strings.TrimPrefix(path, box))
			if "" != path {
				paths = append(paths, path)
			}
		}
		paths = gulu.Str.RemoveDuplicatedElem(paths)
		boxes = gulu.Str.RemoveDuplicatedElem(boxes)
	}
	var types map[string]bool
	if nil != arg["types"] {
		typesArg := arg["types"].(map[string]interface{})
		types = map[string]bool{}
		for t, b := range typesArg {
			types[t] = b.(bool)
		}
	}
	methodArg := arg["method"]
	var method int // 0：关键字，1：查询语法，2：SQL，3：正则表达式
	if nil != methodArg {
		method = int(methodArg.(float64))
	}
	orderByArg := arg["orderBy"]
	var orderBy int // 0：按块类型（默认），1：按创建时间升序，2：按创建时间降序，3：按更新时间升序，4：按更新时间降序，5：按内容顺序（仅在按文档分组时），6：按相关度升序，7：按相关度降序
	if nil != orderByArg {
		orderBy = int(orderByArg.(float64))
	}
	groupByArg := arg["groupBy"]
	var groupBy int // 0：不分组，1：按文档分组
	if nil != groupByArg {
		groupBy = int(groupByArg.(float64))
	}
	blocks, matchedBlockCount, matchedRootCount := model.FullTextSearchBlock(query, boxes, paths, types, method, orderBy, groupBy)
	ret.Data = map[string]interface{}{
		"blocks":            blocks,
		"matchedBlockCount": matchedBlockCount,
		"matchedRootCount":  matchedRootCount,
	}
}
