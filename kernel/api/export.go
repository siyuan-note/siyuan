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
	"fmt"
	"io"
	"mime"
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
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var exportCodeBlock = contractHandler(apicontract.ExportCodeBlock, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportPathData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportPathData](ret)
	}
	filePath, err := model.ExportCodeBlock(id)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.ExportPathData](ret.Code, ret.Msg, 7000)
	}

	return apicontract.Success(apicontract.ExportPathData{Path: filePath})
})

var exportAttributeView = contractHandler(apicontract.ExportAttributeView, func(c *gin.Context, request apicontract.ExportAttributeViewRequest) apicontract.Response[apicontract.ExportZipData] {
	ret := gulu.Ret.NewResult()

	avID := request.ID
	blockID := request.BlockID
	if !holdEncryptedExportRequest(c, blockID, ret) {
		return contractFailure[apicontract.ExportZipData](ret)
	}
	zipPath, err := model.ExportAv2CSV(avID, blockID)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.ExportZipData](ret.Code, ret.Msg, 7000)
	}

	return apicontract.Success(apicontract.ExportZipData{Zip: zipPath})
})

var exportEPUB = contractHandler(apicontract.ExportEPUB, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "epub", ".epub")
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var exportRTF = contractHandler(apicontract.ExportRTF, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "rtf", ".rtf")
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var exportODT = contractHandler(apicontract.ExportODT, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "odt", ".odt")
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var exportMediaWiki = contractHandler(apicontract.ExportMediaWiki, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "mediawiki", ".wiki")
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var exportOrgMode = contractHandler(apicontract.ExportOrgMode, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "org", ".org")
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var exportOPML = contractHandler(apicontract.ExportOPML, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "opml", ".opml")
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var exportTextile = contractHandler(apicontract.ExportTextile, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "textile", ".textile")
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var exportAsciiDoc = contractHandler(apicontract.ExportAsciiDoc, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "asciidoc", ".adoc")
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var exportReStructuredText = contractHandler(apicontract.ExportReStructuredText, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZip([]string{id}, "rst", ".rst")
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var export2Liandi = contractHandler(apicontract.Export2Liandi, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	err := model.Export2Liandi(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return apicontract.Success(apicontract.Null{})
})

var exportDataInFolder = contractHandler(apicontract.ExportDataInFolder, func(c *gin.Context, request apicontract.ExportFolderRequest) apicontract.Response[apicontract.ExportNameData] {
	ret := gulu.Ret.NewResult()

	exportFolder := request.Folder
	name, err := model.ExportDataInFolder(exportFolder)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.ExportNameData](ret.Code, ret.Msg, 7000)
	}
	return apicontract.Success(apicontract.ExportNameData{Name: name})
})

var exportData = contractHandler(apicontract.ExportData, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.ExportZipData] {
	ret := gulu.Ret.NewResult()

	zipPath, err := model.ExportData()
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.ExportZipData](ret.Code, ret.Msg, 7000)
	}
	return apicontract.Success(apicontract.ExportZipData{Zip: zipPath})
})

var exportResources = contractHandler(apicontract.ExportResources, func(c *gin.Context, request apicontract.ExportResourcesRequest) apicontract.Response[apicontract.ExportPathData] {
	ret := gulu.Ret.NewResult()

	var name string
	if request.Name != nil {
		name = util.TruncateLenFileName(*request.Name)
	}
	if name == "" {
		name = time.Now().Format("export-2006-01-02_15-04-05") // 生成的 *.zip 文件主文件名
	}

	if request.Paths == nil {
		ret.Code = 1
		return apicontract.FailureWithText[apicontract.ExportPathData](1, "[paths] is required", "")
	}

	resourcePaths := exportStrings(*request.Paths)

	zipFilePath, err := model.ExportResources(resourcePaths, name)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.ExportPathData](ret.Code, ret.Msg, 7000)
	}
	return apicontract.Success(apicontract.ExportPathData{Path: zipFilePath})
})

