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
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func exportDataInFolder(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	exportFolder := arg["folder"].(string)
	err := model.ExportDataInFolder(exportFolder)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
}

func exportData(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	zipPath := model.ExportData()
	ret.Data = map[string]interface{}{
		"zip": zipPath,
	}
}

func batchExportMd(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	p := arg["path"].(string)
	zipPath := model.BatchExportMarkdown(notebook, p)
	ret.Data = map[string]interface{}{
		"name": path.Base(zipPath),
		"zip":  zipPath,
	}
}

func exportMd(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportMarkdown(id)
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func exportNotebookSY(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	zipPath := model.ExportNotebookSY(id)
	ret.Data = map[string]interface{}{
		"zip": zipPath,
	}
}

func exportSY(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportSY(id)
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func exportMdContent(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	hPath, content := model.ExportMarkdownContent(id)
	ret.Data = map[string]interface{}{
		"hPath":   hPath,
		"content": content,
	}
}

func exportDocx(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	savePath := arg["savePath"].(string)
	removeAssets := arg["removeAssets"].(bool)
	err := model.ExportDocx(id, savePath, removeAssets)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
}

func exportMdHTML(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	savePath := arg["savePath"].(string)
	name, content := model.ExportMarkdownHTML(id, savePath, false)
	ret.Data = map[string]interface{}{
		"id":      id,
		"name":    name,
		"content": content,
	}
}

func exportPreviewHTML(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	tpl := arg["tpl"].(string)
	name, content := model.ExportHTML(id, "", true)
	// 导出 PDF 预览时点击块引转换后的脚注跳转不正确 https://github.com/siyuan-note/siyuan/issues/5894
	content = strings.ReplaceAll(content, "http://127.0.0.1:"+util.ServerPort+"/#", "#")
	tpl = strings.ReplaceAll(tpl, "{tpl.name}", name)
	tpl = strings.ReplaceAll(tpl, "{tpl.content}", content)
	tmpName := gulu.Rand.String(7)
	tmpDir := filepath.Join(util.TempDir, "export", "preview")
	if err := os.MkdirAll(tmpDir, 0755); nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
	tmpPath := filepath.Join(tmpDir, tmpName)
	if err := os.WriteFile(tmpPath, []byte(tpl), 0644); nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	url := path.Join("http://127.0.0.1:"+util.ServerPort, "export", "preview", tmpName)
	ret.Data = map[string]interface{}{
		"id":   id,
		"name": name,
		"url":  url,
	}
}

func exportHTML(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	pdf := arg["pdf"].(bool)
	savePath := arg["savePath"].(string)
	name, content := model.ExportHTML(id, savePath, pdf)
	ret.Data = map[string]interface{}{
		"id":      id,
		"name":    name,
		"content": content,
	}
}

func addPDFOutline(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	path := arg["path"].(string)
	err := model.AddPDFOutline(id, path)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func exportPreview(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	stdHTML := model.Preview(id)
	ret.Data = map[string]interface{}{
		"html": stdHTML,
	}
}
