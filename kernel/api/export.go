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
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func exportEPUB(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportPandocConvertZip(id, "epub", ".epub")
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func exportRTF(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportPandocConvertZip(id, "rtf", ".rtf")
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func exportODT(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportPandocConvertZip(id, "odt", ".odt")
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func exportMediaWiki(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportPandocConvertZip(id, "mediawiki", ".wiki")
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func exportOrgMode(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportPandocConvertZip(id, "org", ".org")
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func exportOPML(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportPandocConvertZip(id, "opml", ".opml")
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func exportTextile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportPandocConvertZip(id, "textile", ".textile")
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func exportAsciiDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportPandocConvertZip(id, "asciidoc", ".adoc")
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func exportReStructuredText(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportPandocConvertZip(id, "rst", ".rst")
	ret.Data = map[string]interface{}{
		"name": name,
		"zip":  zipPath,
	}
}

func export2Liandi(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	err := model.Export2Liandi(id)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func exportDataInFolder(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	exportFolder := arg["folder"].(string)
	name, err := model.ExportDataInFolder(exportFolder)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
	ret.Data = map[string]interface{}{
		"name": name,
	}
}

func exportData(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	zipPath, err := model.ExportData()
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
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
	name, zipPath := model.ExportPandocConvertZip(id, "", ".md")
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
	if util.InvalidIDPattern(id, ret) {
		return
	}

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
	merge := false
	if nil != arg["merge"] {
		merge = arg["merge"].(bool)
	}
	err := model.ExportDocx(id, savePath, removeAssets, merge)
	if nil != err {
		ret.Code = -1
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
	name, content := model.ExportMarkdownHTML(id, savePath, false, false)
	ret.Data = map[string]interface{}{
		"id":      id,
		"name":    name,
		"content": content,
	}
}

func exportTempContent(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	content := arg["content"].(string)
	tmpExport := filepath.Join(util.TempDir, "export", "temp")
	if err := os.MkdirAll(tmpExport, 0755); nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
	p := filepath.Join(tmpExport, gulu.Rand.String(7))
	if err := os.WriteFile(p, []byte(content), 0644); nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
	url := path.Join("/export/temp/", filepath.Base(p))
	ret.Data = map[string]interface{}{
		"url": "http://" + util.LocalHost + ":" + util.ServerPort + url,
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
	keepFold := false
	if nil != arg["keepFold"] {
		keepFold = arg["keepFold"].(bool)
	}
	merge := false
	if nil != arg["merge"] {
		merge = arg["merge"].(bool)
	}
	image := false
	if nil != arg["image"] {
		image = arg["image"].(bool)
	}
	name, content := model.ExportHTML(id, "", true, image, keepFold, merge)
	// 导出 PDF 预览时点击块引转换后的脚注跳转不正确 https://github.com/siyuan-note/siyuan/issues/5894
	content = strings.ReplaceAll(content, "http://"+util.LocalHost+":"+util.ServerPort+"/#", "#")

	ret.Data = map[string]interface{}{
		"id":      id,
		"name":    name,
		"content": content,
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
	keepFold := false
	if nil != arg["keepFold"] {
		keepFold = arg["keepFold"].(bool)
	}
	merge := false
	if nil != arg["merge"] {
		merge = arg["merge"].(bool)
	}
	name, content := model.ExportHTML(id, savePath, pdf, false, keepFold, merge)
	ret.Data = map[string]interface{}{
		"id":      id,
		"name":    name,
		"content": content,
	}
}

func processPDF(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	path := arg["path"].(string)
	merge := false
	if nil != arg["merge"] {
		merge = arg["merge"].(bool)
	}
	removeAssets := arg["removeAssets"].(bool)
	err := model.ProcessPDF(id, path, merge, removeAssets)
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
	stdHTML, outline := model.Preview(id)
	ret.Data = map[string]interface{}{
		"html":    stdHTML,
		"outline": outline,
	}
}

func exportAsFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	form, err := c.MultipartForm()
	if nil != err {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	file := form.File["file"][0]
	reader, err := file.Open()
	if nil != err {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if nil != err {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	name := "file-" + file.Filename
	name = util.FilterFileName(name)
	tmpDir := filepath.Join(util.TempDir, "export")
	if err = os.MkdirAll(tmpDir, 0755); nil != err {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmp := filepath.Join(tmpDir, name)
	err = os.WriteFile(tmp, data, 0644)
	if nil != err {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"name": name,
		"file": path.Join("/export/", name),
	}
}