var exportNotebookMd = contractHandler(apicontract.ExportNotebookMd, func(c *gin.Context, request apicontract.ExportNotebookMarkdownRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	notebook := request.Notebook
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	if err := request.Validate(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	zipPath := model.ExportNotebookMarkdownWithOptions(notebook, exportMarkdownOptions(request.ExportMarkdownOptions))
	return apicontract.Success(apicontract.ExportNamedZipData{Name: path.Base(zipPath), Zip: zipPath})
})

var exportNotebooksMd = contractHandler(apicontract.ExportNotebooksMd, func(c *gin.Context, request apicontract.ExportNotebooksMarkdownRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	notebooks := request.IDs()
	if len(notebooks) < 1 {
		ret.Code = -1
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	for _, notebook := range notebooks {
		if model.IsEncryptedBox(notebook) {
			ret.Code = -1
			ret.Msg = model.Conf.Language(395)
			return contractFailure[apicontract.ExportNamedZipData](ret)
		}
	}
	if err := request.Validate(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	zipPath := model.ExportNotebooksMarkdownWithOptions(notebooks, exportMarkdownOptions(request.ExportMarkdownOptions))
	return apicontract.Success(apicontract.ExportNamedZipData{Name: path.Base(zipPath), Zip: zipPath})
})

var exportMds = contractHandler(apicontract.ExportMds, func(c *gin.Context, request apicontract.ExportDocumentsMarkdownRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	ids := exportStrings(request.IDs)
	if !holdEncryptedExportRequests(c, ids, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}

	if err := request.Validate(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZipWithOptions(ids, "", ".md", exportMarkdownOptions(request.ExportMarkdownOptions))
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var exportMd = contractHandler(apicontract.ExportMd, func(c *gin.Context, request apicontract.ExportMarkdownRequest) apicontract.Response[apicontract.ExportNamedZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	if err := request.Validate(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportNamedZipData](ret)
	}
	name, zipPath := model.ExportPandocConvertZipWithOptions([]string{id}, "", ".md", exportMarkdownOptions(request.ExportMarkdownOptions))
	return apicontract.Success(apicontract.ExportNamedZipData{Name: name, Zip: zipPath})
})

var exportNotebookSY = contractHandler(apicontract.ExportNotebookSY, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if err := holdEncryptedBoxRequest(c, id); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return contractFailure[apicontract.ExportZipData](ret)
	}
	zipPath := model.ExportNotebookSY(id)
	return apicontract.Success(apicontract.ExportZipData{Zip: zipPath})
})

var exportNotebooksSY = contractHandler(apicontract.ExportNotebooksSY, func(c *gin.Context, request apicontract.ExportNotebooksRequest) apicontract.Response[apicontract.ExportZipData] {
	ret := gulu.Ret.NewResult()

	notebooks := request.IDs()
	if len(notebooks) < 1 {
		ret.Code = -1
		return contractFailure[apicontract.ExportZipData](ret)
	}
	for _, notebook := range notebooks {
		if model.IsEncryptedBox(notebook) {
			ret.Code = -1
			ret.Msg = model.Conf.Language(395)
			return contractFailure[apicontract.ExportZipData](ret)
		}
	}
	zipPath := model.ExportNotebooksSY(notebooks)
	return apicontract.Success(apicontract.ExportZipData{Zip: zipPath})
})

var exportSYs = contractHandler(apicontract.ExportSYs, func(c *gin.Context, request apicontract.ExportIDsRequest) apicontract.Response[apicontract.ExportZipData] {
	ret := gulu.Ret.NewResult()

	ids := exportStrings(request.IDs)
	if !holdEncryptedExportRequests(c, ids, ret) {
		return contractFailure[apicontract.ExportZipData](ret)
	}

	zipPath := model.ExportSYs(ids)
	return apicontract.Success(apicontract.ExportZipData{Zip: zipPath})
})

var exportSY = contractHandler(apicontract.ExportSY, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportZipData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportZipData](ret)
	}
	zipPath := model.ExportSYs([]string{id})
	return apicontract.Success(apicontract.ExportZipData{Zip: zipPath})
})

