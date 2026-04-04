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
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getTag(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var ignoreMaxListHint bool
	var app string
	if !util.ParseJsonArgs(arg, ret,
		// API `getTag` add an optional parameter `ignoreMaxListHint` https://github.com/siyuan-note/siyuan/issues/16000
		util.BindJsonArg("ignoreMaxListHint", &ignoreMaxListHint, false, false),
		util.BindJsonArg("app", &app, false, false),
	) {
		return
	}

	if nil != arg["sort"] {
		sortVal, ok := util.ParseJsonArg[float64]("sort", arg, ret, true, false)
		if !ok {
			return
		}
		model.Conf.Tag.Sort = int(sortVal)
		model.Conf.Save()
	}

	tags := model.BuildTags(ignoreMaxListHint, app)

	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		publishIgnore := model.GetInvisiblePublishAccess(publishAccess)
		tags = model.FilterTagsByPublishIgnore(publishIgnore, tags)
	}
	ret.Data = tags
}

func renameTag(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var oldLabel, newLabel string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("oldLabel", &oldLabel, true, false),
		util.BindJsonArg("newLabel", &newLabel, true, true),
	) {
		return
	}
	if err := model.RenameTag(oldLabel, newLabel); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func removeTag(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var label string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("label", &label, true, false)) {
		return
	}
	if err := model.RemoveTag(label); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}
