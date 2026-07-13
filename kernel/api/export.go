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
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/mssola/useragent"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func exportCodeBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	filePath, err := model.ExportCodeBlock(id)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}

	ret.Data = map[string]any{
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

	var avID, blockID string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("id", &avID, true, true),
		util.BindJsonArg("blockID", &blockID, true, true),
	) {
		return
	}
	zipPath, err := model.ExportAv2CSV(avID, blockID)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}

	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "epub", ".epub")
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "rtf", ".rtf")
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "odt", ".odt")
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "mediawiki", ".wiki")
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "org", ".org")
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "opml", ".opml")
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "textile", ".textile")
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "asciidoc", ".adoc")
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "rst", ".rst")
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
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

	var exportFolder string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("folder", &exportFolder, true, true)) {
		return
	}
	name, err := model.ExportDataInFolder(exportFolder)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}
	ret.Data = map[string]any{
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
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}
	ret.Data = map[string]any{
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
		ret.Msg = "[paths] is required"
		return
	}

	var resourcePaths []string // 文件/文件夹在工作空间中的路径
	for _, resourcePath := range arg["paths"].([]any) {
		resourcePaths = append(resourcePaths, resourcePath.(string))
	}

	zipFilePath, err := model.ExportResources(resourcePaths, name)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}
	ret.Data = map[string]any{
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

	var notebook string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("notebook", &notebook, true, true)) {
		return
	}
	zipPath := model.ExportNotebookMarkdownWithOptions(notebook, model.ParseExportOptions(arg))
	ret.Data = map[string]any{
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

	idsArg := arg["ids"].([]any)
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}

	name, zipPath := model.ExportPandocConvertZipWithOptions(ids, "", ".md", model.ParseExportOptions(arg))
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	name, zipPath := model.ExportPandocConvertZipWithOptions([]string{id}, "", ".md", model.ParseExportOptions(arg))
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	zipPath := model.ExportNotebookSY(id)
	ret.Data = map[string]any{
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

	idsArg := arg["ids"].([]any)
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}

	zipPath := model.ExportSYs(ids)
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
	zipPath := model.ExportSYs([]string{id})
	ret.Data = map[string]any{
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}
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

	var fillCSSVar, adjustHeadingLevel, imgTag bool
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("fillCSSVar", &fillCSSVar, false, false),
		util.BindJsonArg("adjustHeadingLevel", &adjustHeadingLevel, false, false),
		util.BindJsonArg("imgTag", &imgTag, false, false),
	) {
		return
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
	ret.Data = map[string]any{
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

	var id, savePath string
	var removeAssets, merge bool
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("id", &id, true, true),
		util.BindJsonArg("savePath", &savePath, true, true),
		util.BindJsonArg("removeAssets", &removeAssets, true, false),
		util.BindJsonArg("merge", &merge, false, false),
	) {
		return
	}

	// savePath 由客户端指定，禁止写入加密笔记本目录（明文导出物会绕过加密、锁定后残留）
	if rejectEncryptedBoxPath(savePath) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(313)
		return
	}

	fullPath, err := model.ExportDocx(id, savePath, removeAssets, merge)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}
	ret.Data = map[string]any{
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

	var id, savePath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("id", &id, true, true),
		util.BindJsonArg("savePath", &savePath, false, false),
	) {
		return
	}

	savePath = strings.TrimSpace(savePath)
	if savePath == "" {
		folderName := "htmlmd-" + id + "-" + util.CurrentTimeSecondsStr()
		// 加密笔记本的导出临时目录归入 boxID 子目录，确保 LockBox 能清理和服务端可校验锁定状态
		if bt := treenode.GetBlockTree(id); bt != nil && model.IsEncryptedBox(bt.BoxID) {
			folderName = bt.BoxID + "/" + folderName
		}
		tmpDir := filepath.Join(util.TempDir, "export", folderName)
		name, content := model.ExportMarkdownHTML(id, tmpDir, false, false)
		ret.Data = map[string]any{
			"id":      id,
			"name":    name,
			"content": content,
			"folder":  folderName,
		}
		return
	}

	// savePath 由客户端指定，禁止写入加密笔记本目录（明文导出物会绕过加密、锁定后残留）
	if rejectEncryptedBoxPath(savePath) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(313)
		return
	}

	name, content := model.ExportMarkdownHTML(id, savePath, false, false)
	ret.Data = map[string]any{
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

	var content, id string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("content", &content, true, false),
		util.BindJsonArg("id", &id, false, false),
	) {
		return
	}
	tmpExport := filepath.Join(util.TempDir, "export")
	// 加密笔记本的临时导出归入 boxID 子目录，确保 LockBox 清理和服务端校验锁定状态
	if id != "" {
		if bt := treenode.GetBlockTree(id); bt != nil && model.IsEncryptedBox(bt.BoxID) {
			tmpExport = filepath.Join(tmpExport, bt.BoxID)
		}
	}
	tmpExport = filepath.Join(tmpExport, "temp")
	if err := os.MkdirAll(tmpExport, 0755); err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}
	p := filepath.Join(tmpExport, gulu.Rand.String(7))
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}
	baseName := filepath.Base(p)
	urlPath := "/export/"
	if boxID := func() string {
		if id != "" {
			if bt := treenode.GetBlockTree(id); bt != nil && model.IsEncryptedBox(bt.BoxID) {
				return bt.BoxID
			}
		}
		return ""
	}(); boxID != "" {
		// 加密笔记本的临时导出产物须注册到托管表，否则服务端守卫（IsManagedEncryptedExportPath）会拒绝下载
		token := model.RegisterManagedEncryptedExport(boxID, "temp", p)
		urlPath += token
	} else {
		urlPath = path.Join(urlPath, "temp", baseName)
	}
	ret.Data = map[string]any{
		"url": util.ServerURL.Scheme + "://" + util.LocalHost + ":" + util.ServerPort + urlPath,
	}
}

