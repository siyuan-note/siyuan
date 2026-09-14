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
	"encoding/json"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var renderSprig = contractHandler(apicontract.RenderSprig, func(c *gin.Context, request apicontract.RenderSprigRequest) apicontract.Response[string] {
	content, err := model.RenderGoTemplate(request.Template)
	if err != nil {
		return apicontract.Failure[string](-1, util.EscapeHTML(err.Error()))
	}
	return apicontract.Success(content)
})

var docSaveAsTemplate = contractHandler(apicontract.DocSaveAsTemplate, func(c *gin.Context, request apicontract.SaveTemplateRequest) apicontract.Response[apicontract.Null] {
	code, err := model.DocSaveAsTemplateInDirectoryAndRemember(request.ID, request.Name, request.Directory, request.Overwrite, model.TemplateDatabaseMode(request.DatabaseMode))
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, util.EscapeHTML(err.Error()))
	}
	if code != 0 {
		return apicontract.Failure[apicontract.Null](code, "")
	}
	return apicontract.Success(apicontract.Null{})
})

var getDocSaveAsTemplateInfo = contractHandler(apicontract.GetDocSaveAsTemplateInfo, func(c *gin.Context, request apicontract.TemplateDocumentRequest) apicontract.Response[apicontract.TemplateDocumentInfo] {
	ret := gulu.Ret.NewResult()
	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.TemplateDocumentInfo](ret)
	}
	info, err := model.GetDocSaveAsTemplateInfo(id)
	if nil != err {
		return apicontract.Failure[apicontract.TemplateDocumentInfo](-1, util.EscapeHTML(err.Error()))
	}
	return apicontract.Success(apicontract.TemplateDocumentInfo{Name: info.Name, Directory: info.Directory, HasDatabase: info.HasDatabase})
})

var renderTemplate = contractHandler(apicontract.RenderTemplate, func(c *gin.Context, request apicontract.RenderTemplateRequest) apicontract.Response[apicontract.RenderTemplateData] {
	ret := gulu.Ret.NewResult()
	p, id := request.Path, request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.RenderTemplateData](ret)
	}

	if !util.IsAbsPathInWorkspace(p) {
		ret.Code = -1
		ret.Msg = "Path [" + p + "] is not in workspace"
		return contractFailure[apicontract.RenderTemplateData](ret)
	}

	// 模板路径必须限定在 <data>/templates/ 目录内，防止通过工作空间内任意路径读取敏感文件（如 conf/conf.json）
	if !isPathInTemplatesDir(p) {
		ret.Code = -1
		ret.Msg = "Path [" + p + "] is not in templates directory"
		return contractFailure[apicontract.RenderTemplateData](ret)
	}

	modeValue, modeErr := request.RenderMode()
	if modeErr != nil {
		return apicontract.Failure[apicontract.RenderTemplateData](-1, modeErr.Error())
	}
	mode := model.TemplateRenderMode(modeValue)

	var content string
	var docTreePlan *model.TemplateDocTreePlanSummary
	var err error
	source, sourceErr := request.PreviewSource(modeValue)
	if sourceErr != nil {
		return apicontract.Failure[apicontract.RenderTemplateData](-1, sourceErr.Error())
	}
	if source != nil {
		_, content, docTreePlan, err = model.PreviewTemplateSource(p, id, *source)
	} else {
		_, content, docTreePlan, err = model.RenderTemplateWithMode(p, id, mode)
	}
	if err != nil {
		ret.Code = -1
		ret.Msg = util.EscapeHTML(err.Error())
		return contractFailure[apicontract.RenderTemplateData](ret)
	}

	data := apicontract.RenderTemplateData{Path: p, Content: content}
	if docTreePlan != nil {
		plan := &apicontract.TemplatePlan{ID: docTreePlan.ID, Count: docTreePlan.Count}
		if docTreePlan.Nodes != nil {
			plan.Nodes = make([]*apicontract.TemplatePlanNode, len(docTreePlan.Nodes))
		}
		for i, node := range docTreePlan.Nodes {
			if node != nil {
				plan.Nodes[i] = &apicontract.TemplatePlanNode{ID: node.ID, Title: node.Title, ParentID: node.ParentID, HPath: node.HPath, Depth: node.Depth}
			}
		}
		data.DocTreePlan = plan
	}
	return apicontract.Success(data)
})

var manageTemplateFiles = contractHandler(apicontract.ManageTemplateFiles, func(c *gin.Context, request apicontract.TemplateFileRequest) apicontract.Response[apicontract.TemplateManagementData] {
	data, err := model.ManageTemplateFiles(model.TemplateFileRequest{Action: request.Action, Path: request.Path, Target: request.Target, Content: request.Content, Revision: request.Revision})
	if err != nil {
		return apicontract.Failure[apicontract.TemplateManagementData](-1, util.EscapeHTML(err.Error()))
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return apicontract.Failure[apicontract.TemplateManagementData](-1, err.Error())
	}
	var result apicontract.TemplateManagementData
	switch request.Action {
	case "list":
		var entries []apicontract.TemplateFileEntry
		err = json.Unmarshal(encoded, &entries)
		result = apicontract.TemplateEntries(entries)
	case "read":
		var source apicontract.TemplateFileSource
		err = json.Unmarshal(encoded, &source)
		result = apicontract.TemplateSource(source)
	case "write":
		var revision apicontract.TemplateFileRevision
		err = json.Unmarshal(encoded, &revision)
		result = apicontract.TemplateRevision(revision)
	}
	if err != nil {
		return apicontract.Failure[apicontract.TemplateManagementData](-1, err.Error())
	}
	if request.Action != "list" && request.Action != "read" {
		changed := []string{filepath.Join(util.DataDir, "templates", filepath.FromSlash(request.Path))}
		if request.Action == "move" {
			changed = append(changed, filepath.Join(util.DataDir, "templates", filepath.FromSlash(request.Target)))
		}
		model.IncSyncIfNeeded(changed...)
	}
	return apicontract.Success(result)
})

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
