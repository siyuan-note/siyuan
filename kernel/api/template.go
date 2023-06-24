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

func renderSprig(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	template := arg["template"].(string)
	content, err := model.RenderGoTemplate(template)
	if nil != err {
		ret.Code = -1
		ret.Msg = util.EscapeHTML(err.Error())
		return
	}
	ret.Data = content
}

func docSaveAsTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name := arg["name"].(string)
	overwrite := arg["overwrite"].(bool)
	code, err := model.DocSaveAsTemplate(id, name, overwrite)
	if nil != err {
		ret.Code = -1
		ret.Msg = util.EscapeHTML(err.Error())
		return
	}
	ret.Code = code
}

func renderTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	p := arg["path"].(string)
	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	content, err := model.RenderTemplate(p, id)
	if nil != err {
		ret.Code = -1
		ret.Msg = util.EscapeHTML(err.Error())
		return
	}

	ret.Data = map[string]interface{}{
		"path":    p,
		"content": content,
	}
}
