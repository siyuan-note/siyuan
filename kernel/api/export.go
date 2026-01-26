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
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/mssola/useragent"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func exportCodeBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	filePath, err := model.ExportCodeBlock(id)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	ret.Data = map[string]interface{}{
		"path": filePath,
	}
}

func exportAttributeView(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	avID := arg["id"].(string)
	blockID := arg["blockID"].(string)
	zipPath, err := model.ExportAv2CSV(avID, blockID)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}

	ret.Data = map[string]interface{}{
		"zip": zipPath,
	}
}

func exportEPUB(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "epub", ".epub")
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
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "rtf", ".rtf")
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
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "odt", ".odt")
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
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "mediawiki", ".wiki")
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
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "org", ".org")
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
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "opml", ".opml")
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
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "textile", ".textile")
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
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "asciidoc", ".adoc")
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
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "rst", ".rst")
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
	if err != nil {
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
	if err != nil {
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
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
	ret.Data = map[string]interface{}{
		"zip": zipPath,
	}
}

func exportResources(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var name string
	if nil != arg["name"] {
		name = util.TruncateLenFileName(arg["name"].(string))
	}
	if name == "" {
		name = time.Now().Format("export-2006-01-02_15-04-05") // 生成的 *.zip 文件主文件名
	}

	if nil == arg["paths"] {
		ret.Code = 1
		ret.Data = ""
		ret.Msg = "paths is required"
		return
	}

	var resourcePaths []string // 文件/文件夹在工作空间中的路径
	for _, resourcePath := range arg["paths"].([]interface{}) {
		resourcePaths = append(resourcePaths, resourcePath.(string))
	}

	zipFilePath, err := model.ExportResources(resourcePaths, name)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
	ret.Data = map[string]interface{}{
		"path": zipFilePath, // 相对于工作空间目录的路径
	}
}

func exportNotebookMd(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	zipPath := model.ExportNotebookMarkdown(notebook)
	ret.Data = map[string]interface{}{
		"name": path.Base(zipPath),
		"zip":  zipPath,
	}
}

func exportMds(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["ids"].([]interface{})
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}

	name, zipPath := model.ExportPandocConvertZip(ids, "", ".md")
	ret.Data = map[string]interface{}{
		"name": name,
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
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "", ".md")
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

func exportSYs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["ids"].([]interface{})
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}

	zipPath := model.ExportSYs(ids)
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
	zipPath := model.ExportSYs([]string{id})
	ret.Data = map[string]interface{}{
		"zip": zipPath,
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

	refMode := model.Conf.Export.BlockRefMode
	if nil != arg["refMode"] {
		refMode = int(arg["refMode"].(float64))
	}

	embedMode := model.Conf.Export.BlockEmbedMode
	if nil != arg["embedMode"] {
		embedMode = int(arg["embedMode"].(float64))
	}

	yfm := true
	if nil != arg["yfm"] {
		yfm = arg["yfm"].(bool)
	}

	fillCSSVar := false
	if nil != arg["fillCSSVar"] {
		fillCSSVar = arg["fillCSSVar"].(bool)
	}

	adjustHeadingLevel := false
	if nil != arg["adjustHeadingLevel"] {
		adjustHeadingLevel = arg["adjustHeadingLevel"].(bool)
	}

	imgTag := false
	if nil != arg["imgTag"] {
		imgTag = arg["imgTag"].(bool)
	}

	addTitle := model.Conf.Export.AddTitle
	if nil != arg["addTitle"] {
		if arg["addTitle"].(bool) {
			addTitle = true
		} else {
			addTitle = false
		}
	}

	hPath, content := model.ExportMarkdownContent(id, refMode, embedMode, yfm, fillCSSVar, adjustHeadingLevel, imgTag, addTitle)
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

	fullPath, err := model.ExportDocx(id, savePath, removeAssets, merge)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
	ret.Data = map[string]interface{}{
		"path": fullPath,
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

	savePath = strings.TrimSpace(savePath)
	if savePath == "" {
		folderName := "htmlmd-" + id + "-" + util.CurrentTimeSecondsStr()
		tmpDir := filepath.Join(util.TempDir, "export", folderName)
		name, content := model.ExportMarkdownHTML(id, tmpDir, false, false)
		ret.Data = map[string]interface{}{
			"id":      id,
			"name":    name,
			"content": content,
			"folder":  folderName,
		}
		return
	}

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
	if err := os.MkdirAll(tmpExport, 0755); err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 7000}
		return
	}
	p := filepath.Join(tmpExport, gulu.Rand.String(7))
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
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

