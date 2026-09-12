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
	"fmt"
	"net/http"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getBookmarkLabels(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if model.IsReadOnlyRoleContext(c) {
		ret.Data = model.BookmarkLabelsByPublishAccess(c, model.GetPublishAccess())
	} else {
		ret.Data = model.BookmarkLabels()
	}
}

func batchGetBlockAttrs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	ids := arg["ids"].([]any)
	var idList []string
	for _, id := range ids {
		idList = append(idList, id.(string))
	}

	idList = filterBlockIDsByPublishAccess(c, idList, "")
	ret.Data = sql.BatchGetBlockAttrs(idList)
}

var getBlockAttrs = contractHandler(apicontract.GetBlockAttrs, func(c *gin.Context, request apicontract.BlockIDRequest) apicontract.Response[map[string]string] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[map[string]string](ret)
	}
	if !checkBlockPublishAccess(c, id, ret) {
		return contractFailure[map[string]string](ret)
	}

	return apicontract.Success(sql.GetBlockAttrs(id))
})

var setBlockAttrs = contractHandler(apicontract.SetBlockAttrs, func(c *gin.Context, request apicontract.SetBlockAttrsRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	attrs := request.Attrs
	scroll := attrs["scroll"]
	if 1 == len(attrs) && (scroll == nil || *scroll != "") {
		// 不记录用户指南滚动位置
		if b := treenode.GetBlockTree(id); nil != b && (model.IsUserGuide(b.BoxID)) {
			empty := ""
			attrs["scroll"] = &empty
		}
	}

	nameValues := map[string]string{}
	for name, value := range attrs {
		if nil == value { // API `setBlockAttrs` 中如果存在属性值设置为 `null` 时移除该属性 https://github.com/siyuan-note/siyuan/issues/5577
			nameValues[name] = ""
		} else {
			nameValues[name] = *value
		}
	}
	err := model.SetBlockAttrs(id, nameValues)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return apicontract.Success(apicontract.Null{})
})

func batchSetBlockAttrs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	blockAttrsArg := arg["blockAttrs"].([]any)
	var blockAttrs []map[string]any
	for _, blockAttrArg := range blockAttrsArg {
		blockAttr := blockAttrArg.(map[string]any)
		id := blockAttr["id"].(string)
		if util.InvalidIDPattern(id, ret) {
			return
		}

		attrs := blockAttr["attrs"].(map[string]any)
		nameValues := map[string]string{}
		for name, value := range attrs {
			if nil == value {
				nameValues[name] = ""
			} else {
				strValue, ok := value.(string)
				if !ok {
					ret.Code = -1
					ret.Msg = fmt.Sprintf("the value of attr [%s] must be a string", name)
					return
				}
				nameValues[name] = strValue
			}
		}

		blockAttrs = append(blockAttrs, map[string]any{
			"id":    id,
			"attrs": nameValues,
		})
	}

	err := model.BatchSetBlockAttrs(blockAttrs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