var exportMdContent = contractHandler(apicontract.ExportMdContent, func(c *gin.Context, request apicontract.ExportMarkdownContentRequest) apicontract.Response[apicontract.ExportMarkdownContentData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.ExportMarkdownContentData](ret)
	}
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportMarkdownContentData](ret)
	}

	if err := request.Validate(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportMarkdownContentData](ret)
	}
	refMode, embedMode, yfm := model.Conf.Export.BlockRefMode, model.Conf.Export.BlockEmbedMode, true
	if request.RefMode != nil {
		refMode = int(*request.RefMode)
	}
	if request.EmbedMode != nil {
		embedMode = int(*request.EmbedMode)
	}
	if request.YFM != nil {
		yfm = *request.YFM
	}
	fillCSSVar, adjustHeadingLevel, imgTag := request.FillCSSVar, request.AdjustHeadingLevel, request.ImgTag
	addTitle := model.Conf.Export.AddTitle
	if request.AddTitle != nil {
		addTitle = *request.AddTitle
	}

	hPath, content := model.ExportMarkdownContent(id, refMode, embedMode, yfm, fillCSSVar, adjustHeadingLevel, imgTag, addTitle)
	return apicontract.Success(apicontract.ExportMarkdownContentData{HPath: hPath, Content: content})
})

var exportDocx = contractHandler(apicontract.ExportDocx, func(c *gin.Context, request apicontract.ExportDocxRequest) apicontract.Response[apicontract.ExportPathData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	savePath := request.SavePath
	removeAssets := request.RemoveAssets
	merge := request.Merge
	mergeDocHeadingMode := request.MergeDocHeadingMode
	mergeContentHeadingMode := request.MergeContentHeadingMode
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportPathData](ret)
	}

	// savePath 由客户端指定，禁止写入加密笔记本目录（明文导出物会绕过加密、锁定后残留）
	if rejectEncryptedBoxPath(savePath) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(383)
		return contractFailure[apicontract.ExportPathData](ret)
	}

	mergeHeadingOptions := model.MergeHeadingOptions{DocHeadingMode: mergeDocHeadingMode, ContentHeadingMode: mergeContentHeadingMode}
	fullPath, err := model.ExportDocx(id, savePath, removeAssets, merge, mergeHeadingOptions)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.ExportPathData](ret.Code, ret.Msg, 7000)
	}
	return apicontract.Success(apicontract.ExportPathData{Path: fullPath})
})

var exportMdHTML = contractHandler(apicontract.ExportMdHTML, func(c *gin.Context, request apicontract.ExportMarkdownHTMLRequest) apicontract.Response[apicontract.ExportHTMLData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	savePath := request.SavePath
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportHTMLData](ret)
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
		return apicontract.Success(apicontract.ExportHTMLData{ID: id, Name: name, Content: content, Folder: folderName})
	}

	// savePath 由客户端指定，禁止写入加密笔记本目录（明文导出物会绕过加密、锁定后残留）
	if rejectEncryptedBoxPath(savePath) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(383)
		return contractFailure[apicontract.ExportHTMLData](ret)
	}

	name, content := model.ExportMarkdownHTML(id, savePath, false, false)
	return apicontract.Success(apicontract.ExportHTMLData{ID: id, Name: name, Content: content})
})

var exportTempContent = contractHandler(apicontract.ExportTempContent, func(c *gin.Context, request apicontract.ExportTempContentRequest) apicontract.Response[apicontract.ExportURLData] {
	ret := gulu.Ret.NewResult()

	content := request.Content
	id := request.ID
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportURLData](ret)
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
		return apicontract.FailureWithTimeout[apicontract.ExportURLData](ret.Code, ret.Msg, 7000)
	}
	p := filepath.Join(tmpExport, gulu.Rand.String(7))
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.ExportURLData](ret.Code, ret.Msg, 7000)
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
	return apicontract.Success(apicontract.ExportURLData{URL: util.ServerURL.Scheme + "://" + util.LocalHost + ":" + util.ServerPort + urlPath})
})

