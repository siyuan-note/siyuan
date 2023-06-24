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
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getBookmarkLabels(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = model.BookmarkLabels()
}

func getBlockAttrs(c *gin.Context) {
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

	ret.Data = model.GetBlockAttrs(id)
}

func setBlockAttrs(c *gin.Context) {
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

	attrs := arg["attrs"].(map[string]interface{})
	if 1 == len(attrs) && "" != attrs["scroll"] {
		// 不记录用户指南滚动位置
		if b := treenode.GetBlockTree(id); nil != b && (model.IsUserGuide(b.BoxID)) {
			attrs["scroll"] = ""
		}
	}

	nameValues := map[string]string{}
	for name, value := range attrs {
		if nil == value { // API `setBlockAttrs` 中如果存在属性值设置为 `null` 时移除该属性 https://github.com/siyuan-note/siyuan/issues/5577
			nameValues[name] = ""
		} else {
			nameValues[name] = value.(string)
		}
	}
	err := model.SetBlockAttrs(id, nameValues)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func resetBlockAttrs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	attrs := arg["attrs"].(map[string]interface{})
	nameValues := map[string]string{}
	for name, value := range attrs {
		nameValues[name] = value.(string)
	}
	err := model.ResetBlockAttrs(id, nameValues)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