func exportBrowserHTML(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var folder, htmlContent, name string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("folder", &folder, true, true),
		util.BindJsonArg("html", &htmlContent, true, true),
		util.BindJsonArg("name", &name, true, true),
	) {
		return
	}

	tmpDir := filepath.Join(util.TempDir, "export", folder)

	htmlPath := filepath.Join(tmpDir, "index.html")
	if err := filelock.WriteFile(htmlPath, []byte(htmlContent)); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = nil
		return
	}

	// 检测是否来自加密笔记本：folder 形如 <boxID>/<folderName>
	boxID := ""
	if parts := strings.SplitN(folder, "/", 2); len(parts) >= 1 && ast.IsNodeIDPattern(parts[0]) && model.IsEncryptedBox(parts[0]) {
		boxID = parts[0]
	}

	zipFileName := util.FilterFileName(name) + ".zip"
	var zipAbsPath string
	if boxID != "" {
		// 加密笔记本的导出 ZIP 写入 boxID 子目录，并注册托管 token
		zipAbsPath = filepath.Join(util.TempDir, "export", boxID, "html", gulu.Rand.String(7)+"-"+zipFileName)
		if err := os.MkdirAll(filepath.Dir(zipAbsPath), 0755); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	} else {
		zipAbsPath = filepath.Join(util.TempDir, "export", zipFileName)
	}

	zip, err := gulu.Zip.Create(zipAbsPath)
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

	var zipURL string
	if boxID != "" {
		zipURL = "/export/" + model.RegisterManagedEncryptedExport(boxID, "html", zipAbsPath)
	} else {
		zipURL = "/export/" + url.PathEscape(filepath.Base(zipAbsPath))
	}
	ret.Data = map[string]any{
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

	var id string
	var keepFold, merge, image bool
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("id", &id, true, true),
		util.BindJsonArg("keepFold", &keepFold, false, false),
		util.BindJsonArg("merge", &merge, false, false),
		util.BindJsonArg("image", &image, false, false),
	) {
		return
	}
	name, content, node := model.ExportHTML(id, "", true, keepFold, merge)
	// 导出 PDF 预览时点击块引转换后的脚注跳转不正确 https://github.com/siyuan-note/siyuan/issues/5894
	content = strings.ReplaceAll(content, "http://"+util.LocalHost+":"+util.ServerPort+"/#", "#")

	// Add `data-doc-type` and attribute when exporting image and PDF https://github.com/siyuan-note/siyuan/issues/9497
	attrs := map[string]string{}
	var typ string
	if nil != node {
		attrs = parse.IAL2Map(node.KramdownIAL)
		typ = node.Type.String()
	}

	ret.Data = map[string]any{
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

	var id, savePath string
	var pdf, keepFold, merge bool
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("id", &id, true, true),
		util.BindJsonArg("pdf", &pdf, true, false),
		util.BindJsonArg("savePath", &savePath, false, false),
		util.BindJsonArg("keepFold", &keepFold, false, false),
		util.BindJsonArg("merge", &merge, false, false),
	) {
		return
	}

	savePath = strings.TrimSpace(savePath)
	if savePath == "" {
		folderName := "html-" + id + "-" + util.CurrentTimeSecondsStr()
		// 加密笔记本的导出临时目录归入 boxID 子目录，确保 LockBox 能清理和服务端可校验锁定状态
		if bt := treenode.GetBlockTree(id); bt != nil && model.IsEncryptedBox(bt.BoxID) {
			folderName = bt.BoxID + "/" + folderName
		}
		tmpDir := filepath.Join(util.TempDir, "export", folderName)
		name, content, _ := model.ExportHTML(id, tmpDir, pdf, keepFold, merge)
		ret.Data = map[string]any{
			"id":      id,
			"name":    name,
			"content": content,
			"folder":  folderName,
		}
		return
	}

	// savePath 由客户端指定，禁止写入加密笔记本目录（明文导出物会绕过加密、锁定后残留）
	if rejectEncryptedBoxPath(savePath) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(313)
		return
	}

	name, content, _ := model.ExportHTML(id, savePath, pdf, keepFold, merge)
	ret.Data = map[string]any{
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

	var id, pdfPath string
	var merge bool
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("id", &id, true, true),
		util.BindJsonArg("path", &pdfPath, true, true),
		util.BindJsonArg("merge", &merge, false, false),
	) {
		return
	}
	removeAssets := arg["removeAssets"].(bool)
	watermark := arg["watermark"].(bool)
	err := model.ProcessPDF(id, pdfPath, merge, removeAssets, watermark)
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

	var id string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("id", &id, true, true)) {
		return
	}

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
	if model.IsReadOnlyRoleContext(c) {
		bt := treenode.GetBlockTree(id)
		if bt != nil {
			publishAccess := model.GetPublishAccess()
			stdHTML = model.FilterContentByPublishAccess(c, publishAccess, bt.BoxID, bt.Path, stdHTML, true)
		}
	}
	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
		"file": path.Join("/export/", name),
	}
}