var exportBrowserHTML = contractHandler(apicontract.ExportBrowserHTML, func(c *gin.Context, request apicontract.ExportBrowserHTMLRequest) apicontract.Response[apicontract.ExportZipData] {
	ret := gulu.Ret.NewResult()

	folder := request.Folder
	htmlContent := request.HTML
	name := request.Name

	// folder 由客户端指定，禁止包含 ..、绝对路径等穿越组件，防止在导出目录之外写入 index.html
	exportDir := filepath.Join(util.TempDir, "export")
	tmpDir := filepath.Join(exportDir, folder)
	if !gulu.File.IsSubPath(exportDir, tmpDir) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(383)
		return contractFailure[apicontract.ExportZipData](ret)
	}

	// 检测是否来自加密笔记本：folder 形如 <boxID>/<folderName>
	boxID := ""
	if parts := strings.SplitN(folder, "/", 2); len(parts) >= 1 && ast.IsNodeIDPattern(parts[0]) && model.IsEncryptedBox(parts[0]) {
		boxID = parts[0]
	}
	if boxID != "" {
		if err := holdEncryptedBoxRequest(c, boxID); err != nil {
			ret.Code = -1
			ret.Msg = model.Conf.Language(314)
			return contractFailure[apicontract.ExportZipData](ret)
		}
	}

	htmlPath := filepath.Join(tmpDir, "index.html")
	if err := filelock.WriteFile(htmlPath, []byte(htmlContent)); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportZipData](ret)
	}

	zipFileName := util.FilterFileName(name) + ".zip"
	var zipAbsPath string
	if boxID != "" {
		// 加密笔记本的导出 ZIP 写入 boxID 子目录，并注册托管 token
		zipAbsPath = filepath.Join(util.TempDir, "export", boxID, "html", gulu.Rand.String(7)+"-"+zipFileName)
		if err := os.MkdirAll(filepath.Dir(zipAbsPath), 0755); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.ExportZipData](ret)
		}
	} else {
		zipAbsPath = filepath.Join(util.TempDir, "export", zipFileName)
	}

	zip, err := gulu.Zip.Create(zipAbsPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportZipData](ret)
	}

	err = zip.AddDirectory("", tmpDir, func(string) {})
	if err != nil {
		_ = zip.Close()
		_ = os.Remove(zipAbsPath)
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportZipData](ret)
	}

	if err = zip.Close(); err != nil {
		_ = os.Remove(zipAbsPath)
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportZipData](ret)
	}

	os.RemoveAll(tmpDir)

	var zipURL string
	if boxID != "" {
		zipURL = "/export/" + model.RegisterManagedEncryptedExport(boxID, "html", zipAbsPath)
	} else {
		zipURL = "/export/" + url.PathEscape(filepath.Base(zipAbsPath))
	}
	return apicontract.Success(apicontract.ExportZipData{Zip: zipURL})
})

var exportPreviewHTML = contractHandler(apicontract.ExportPreviewHTML, func(c *gin.Context, request apicontract.ExportPreviewHTMLRequest) apicontract.Response[apicontract.ExportPreviewHTMLData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	keepFold := request.KeepFold
	merge := request.Merge
	mergeDocHeadingMode := request.MergeDocHeadingMode
	mergeContentHeadingMode := request.MergeContentHeadingMode
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportPreviewHTMLData](ret)
	}
	addTitle, customTitle := exportTitleOptions(request.ExportTitleOptions)
	mergeHeadingOptions := model.MergeHeadingOptions{DocHeadingMode: mergeDocHeadingMode, ContentHeadingMode: mergeContentHeadingMode}
	name, content, node := model.ExportHTMLWithTitle(id, "", true, keepFold, merge, addTitle, customTitle, mergeHeadingOptions)
	// 导出 PDF 预览时点击块引转换后的脚注跳转不正确 https://github.com/siyuan-note/siyuan/issues/5894
	content = strings.ReplaceAll(content, "http://"+util.LocalHost+":"+util.ServerPort+"/#", "#")

	// Add `data-doc-type` and attribute when exporting image and PDF https://github.com/siyuan-note/siyuan/issues/9497
	attrs := map[string]string{}
	var typ string
	if nil != node {
		attrs = parse.IAL2Map(node.KramdownIAL)
		typ = node.Type.String()
	}

	return apicontract.Success(apicontract.ExportPreviewHTMLData{ID: id, Name: name, Content: content, Attrs: attrs, Type: typ})
})

