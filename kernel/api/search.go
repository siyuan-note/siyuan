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
	"github.com/88250/lute/html"
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
	idsArg := arg["ids"].([]interface{})
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}
	err := model.FindReplace(k, r, ids)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 3000}
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
	blocks := model.SearchEmbedBlock(stmt, excludeIDs, headingMode)

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

	rootID := arg["rootID"].(string)
	id := arg["id"].(string)
	keyword := arg["k"].(string)
	beforeLen := int(arg["beforeLen"].(float64))
	blocks, newDoc := model.SearchRefBlock(id, rootID, keyword, beforeLen)
	ret.Data = map[string]interface{}{
		"blocks": blocks,
		"newDoc": newDoc,
		"k":      html.EscapeHTMLStr(keyword),
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
	pathArg := arg["path"]
	var path string
	if nil != pathArg {
		path = pathArg.(string)
	}
	var box string
	if "" != path {
		box = strings.Split(path, "/")[0]
		path = strings.TrimPrefix(path, box)
	}
	var types map[string]bool
	if nil != arg["types"] {
		typesArg := arg["types"].(map[string]interface{})
		types = map[string]bool{}
		for t, b := range typesArg {
			types[t] = b.(bool)
		}
	}
	querySyntaxArg := arg["querySyntax"]
	var querySyntax bool
	if nil != querySyntaxArg {
		querySyntax = querySyntaxArg.(bool)
	}
	blocks := model.FullTextSearchBlock(query, box, path, types, querySyntax)
	ret.Data = blocks
}
