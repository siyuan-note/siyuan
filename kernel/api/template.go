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
	databaseMode := model.TemplateDatabaseModeCopy
	if value, exists := arg["databaseMode"]; exists {
		if mode, ok := value.(string); ok {
			databaseMode = model.TemplateDatabaseMode(mode)
		} else {
			databaseMode = model.TemplateDatabaseMode("invalid")
		}
	}
	var directory string
	if value, exists := arg["directory"]; exists {
		var valid bool
		directory, valid = value.(string)
		if !valid {
			ret.Code = -1
			ret.Msg = "Invalid template directory"
			return
		}
	}
	code, err := model.DocSaveAsTemplateInDirectoryAndRemember(id, name, directory, overwrite, databaseMode)
	if err != nil {
		ret.Code = -1
		ret.Msg = util.EscapeHTML(err.Error())
		return
	}
	ret.Code = code
}

func getDocSaveAsTemplateInfo(c *gin.Context) {
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
	info, err := model.GetDocSaveAsTemplateInfo(id)
	if nil != err {
		ret.Code = -1
		ret.Msg = util.EscapeHTML(err.Error())
		return
	}
	ret.Data = info
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

	mode := model.TemplateRenderModeContent
	if modeArg := arg["mode"]; nil != modeArg {
		modeString, isString := modeArg.(string)
		if !isString || (string(model.TemplateRenderModePreview) != modeString &&
			string(model.TemplateRenderModeEditorInsert) != modeString) {
			ret.Code = -1
			ret.Msg = "Unsupported template render mode"
			return
		}
		mode = model.TemplateRenderMode(modeString)
	} else if previewArg := arg["preview"]; nil != previewArg && previewArg.(bool) {
		mode = model.TemplateRenderModePreview
	}

	var content string
	var docTreePlan *model.TemplateDocTreePlanSummary
	var err error
	if source, exists := arg["content"]; exists {
		text, ok := source.(string)
		if !ok || mode != model.TemplateRenderModePreview {
			ret.Code = -1
			ret.Msg = "Source content is only supported for template preview"
			return
		}
		_, content, docTreePlan, err = model.PreviewTemplateSource(p, id, text)
	} else {
		_, content, docTreePlan, err = model.RenderTemplateWithMode(p, id, mode)
	}
	if err != nil {
		ret.Code = -1
		ret.Msg = util.EscapeHTML(err.Error())
		return
	}

	data := map[string]any{
		"path":    p,
		"content": content,
	}
	if nil != docTreePlan {
		data["docTreePlan"] = docTreePlan
	}
	ret.Data = data
}

func manageTemplateFiles(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	var request model.TemplateFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		ret.Code = -1
		ret.Msg = "Invalid template request"
		return
	}
	data, err := model.ManageTemplateFiles(request)
	if err != nil {
		ret.Code = -1
		ret.Msg = util.EscapeHTML(err.Error())
		return
	}
	ret.Data = data
	if request.Action != "list" && request.Action != "read" {
		changed := []string{filepath.Join(util.DataDir, "templates", filepath.FromSlash(request.Path))}
		if request.Action == "move" {
			changed = append(changed, filepath.Join(util.DataDir, "templates", filepath.FromSlash(request.Target)))
		}
		model.IncSyncIfNeeded(changed...)
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