var exportHTML = contractHandler(apicontract.ExportHTML, func(c *gin.Context, request apicontract.ExportHTMLRequest) apicontract.Response[apicontract.ExportHTMLData] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	pdf := request.PDF
	savePath := request.SavePath
	keepFold := request.KeepFold
	merge := request.Merge
	mergeDocHeadingMode := request.MergeDocHeadingMode
	mergeContentHeadingMode := request.MergeContentHeadingMode
	if !holdEncryptedExportRequest(c, id, ret) {
		return contractFailure[apicontract.ExportHTMLData](ret)
	}

	addTitle, customTitle := exportTitleOptions(request.ExportTitleOptions)
	mergeHeadingOptions := model.MergeHeadingOptions{DocHeadingMode: mergeDocHeadingMode, ContentHeadingMode: mergeContentHeadingMode}
	savePath = strings.TrimSpace(savePath)
	if savePath == "" {
		folderName := "html-" + id + "-" + util.CurrentTimeSecondsStr()
		// 加密笔记本的导出临时目录归入 boxID 子目录，确保 LockBox 能清理和服务端可校验锁定状态
		if bt := treenode.GetBlockTree(id); bt != nil && model.IsEncryptedBox(bt.BoxID) {
			folderName = bt.BoxID + "/" + folderName
		}
		tmpDir := filepath.Join(util.TempDir, "export", folderName)
		name, content, _ := model.ExportHTMLWithTitle(id, tmpDir, pdf, keepFold, merge, addTitle, customTitle, mergeHeadingOptions)
		return apicontract.Success(apicontract.ExportHTMLData{ID: id, Name: name, Content: content, Folder: folderName})
	}

	// savePath 由客户端指定，禁止写入加密笔记本目录（明文导出物会绕过加密、锁定后残留）
	if rejectEncryptedBoxPath(savePath) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(383)
		return contractFailure[apicontract.ExportHTMLData](ret)
	}

	name, content, _ := model.ExportHTMLWithTitle(id, savePath, pdf, keepFold, merge, addTitle, customTitle, mergeHeadingOptions)
	return apicontract.Success(apicontract.ExportHTMLData{ID: id, Name: name, Content: content})
})

func exportTitleOptions(options apicontract.ExportTitleOptions) (addTitle bool, customTitle string) {
	addTitle = model.Conf.Export.AddTitle
	if options.AddTitle != nil {
		addTitle = *options.AddTitle
	}
	return addTitle, strings.TrimSpace(options.CustomTitle)
}

func exportStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	return values
}

func exportMarkdownOptions(options apicontract.ExportMarkdownOptions) *model.ExportOptions {
	integer := func(value *float64) *int {
		if value == nil {
			return nil
		}
		result := int(*value)
		return &result
	}
	return &model.ExportOptions{AddTitle: options.AddTitle, InlineMemo: options.InlineMemo,
		BlockRefMode: integer(options.BlockRefMode), BlockEmbedMode: integer(options.BlockEmbedMode),
		FileAnnotationRefMode: integer(options.FileAnnotationRefMode), BlockRefTextLeft: options.BlockRefTextLeft,
		BlockRefTextRight: options.BlockRefTextRight, TagOpenMarker: options.TagOpenMarker, TagCloseMarker: options.TagCloseMarker,
		IncludeSubDocs: options.IncludeSubDocs, IncludeRelatedDocs: options.IncludeRelatedDocs,
		MarkdownYFM: options.MarkdownYFM, RemoveAssetsID: options.RemoveAssetsID}
}

func holdEncryptedExportRequest(c *gin.Context, id string, ret *gulu.Result) bool {
	block := treenode.GetBlockTree(id)
	if block == nil || !model.IsEncryptedBox(block.BoxID) {
		return true
	}
	if err := holdEncryptedBoxRequest(c, block.BoxID); err != nil {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		return false
	}
	return true
}

func holdEncryptedExportRequests(c *gin.Context, ids []string, ret *gulu.Result) bool {
	for _, id := range ids {
		if !holdEncryptedExportRequest(c, id, ret) {
			return false
		}
	}
	return true
}

var processPDF = contractHandler(apicontract.ProcessPDF, func(c *gin.Context, request apicontract.ProcessPDFRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	pdfPath := request.Path
	merge := request.Merge
	mergeDocHeadingMode := request.MergeDocHeadingMode
	mergeContentHeadingMode := request.MergeContentHeadingMode
	removeAssets := request.RemoveAssets
	watermark := request.Watermark
	mergeHeadingOptions := model.MergeHeadingOptions{DocHeadingMode: mergeDocHeadingMode, ContentHeadingMode: mergeContentHeadingMode}
	err := model.ProcessPDF(id, pdfPath, merge, removeAssets, watermark, mergeHeadingOptions)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return apicontract.Success(apicontract.Null{})
})

