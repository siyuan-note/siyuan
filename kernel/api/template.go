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
	"net/http"
	"path/filepath"

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
	if err != nil {
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
	if err != nil {
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

	if !util.IsAbsPathInWorkspace(p) {
		ret.Code = -1
		ret.Msg = "Path [" + p + "] is not in workspace"
		return
	}

	// 模板路径必须限定在 <data>/templates/ 目录内，防止通过工作空间内任意路径读取敏感文件（如 conf/conf.json）
	if !isPathInTemplatesDir(p) {
		ret.Code = -1
		ret.Msg = "Path [" + p + "] is not in templates directory"
		return
	}

	preview := false
	if previewArg := arg["preview"]; nil != previewArg {
		preview = previewArg.(bool)
	}

	_, content, err := model.RenderTemplate(p, id, preview)
	if err != nil {
		ret.Code = -1
		ret.Msg = util.EscapeHTML(err.Error())
		return
	}

	ret.Data = map[string]any{
		"path":    p,
		"content": content,
	}
}

// isPathInTemplatesDir 校验绝对路径是否位于 <data>/templates/ 目录内，解析符号链接后再次校验，
// 防止通过符号链接指向模板目录外的敏感文件
func isPathInTemplatesDir(p string) bool {
	abs := filepath.Clean(p)
	templatesRoot := filepath.Clean(filepath.Join(util.DataDir, "templates"))
	if !gulu.File.IsSubPath(templatesRoot, abs) {
		return false
	}
	realRoot, err := filepath.EvalSymlinks(templatesRoot)
	if nil != err {
		return false
	}
	realPath, err := filepath.EvalSymlinks(abs)
	if nil != err {
		return false
	}
	return gulu.File.IsSubPath(realRoot, realPath)
}