func copyExportFile(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var srcPath, dest string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("srcPath", &srcPath, true, true),
		util.BindJsonArg("dest", &dest, true, true),
	) {
		return
	}

	if !filepath.IsAbs(dest) {
		ret.Code = -1
		ret.Msg = "dest must be an absolute path"
		return
	}

	srcPath = filepath.Clean(srcPath)
	if decoded, err := url.PathUnescape(srcPath); err == nil {
		srcPath = decoded
	}
	srcFullPath := filepath.Join(util.TempDir, srcPath)
	srcFullPath = filepath.Clean(srcFullPath)

	exportBaseDir := filepath.Join(util.TempDir, "export")
	if !gulu.File.IsSubPath(exportBaseDir, srcFullPath) && srcFullPath != exportBaseDir {
		ret.Code = -1
		ret.Msg = "invalid source path"
		return
	}

	// 加密导出受控路径（<boxID>/<kind>/<file>）：按注册表无条件校验，不依赖 IsEncryptedBox。
	// 笔记本删除后 IsEncryptedBox 返回 false，若以它为门控会 fail-open 暴露明文产物。
	// relativePath 去掉 "/export/" 前缀以与 serveExport 的守卫及托管注册 key（<boxID>/kind/<name>）对齐。
	relativeExportPath := strings.TrimPrefix(srcPath, "/export/")
	relativeExportPath = strings.TrimPrefix(relativeExportPath, "export/")
	if model.IsManagedEncryptedExportPath(relativeExportPath) {
		boxID, _, ok := model.ResolveManagedEncryptedExport(relativeExportPath)
		if !ok {
			ret.Code = -1
			ret.Msg = "export file is not available"
			return
		}
		model.HoldBoxReadLock(boxID)
		if _, dekErr := model.GetDEKIfUnlocked(boxID); dekErr != nil {
			model.ReleaseBoxReadLock(boxID)
			ret.Code = -1
			ret.Msg = "encrypted notebook locked"
			return
		}
		defer model.ReleaseBoxReadLock(boxID)
	}

	if util.IsSensitivePath(dest) {
		ret.Code = -2
		ret.Msg = "refuse to copy to sensitive path: " + dest
		return
	}

	if err := filelock.Copy(srcFullPath, dest); err != nil {
		logging.LogErrorf("copy export file [%s] to [%s] failed: %s", srcFullPath, dest, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