var exportPreview = contractHandler(apicontract.ExportPreview, func(c *gin.Context, request apicontract.ExportIDRequest) apicontract.Response[apicontract.ExportPreviewData] {
	id := request.ID

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

	isReadOnlyRole := model.IsReadOnlyRoleContext(c)
	avPublishFilter := model.NewAVExportPublishFilter(c)
	var publishAccess model.PublishAccess
	var accessChecker model.EmbedBlockAccessChecker
	if isReadOnlyRole {
		publishAccess = model.GetPublishAccess()
		accessChecker = func(blockID string) bool {
			return model.CheckBlockIdAccessableByPublishAccess(c, publishAccess, blockID)
		}
	}
	stdHTML := model.ExportPreview(id, fillCSSVar, avPublishFilter, accessChecker)
	if isReadOnlyRole {
		bt := treenode.GetBlockTree(id)
		if bt != nil {
			stdHTML = model.FilterContentByPublishAccess(c, publishAccess, bt.BoxID, bt.Path, stdHTML, true)
		}
	}
	return apicontract.Success(apicontract.ExportPreviewData{HTML: stdHTML, FillCSSVar: fillCSSVar})
})

var exportAsFile = contractHandler(apicontract.ExportAsFile, func(c *gin.Context, request apicontract.ExportAsFileRequest) apicontract.Response[apicontract.ExportFileData] {
	ret := gulu.Ret.NewResult()

	file := request.File

	reader, err := file.Open()
	if err != nil {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportFileData](ret)
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportFileData](ret)
	}

	name := "file-" + file.Filename
	typ := request.Type
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
		return contractFailure[apicontract.ExportFileData](ret)
	}

	tmp := filepath.Join(tmpDir, name)
	err = os.WriteFile(tmp, data, 0644)
	if err != nil {
		logging.LogErrorf("export as file failed: %s", err)
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.ExportFileData](ret)
	}

	return apicontract.Success(apicontract.ExportFileData{File: path.Join("/export/", name)})
})

var copyExportFile = contractHandler(apicontract.CopyExportFile, func(c *gin.Context, request apicontract.CopyExportFileRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	srcPath := request.SrcPath
	dest := request.Dest

	if !filepath.IsAbs(dest) {
		ret.Code = -1
		ret.Msg = "dest must be an absolute path"
		return contractFailure[apicontract.Null](ret)
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
		return contractFailure[apicontract.Null](ret)
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
			return contractFailure[apicontract.Null](ret)
		}
		if err := holdEncryptedBoxRequest(c, boxID); err != nil {
			ret.Code = -1
			ret.Msg = model.Conf.Language(314)
			return contractFailure[apicontract.Null](ret)
		}
		model.HoldBoxReadLock(boxID)
		if _, dekErr := model.GetDEKIfUnlocked(boxID); dekErr != nil {
			model.ReleaseBoxReadLock(boxID)
			ret.Code = -1
			ret.Msg = model.Conf.Language(314)
			return contractFailure[apicontract.Null](ret)
		}
		defer model.ReleaseBoxReadLock(boxID)
	}

	if util.IsSensitivePath(dest) {
		ret.Code = -2
		ret.Msg = "refuse to copy to sensitive path: " + dest
		return contractFailure[apicontract.Null](ret)
	}

	if err := copyExportFileToDestination(srcFullPath, dest); err != nil {
		logging.LogErrorf("copy export file [%s] to [%s] failed: %s", srcFullPath, dest, err)
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return apicontract.Success(apicontract.Null{})
})

func copyExportFileToDestination(src, dest string) (err error) {
	filelock.Lock(src)
	defer filelock.Unlock(src)

	srcInfo, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if !srcInfo.Mode().IsRegular() {
		return fmt.Errorf("export source [%s] is not a regular file", src)
	}

	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	destDir := filepath.Dir(dest)
	if err = os.MkdirAll(destDir, 0755); err != nil {
		return err
	}
	tmpFile, err := os.CreateTemp(destDir, ".siyuan-export-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	tmpClosed := false
	defer func() {
		if !tmpClosed {
			_ = tmpFile.Close()
		}
		if removeErr := os.Remove(tmpPath); removeErr != nil && !os.IsNotExist(removeErr) {
			logging.LogWarnf("remove temporary export file [%s] failed: %s", tmpPath, removeErr)
		}
	}()

	if _, err = io.Copy(tmpFile, srcFile); err != nil {
		return err
	}
	if err = tmpFile.Chmod(srcInfo.Mode().Perm()); err != nil {
		return err
	}
	if err = tmpFile.Sync(); err != nil {
		return err
	}
	if err = tmpFile.Close(); err != nil {
		return err
	}
	tmpClosed = true

	return os.Rename(tmpPath, dest)
}