func exportBrowserHTML(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	folder := arg["folder"].(string)
	htmlContent := arg["html"].(string)
	name := arg["name"].(string)

	tmpDir := filepath.Join(util.TempDir, "export", folder)

	htmlPath := filepath.Join(tmpDir, "index.html")
	if err := filelock.WriteFile(htmlPath, []byte(htmlContent)); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = nil
		return
	}

	zipFileName := util.FilterFileName(name) + ".zip"
	zipPath := filepath.Join(util.TempDir, "export", zipFileName)
	zip, err := gulu.Zip.Create(zipPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = nil
		return
	}

	err = zip.AddDirectory("", tmpDir, func(string) {})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = nil
		return
	}

	if err = zip.Close(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = nil
		return
	}

	os.RemoveAll(tmpDir)

	zipURL := "/export/" + url.PathEscape(filepath.Base(zipPath))
	ret.Data = map[string]interface{}{
		"zip": zipURL,
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
	name, content, node := model.ExportHTML(id, "", true, image, keepFold, merge)
	// 导出 PDF 预览时点击块引转换后的脚注跳转不正确 https://github.com/siyuan-note/siyuan/issues/5894
	content = strings.ReplaceAll(content, "http://"+util.LocalHost+":"+util.ServerPort+"/#", "#")

	// Add `data-doc-type` and attribute when exporting image and PDF https://github.com/siyuan-note/siyuan/issues/9497
	attrs := map[string]string{}
	var typ string
	if nil != node {
		attrs = parse.IAL2Map(node.KramdownIAL)
		typ = node.Type.String()
	}

	ret.Data = map[string]interface{}{
		"id":      id,
		"name":    name,
		"content": content,
		"attrs":   attrs,
		"type":    typ,
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

	savePath = strings.TrimSpace(savePath)
	if savePath == "" {
		folderName := "html-" + id + "-" + util.CurrentTimeSecondsStr()
		tmpDir := filepath.Join(util.TempDir, "export", folderName)
		name, content, _ := model.ExportHTML(id, tmpDir, pdf, false, keepFold, merge)
		ret.Data = map[string]interface{}{
			"id":      id,
			"name":    name,
			"content": content,
			"folder":  folderName,
		}
		return
	}

	name, content, _ := model.ExportHTML(id, savePath, pdf, false, keepFold, merge)
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
	watermark := arg["watermark"].(bool)
	err := model.ProcessPDF(id, path, merge, removeAssets, watermark)
	if err != nil {
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

	userAgentStr := c.GetHeader("User-Agent")
	fillCSSVar := true
	if userAgentStr != "" {
		ua := useragent.New(userAgentStr)
		name, _ := ua.Browser()
		// Chrome、Edge、SiYuan 桌面端不需要替换 CSS 变量
		if !ua.Mobile() && (name == "Chrome" || name == "Edge" || strings.Contains(userAgentStr, "Electron") || strings.Contains(userAgentStr, "SiYuan/")) {
			fillCSSVar = false
		}
	}

	stdHTML := model.ExportPreview(id, fillCSSVar)
	ret.Data = map[string]interface{}{
		"html":       stdHTML,
		"fillCSSVar": fillCSSVar,
	}
}

func exportAsFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	form, err := c.MultipartForm()
	if err != nil {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	file := form.File["file"][0]
	reader, err := file.Open()
	if err != nil {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	name := "file-" + file.Filename
	typ := form.Value["type"][0]
	exts, _ := mime.ExtensionsByType(typ)
	if 0 < len(exts) && filepath.Ext(name) != exts[0] {
		name += exts[0]
	}
	name = util.FilterFileName(name)
	name = strings.ReplaceAll(name, "#", "_")
	tmpDir := filepath.Join(util.TempDir, "export")
	if err = os.MkdirAll(tmpDir, 0755); err != nil {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	tmp := filepath.Join(tmpDir, name)
	err = os.WriteFile(tmp, data, 0644)
	if err != nil {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"file": path.Join("/export/", name),
	}
}
