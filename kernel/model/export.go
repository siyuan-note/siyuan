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

package model

import (
	"bytes"
	"crypto/sha1"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/lex"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/emirpasic/gods/stacks/linkedliststack"
	"github.com/imroc/req/v3"
	shellquote "github.com/kballard/go-shellquote"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/font"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func ExportCodeBlock(blockID string) (filePath string, err error) {
	// Supports exporting a code block as a file https://github.com/siyuan-note/siyuan/pull/16774

	tree, _ := LoadTreeByBlockID(blockID)
	if nil == tree {
		err = ErrBlockNotFound
		return
	}

	node := treenode.GetNodeInTree(tree, blockID)
	if nil == node {
		err = ErrBlockNotFound
		return
	}

	if ast.NodeCodeBlock != node.Type {
		err = errors.New("not a code block")
		return
	}

	code := node.ChildByType(ast.NodeCodeBlockCode)
	if nil == code {
		err = errors.New("code block has no code node")
		return
	}

	name := tree.Root.IALAttr("title") + "-" + util.CurrentTimeSecondsStr() + ".txt"
	name = util.FilterFileName(name)
	exportFolder := filepath.Join(util.TempDir, "export", "code")
	if err = os.MkdirAll(exportFolder, 0755); err != nil {
		logging.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	code.Tokens = bytes.ReplaceAll(code.Tokens, []byte(editor.Zwj+"```"), []byte("```"))

	writePath := filepath.Join(exportFolder, name)
	err = filelock.WriteFile(writePath, code.Tokens)
	if nil != err {
		return
	}

	filePath = "/export/code/" + url.PathEscape(name)
	return
}

func ExportAv2CSV(avID, blockID string) (zipPath string, err error) {
	// Database block supports export as CSV https://github.com/siyuan-note/siyuan/issues/10072

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	node, _, err := getNodeByBlockID(nil, blockID)
	if nil == node {
		return
	}
	viewID := node.IALAttr(av.NodeAttrView)
	view, err := attrView.GetCurrentView(viewID)
	if err != nil {
		return
	}

	name := util.FilterFileName(getAttrViewName(attrView))
	table := getAttrViewTable(attrView, view, "")

	// 遵循视图过滤和排序规则 Use filtering and sorting of current view settings when exporting database blocks https://github.com/siyuan-note/siyuan/issues/10474
	cachedAttrViews := map[string]*av.AttributeView{}
	rollupFurtherCollections := sql.GetFurtherCollections(attrView, cachedAttrViews)
	av.Filter(table, attrView, rollupFurtherCollections, cachedAttrViews)
	av.Sort(table, attrView)

	exportFolder := filepath.Join(util.TempDir, "export", "csv", name)
	if err = os.MkdirAll(exportFolder, 0755); err != nil {
		logging.LogErrorf("mkdir [%s] failed: %s", exportFolder, err)
		return
	}
	csvPath := filepath.Join(exportFolder, name+".csv")

	f, err := os.OpenFile(csvPath, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		logging.LogErrorf("open [%s] failed: %s", csvPath, err)
		return
	}

	if _, err = f.WriteString("\xEF\xBB\xBF"); err != nil { // 写入 UTF-8 BOM，避免使用 Microsoft Excel 打开乱码
		logging.LogErrorf("write UTF-8 BOM to [%s] failed: %s", csvPath, err)
		f.Close()
		return
	}

	writer := csv.NewWriter(f)
	var header []string
	for _, col := range table.Columns {
		header = append(header, col.Name)
	}
	if err = writer.Write(header); err != nil {
		logging.LogErrorf("write csv header [%s] failed: %s", header, err)
		f.Close()
		return
	}

	var assets []string
	rowNum := 1
	for _, row := range table.Rows {
		var rowVal []string
		for _, cell := range row.Cells {
			var val string
			if nil != cell.Value {
				if av.KeyTypeDate == cell.Value.Type {
					if nil != cell.Value.Date {
						cell.Value.Date = av.NewFormattedValueDate(cell.Value.Date.Content, cell.Value.Date.Content2, av.DateFormatNone, cell.Value.Date.IsNotTime, cell.Value.Date.HasEndDate)
					}
				} else if av.KeyTypeCreated == cell.Value.Type {
					if nil != cell.Value.Created {
						key, _ := attrView.GetKey(cell.Value.KeyID)
						isNotTime := false
						if nil != key && nil != key.Created {
							isNotTime = !key.Created.IncludeTime
						}

						cell.Value.Created = av.NewFormattedValueCreated(cell.Value.Created.Content, 0, av.CreatedFormatNone, isNotTime)
					}
				} else if av.KeyTypeUpdated == cell.Value.Type {
					if nil != cell.Value.Updated {
						key, _ := attrView.GetKey(cell.Value.KeyID)
						isNotTime := false
						if nil != key && nil != key.Updated {
							isNotTime = !key.Updated.IncludeTime
						}

						cell.Value.Updated = av.NewFormattedValueUpdated(cell.Value.Updated.Content, 0, av.UpdatedFormatNone, isNotTime)
					}
				} else if av.KeyTypeMAsset == cell.Value.Type {
					if nil != cell.Value.MAsset {
						buf := &bytes.Buffer{}
						for _, a := range cell.Value.MAsset {
							if av.AssetTypeImage == a.Type {
								buf.WriteString("![")
								buf.WriteString(a.Name)
								buf.WriteString("](")
								buf.WriteString(a.Content)
								buf.WriteString(") ")
								if util.IsAssetLinkDest([]byte(a.Content), true) {
									assets = append(assets, a.Content)
								}
							} else if av.AssetTypeFile == a.Type {
								buf.WriteString("[")
								buf.WriteString(a.Name)
								buf.WriteString("](")
								buf.WriteString(a.Content)
								buf.WriteString(") ")
								if util.IsAssetLinkDest([]byte(a.Content), true) {
									assets = append(assets, a.Content)
								}
							} else {
								buf.WriteString(a.Content)
								buf.WriteString(" ")
							}
						}
						val = strings.TrimSpace(buf.String())
					}
				} else if av.KeyTypeLineNumber == cell.Value.Type {
					val = strconv.Itoa(rowNum)
				} else if av.KeyTypeRollup == cell.Value.Type {
					for _, content := range cell.Value.Rollup.Contents {
						if av.KeyTypeMAsset == content.Type {
							buf := &bytes.Buffer{}
							for _, a := range content.MAsset {
								if av.AssetTypeImage == a.Type {
									buf.WriteString("![")
									buf.WriteString(a.Name)
									buf.WriteString("](")
									buf.WriteString(a.Content)
									buf.WriteString(") ")
									if util.IsAssetLinkDest([]byte(a.Content), true) {
										assets = append(assets, a.Content)
									}
								} else if av.AssetTypeFile == a.Type {
									buf.WriteString("[")
									buf.WriteString(a.Name)
									buf.WriteString("](")
									buf.WriteString(a.Content)
									buf.WriteString(") ")
									if util.IsAssetLinkDest([]byte(a.Content), true) {
										assets = append(assets, a.Content)
									}
								} else {
									buf.WriteString(a.Content)
									buf.WriteString(" ")
								}
							}
							val = strings.TrimSpace(buf.String())
						}
					}
				}

				if "" == val {
					val = cell.Value.String(true)
				}
			}

			rowVal = append(rowVal, val)
		}
		if err = writer.Write(rowVal); err != nil {
			logging.LogErrorf("write csv row [%s] failed: %s", rowVal, err)
			f.Close()
			return
		}
		rowNum++
	}
	writer.Flush()

	for _, asset := range assets {
		srcAbsPath, getErr := GetAssetAbsPath(asset)
		if getErr != nil {
			logging.LogWarnf("resolve path of asset [%s] failed: %s", asset, getErr)
			continue
		}
		targetAbsPath := filepath.Join(exportFolder, asset)
		if copyErr := filelock.Copy(srcAbsPath, targetAbsPath); copyErr != nil {
			logging.LogWarnf("copy asset from [%s] to [%s] failed: %s", srcAbsPath, targetAbsPath, copyErr)
		}
	}

	zipPath = exportFolder + ".db.zip"
	zip, err := gulu.Zip.Create(zipPath)
	if err != nil {
		logging.LogErrorf("create export .db.zip [%s] failed: %s", exportFolder, err)
		f.Close()
		return
	}

	if err = zip.AddDirectory("", exportFolder); err != nil {
		logging.LogErrorf("create export .db.zip [%s] failed: %s", exportFolder, err)
		f.Close()
		return
	}

	if err = zip.Close(); err != nil {
		logging.LogErrorf("close export .db.zip failed: %s", err)
		f.Close()
		return
	}

	f.Close()
	removeErr := os.RemoveAll(exportFolder)
	if nil != removeErr {
		logging.LogErrorf("remove export folder [%s] failed: %s", exportFolder, removeErr)
	}
	zipPath = "/export/csv/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func Export2Liandi(id string) (err error) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		logging.LogErrorf("load tree by block id [%s] failed: %s", id, err)
		return
	}

	if IsUserGuide(tree.Box) {
		// Doc in the user guide no longer supports one-click sending to the community https://github.com/siyuan-note/siyuan/issues/8388
		return errors.New(Conf.Language(204))
	}

	assets := getAssetsLinkDests(tree.Root, false)
	embedAssets := getQueryEmbedNodesAssetsLinkDests(tree.Root)
	assets = append(assets, embedAssets...)
	assets = gulu.Str.RemoveDuplicatedElem(assets)
	_, err = uploadAssets2Cloud(assets, bizTypeExport2Liandi, false)
	if err != nil {
		return
	}

	msgId := util.PushMsg(Conf.Language(182), 15000)
	defer util.PushClearMsg(msgId)

	// 判断帖子是否已经存在，存在则使用更新接口
	const liandiArticleIdAttrName = "custom-liandi-articleid"
	const liandiArticleIdAttrNameOld = "custom-liandi-articleId" // 兼容旧属性名
	foundArticle := false
	// 优先使用新属性名，如果不存在则尝试旧属性名
	articleId := tree.Root.IALAttr(liandiArticleIdAttrName)
	if "" == articleId {
		articleId = tree.Root.IALAttr(liandiArticleIdAttrNameOld)
	}
	if "" != articleId {
		result := gulu.Ret.NewResult()
		request := httpclient.NewCloudRequest30s()
		resp, getErr := request.
			SetSuccessResult(result).
			SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
			Get(util.GetCloudAccountServer() + "/api/v2/article/update/" + articleId)
		if nil != getErr {
			logging.LogErrorf("get liandi article info failed: %s", getErr)
			return getErr
		}

		switch resp.StatusCode {
		case 200:
			if 0 == result.Code {
				foundArticle = true
			} else if 1 == result.Code {
				foundArticle = false
			}
		case 404:
			foundArticle = false
		default:
			err = errors.New(fmt.Sprintf("get liandi article info failed [sc=%d]", resp.StatusCode))
			return
		}
	}

	apiURL := util.GetCloudAccountServer() + "/api/v2/article"
	if foundArticle {
		apiURL += "/" + articleId
	}

	title := path.Base(tree.HPath)
	tags := tree.Root.IALAttr("tags")
	content := exportMarkdownContent0(id, tree, util.GetCloudForumAssetsServer()+time.Now().Format("2006/01")+"/siyuan/"+Conf.GetUser().UserId+"/",
		true, false, false,
		".md", 3, 1, 1,
		"#", "#",
		"", "",
		false, false, nil, true, false, map[string]*parse.Tree{})
	result := gulu.Ret.NewResult()
	request := httpclient.NewCloudRequest30s()
	request = request.
		SetSuccessResult(result).
		SetCookies(&http.Cookie{Name: "symphony", Value: Conf.GetUser().UserToken}).
		SetBody(map[string]interface{}{
			"articleTitle":   title,
			"articleTags":    tags,
			"articleContent": content})
	var resp *req.Response
	var sendErr error
	if foundArticle {
		resp, sendErr = request.Put(apiURL)
	} else {
		resp, sendErr = request.Post(apiURL)
	}
	if nil != sendErr {
		logging.LogErrorf("send article to liandi failed: %s", err)
		return err
	}
	if 200 != resp.StatusCode {
		msg := fmt.Sprintf("send article to liandi failed [sc=%d]", resp.StatusCode)
		logging.LogErrorf(msg)
		return errors.New(msg)
	}

	if 0 != result.Code {
		msg := fmt.Sprintf("send article to liandi failed [code=%d, msg=%s]", result.Code, result.Msg)
		logging.LogErrorf(msg)
		util.PushClearMsg(msgId)
		return errors.New(result.Msg)
	}

	if !foundArticle {
		articleId = result.Data.(string)
		tree, _ = LoadTreeByBlockID(id) // 这里必须重新加载，因为前面导出时已经修改了树结构
		tree.Root.SetIALAttr(liandiArticleIdAttrName, articleId)
		if err = writeTreeUpsertQueue(tree); err != nil {
			return
		}
	}

	util.PushMsg(fmt.Sprintf(Conf.Language(181), util.GetCloudAccountServer()+"/article/"+articleId), 7000)
	return
}

func ExportSystemLog() (zipPath string) {
	exportFolder := filepath.Join(util.TempDir, "export", "system-log")
	os.RemoveAll(exportFolder)
	if err := os.MkdirAll(exportFolder, 0755); err != nil {
		logging.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	appLog := filepath.Join(util.HomeDir, ".config", "siyuan", "app.log")
	if gulu.File.IsExist(appLog) {
		to := filepath.Join(exportFolder, "app.log")
		if err := filelock.Copy(appLog, to); err != nil {
			logging.LogErrorf("copy app log from [%s] to [%s] failed: %s", err, appLog, to)
		}
	}

	kernelLog := filepath.Join(util.HomeDir, ".config", "siyuan", "kernel.log")
	if gulu.File.IsExist(kernelLog) {
		to := filepath.Join(exportFolder, "kernel.log")
		if err := filelock.Copy(kernelLog, to); err != nil {
			logging.LogErrorf("copy kernel log from [%s] to [%s] failed: %s", err, kernelLog, to)
		}
	}

	siyuanLog := filepath.Join(util.TempDir, "siyuan.log")
	if gulu.File.IsExist(siyuanLog) {
		to := filepath.Join(exportFolder, "siyuan.log")
		if err := filelock.Copy(siyuanLog, to); err != nil {
			logging.LogErrorf("copy kernel log from [%s] to [%s] failed: %s", err, siyuanLog, to)
		}
	}

	mobileLog := filepath.Join(util.TempDir, "mobile.log")
	if gulu.File.IsExist(mobileLog) {
		to := filepath.Join(exportFolder, "mobile.log")
		if err := filelock.Copy(mobileLog, to); err != nil {
			logging.LogErrorf("copy mobile log from [%s] to [%s] failed: %s", err, mobileLog, to)
		}
	}

	zipPath = exportFolder + ".zip"
	zip, err := gulu.Zip.Create(zipPath)
	if err != nil {
		logging.LogErrorf("create export log zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	if err = zip.AddDirectory("log", exportFolder); err != nil {
		logging.LogErrorf("create export log zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	if err = zip.Close(); err != nil {
		logging.LogErrorf("close export log zip failed: %s", err)
	}

	os.RemoveAll(exportFolder)
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func ExportNotebookSY(id string) (zipPath string) {
	zipPath = exportBoxSYZip(id)
	return
}

func ExportSYs(ids []string) (zipPath string) {
	block := treenode.GetBlockTree(ids[0])
	box := Conf.Box(block.BoxID)
	baseFolderName := path.Base(block.HPath)
	if "." == baseFolderName {
		baseFolderName = path.Base(block.Path)
	}

	var docPaths []string
	bts := treenode.GetBlockTrees(ids)
	for _, bt := range bts {
		docPaths = append(docPaths, bt.Path)

		if Conf.Export.IncludeSubDocs {
			docFiles := box.ListFiles(strings.TrimSuffix(bt.Path, ".sy"))
			for _, docFile := range docFiles {
				docPaths = append(docPaths, docFile.path)
			}
		}
	}
	zipPath = exportSYZip(block.BoxID, path.Dir(block.Path), baseFolderName, docPaths)
	return
}

func ExportDataInFolder(exportFolder string) (name string, err error) {
	util.PushEndlessProgress(Conf.Language(65))
	defer util.ClearPushProgress(100)

	data := filepath.Join(util.WorkspaceDir, "data")
	if util.ContainerStd == util.Container {
		// 桌面端检查磁盘可用空间

		dataSize, sizeErr := util.SizeOfDirectory(data)
		if sizeErr != nil {
			logging.LogErrorf("get size of data dir [%s] failed: %s", data, sizeErr)
			err = sizeErr
			return
		}

		_, _, tempExportFree := util.GetDiskUsage(util.TempDir)
		if int64(tempExportFree) < dataSize*2 { // 压缩 zip 文件时需要 data 的两倍空间
			err = errors.New(fmt.Sprintf(Conf.Language(242), humanize.BytesCustomCeil(tempExportFree, 2), humanize.BytesCustomCeil(uint64(dataSize)*2, 2)))
			return
		}

		_, _, targetExportFree := util.GetDiskUsage(exportFolder)
		if int64(targetExportFree) < dataSize { // 复制 zip 最多需要 data 一样的空间
			err = errors.New(fmt.Sprintf(Conf.Language(242), humanize.BytesCustomCeil(targetExportFree, 2), humanize.BytesCustomCeil(uint64(dataSize), 2)))
			return
		}
	}

	zipPath, err := ExportData()
	if err != nil {
		return
	}
	name = filepath.Base(zipPath)
	name, err = url.PathUnescape(name)
	if err != nil {
		logging.LogErrorf("url unescape [%s] failed: %s", name, err)
		return
	}

	util.PushEndlessProgress(Conf.Language(65))
	defer util.ClearPushProgress(100)

	targetZipPath := filepath.Join(exportFolder, name)
	zipAbsPath := filepath.Join(util.TempDir, "export", name)
	err = filelock.Copy(zipAbsPath, targetZipPath)
	if err != nil {
		logging.LogErrorf("copy export zip from [%s] to [%s] failed: %s", zipAbsPath, targetZipPath, err)
		return
	}
	if removeErr := os.Remove(zipAbsPath); nil != removeErr {
		logging.LogErrorf("remove export zip failed: %s", removeErr)
	}
	return
}

func ExportData() (zipPath string, err error) {
	util.PushEndlessProgress(Conf.Language(65))
	defer util.ClearPushProgress(100)

	name := util.FilterFileName(util.WorkspaceName) + "-" + util.CurrentTimeSecondsStr()
	exportFolder := filepath.Join(util.TempDir, "export", name)
	zipPath, err = exportData(exportFolder)
	if err != nil {
		return
	}
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func exportData(exportFolder string) (zipPath string, err error) {
	FlushTxQueue()

	logging.LogInfof("exporting data...")

	baseFolderName := "data-" + util.CurrentTimeSecondsStr()
	if err = os.MkdirAll(exportFolder, 0755); err != nil {
		logging.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	data := filepath.Join(util.WorkspaceDir, "data")
	if err = filelock.Copy(data, exportFolder); err != nil {
		logging.LogErrorf("copy data dir from [%s] to [%s] failed: %s", data, baseFolderName, err)
		err = errors.New(fmt.Sprintf(Conf.Language(14), err.Error()))
		return
	}

	zipPath = exportFolder + ".zip"
	zip, err := gulu.Zip.Create(zipPath)
	if err != nil {
		logging.LogErrorf("create export data zip [%s] failed: %s", exportFolder, err)
		return
	}

	zipCallback := func(filename string) {
		util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.language(253), filename))
	}

	if err = zip.AddDirectory(baseFolderName, exportFolder, zipCallback); err != nil {
		logging.LogErrorf("create export data zip [%s] failed: %s", exportFolder, err)
		return
	}

	if err = zip.Close(); err != nil {
		logging.LogErrorf("close export data zip failed: %s", err)
	}

	os.RemoveAll(exportFolder)
	logging.LogInfof("export data done [%s]", zipPath)
	return
}

func ExportResources(resourcePaths []string, mainName string) (exportFilePath string, err error) {
	FlushTxQueue()

	// 用于导出的临时文件夹完整路径
	exportFolderPath := filepath.Join(util.TempDir, "export", mainName)
	if err = os.MkdirAll(exportFolderPath, 0755); err != nil {
		logging.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	// 将需要导出的文件/文件夹复制到临时文件夹
	for _, resourcePath := range resourcePaths {
		resourceFullPath := filepath.Join(util.WorkspaceDir, resourcePath) // 资源完整路径
		if !util.IsAbsPathInWorkspace(resourceFullPath) {
			logging.LogErrorf("resource path [%s] is not in workspace", resourceFullPath)
			err = errors.New("resource path [" + resourcePath + "] is not in workspace")
			return
		}

		resourceBaseName := filepath.Base(resourceFullPath)                   // 资源名称
		resourceCopyPath := filepath.Join(exportFolderPath, resourceBaseName) // 资源副本完整路径
		if err = filelock.Copy(resourceFullPath, resourceCopyPath); err != nil {
			logging.LogErrorf("copy resource will be exported from [%s] to [%s] failed: %s", resourcePath, resourceCopyPath, err)
			err = fmt.Errorf(Conf.Language(14), err.Error())
			return
		}
	}

	zipFilePath := exportFolderPath + ".zip" // 导出的 *.zip 文件完整路径
	zip, err := gulu.Zip.Create(zipFilePath)
	if err != nil {
		logging.LogErrorf("create export zip [%s] failed: %s", zipFilePath, err)
		return
	}

	if err = zip.AddDirectory(mainName, exportFolderPath); err != nil {
		logging.LogErrorf("create export zip [%s] failed: %s", exportFolderPath, err)
		return
	}

	if err = zip.Close(); err != nil {
		logging.LogErrorf("close export zip failed: %s", err)
	}

	os.RemoveAll(exportFolderPath)

	exportFilePath = path.Join("temp", "export", mainName+".zip") // 导出的 *.zip 文件相对于工作区目录的路径
	return
}

func ExportPreview(id string, fillCSSVar bool) (retStdHTML string) {
	blockRefMode := Conf.Export.BlockRefMode
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}

	tree := prepareExportTree(bt)
	tree = exportTree(tree, false, false, true,
		blockRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		"#", "#", // 这里固定使用 # 包裹标签，否则无法正确解析标签 https://github.com/siyuan-note/siyuan/issues/13857
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle, Conf.Export.InlineMemo, true, true, map[string]*parse.Tree{})
	luteEngine := NewLute()
	enableLuteInlineSyntax(luteEngine)
	luteEngine.SetFootnotes(true)
	addBlockIALNodes(tree, false)

	adjustHeadingLevel(bt, tree)

	// 移除超级块的属性列表 https://github.com/siyuan-note/siyuan/issues/13451
	var unlinks []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeKramdownBlockIAL == n.Type && nil != n.Previous && ast.NodeSuperBlock == n.Previous.Type {
			unlinks = append(unlinks, n)
		}
		return ast.WalkContinue
	})
	for _, unlink := range unlinks {
		unlink.Unlink()
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeFootnotesRef == n.Type && nil != n.Next {
			// https://github.com/siyuan-note/siyuan/issues/15654
			nextText := n.NextNodeText()
			if strings.HasPrefix(nextText, "(") && strings.HasSuffix(nextText, ")") {
				n.InsertAfter(&ast.Node{Type: ast.NodeText, Tokens: []byte(editor.Zwsp)})
			}
		}
		return ast.WalkContinue
	})

	md := treenode.FormatNode(tree.Root, luteEngine)
	tree = parse.Parse("", []byte(md), luteEngine.ParseOptions)
	// 使用实际主题样式值替换样式变量 Use real theme style value replace var in preview mode https://github.com/siyuan-note/siyuan/issues/11458
	if fillCSSVar {
		fillThemeStyleVar(tree)
	}
	luteEngine.RenderOptions.ProtyleMarkNetImg = false
	retStdHTML = luteEngine.ProtylePreview(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)

	if footnotesDefBlock := tree.Root.ChildByType(ast.NodeFootnotesDefBlock); nil != footnotesDefBlock {
		footnotesDefBlock.Unlink()
	}
	return
}

func ExportDocx(id, savePath string, removeAssets, merge bool) (fullPath string, err error) {
	if !util.IsValidPandocBin(Conf.Export.PandocBin) {
		Conf.Export.PandocBin = util.PandocBinPath
		Conf.Save()
		if !util.IsValidPandocBin(Conf.Export.PandocBin) {
			err = errors.New(Conf.Language(115))
			return
		}
	}

	tmpDir := filepath.Join(util.TempDir, "export", gulu.Rand.String(7))
	if err = os.MkdirAll(tmpDir, 0755); err != nil {
		return
	}
	defer os.Remove(tmpDir)
	name, content := ExportMarkdownHTML(id, tmpDir, true, merge)
	content = strings.ReplaceAll(content, "  \n", "<br>\n")

	tmpDocxPath := filepath.Join(tmpDir, name+".docx")
	args := []string{
		"-f", "html+tex_math_dollars",
		"--resource-path", tmpDir,
		"-o", tmpDocxPath,
	}

	params := util.ReplaceNewline(Conf.Export.PandocParams, " ")
	if "" != params {
		customArgs, parseErr := shellquote.Split(params)
		if nil != parseErr {
			logging.LogErrorf("parse pandoc custom params [%s] failed: %s", params, parseErr)
		} else {
			args = append(args, customArgs...)
		}
	}

	hasLuaFilter := false
	for i := 0; i < len(args)-1; i++ {
		if "--lua-filter" == args[i] {
			hasLuaFilter = true
			break
		}
	}
	if !hasLuaFilter {
		args = append(args, "--lua-filter", util.PandocColorFilterPath)
	}

	hasReferenceDoc := false
	for i := 0; i < len(args)-1; i++ {
		if "--reference-doc" == args[i] {
			hasReferenceDoc = true
			break
		}
	}
	if !hasReferenceDoc {
		args = append(args, "--reference-doc", util.PandocTemplatePath)
	}

	pandoc := exec.Command(Conf.Export.PandocBin, args...)
	gulu.CmdAttr(pandoc)
	pandoc.Stdin = bytes.NewBufferString(content)
	output, err := pandoc.CombinedOutput()
	if err != nil {
		msg := gulu.DecodeCmdOutput(output)
		logging.LogErrorf("export docx failed: %s", msg)
		err = errors.New(fmt.Sprintf(Conf.Language(14), msg))
		return
	}

	fullPath = filepath.Join(savePath, name+".docx")
	fullPath = util.GetUniqueFilename(fullPath)
	if err = filelock.Copy(tmpDocxPath, fullPath); err != nil {
		logging.LogErrorf("export docx failed: %s", err)
		err = errors.New(fmt.Sprintf(Conf.Language(14), err))
		return
	}

	if tmpAssets := filepath.Join(tmpDir, "assets"); !removeAssets && gulu.File.IsDir(tmpAssets) {
		if err = filelock.Copy(tmpAssets, filepath.Join(savePath, "assets")); err != nil {
			logging.LogErrorf("export docx failed: %s", err)
			err = errors.New(fmt.Sprintf(Conf.Language(14), err))
			return
		}
	}
	return
}

func ExportMarkdownHTML(id, savePath string, docx, merge bool) (name, dom string) {
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}

	tree := prepareExportTree(bt)

	if merge {
		var mergeErr error
		tree, mergeErr = mergeSubDocs(tree)
		if nil != mergeErr {
			logging.LogErrorf("merge sub docs failed: %s", mergeErr)
			return
		}
	}

	blockRefMode := Conf.Export.BlockRefMode
	tree = exportTree(tree, true, false, true,
		blockRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle, Conf.Export.InlineMemo, true, true, map[string]*parse.Tree{})
	name = path.Base(tree.HPath)
	name = util.FilterFileName(name) // 导出 PDF、HTML 和 Word 时未移除不支持的文件名符号 https://github.com/siyuan-note/siyuan/issues/5614
	savePath = strings.TrimSpace(savePath)

	if err := os.MkdirAll(savePath, 0755); err != nil {
		logging.LogErrorf("mkdir [%s] failed: %s", savePath, err)
		return
	}

	if docx {
		netAssets2LocalAssets0(tree, true, "", filepath.Join(savePath, "assets"), false)
	}

	assets := getAssetsLinkDests(tree.Root, docx)
	for _, asset := range assets {
		if !util.IsAssetLinkDest([]byte(asset), docx) {
			continue
		}

		if strings.Contains(asset, "?") {
			asset = asset[:strings.LastIndex(asset, "?")]
		}

		srcAbsPath, err := GetAssetAbsPath(asset)
		if err != nil {
			logging.LogWarnf("resolve path of asset [%s] failed: %s", asset, err)
			continue
		}
		targetAbsPath := filepath.Join(savePath, asset)
		if err = filelock.Copy(srcAbsPath, targetAbsPath); err != nil {
			logging.LogWarnf("copy asset from [%s] to [%s] failed: %s", srcAbsPath, targetAbsPath, err)
		}
	}

	srcs := []string{"stage/build/export", "stage/protyle"}
	for _, src := range srcs {
		from := filepath.Join(util.WorkingDir, src)
		to := filepath.Join(savePath, src)
		if err := filelock.Copy(from, to); err != nil {
			logging.LogWarnf("copy stage from [%s] to [%s] failed: %s", from, savePath, err)
		}
	}

	theme := Conf.Appearance.ThemeLight
	if 1 == Conf.Appearance.Mode {
		theme = Conf.Appearance.ThemeDark
	}
	// 复制主题文件夹
	srcs = []string{"themes/" + theme}
	appearancePath := util.AppearancePath
	if util.IsSymlinkPath(util.AppearancePath) {
		// Support for symlinked theme folder when exporting HTML https://github.com/siyuan-note/siyuan/issues/9173
		var readErr error
		appearancePath, readErr = filepath.EvalSymlinks(util.AppearancePath)
		if nil != readErr {
			logging.LogErrorf("readlink [%s] failed: %s", util.AppearancePath, readErr)
			return
		}
	}

	for _, src := range srcs {
		from := filepath.Join(appearancePath, src)
		to := filepath.Join(savePath, "appearance", src)
		if err := filelock.Copy(from, to); err != nil {
			logging.LogErrorf("copy appearance from [%s] to [%s] failed: %s", from, savePath, err)
			return
		}
	}

	// 只复制图标文件夹中的 icon.js 文件
	iconName := Conf.Appearance.Icon
	// 如果使用的不是内建图标（ant 或 material），需要复制 material 作为后备
	if iconName != "ant" && iconName != "material" && iconName != "" {
		srcIconFile := filepath.Join(appearancePath, "icons", "material", "icon.js")
		toIconDir := filepath.Join(savePath, "appearance", "icons", "material")
		if err := os.MkdirAll(toIconDir, 0755); err != nil {
			logging.LogErrorf("mkdir [%s] failed: %s", toIconDir, err)
			return
		}
		toIconFile := filepath.Join(toIconDir, "icon.js")
		if err := filelock.Copy(srcIconFile, toIconFile); err != nil {
			logging.LogWarnf("copy icon file from [%s] to [%s] failed: %s", srcIconFile, toIconFile, err)
		}
	}
	// 复制当前使用的图标文件
	if iconName != "" {
		srcIconFile := filepath.Join(appearancePath, "icons", iconName, "icon.js")
		toIconDir := filepath.Join(savePath, "appearance", "icons", iconName)
		if err := os.MkdirAll(toIconDir, 0755); err != nil {
			logging.LogErrorf("mkdir [%s] failed: %s", toIconDir, err)
			return
		}
		toIconFile := filepath.Join(toIconDir, "icon.js")
		if err := filelock.Copy(srcIconFile, toIconFile); err != nil {
			logging.LogWarnf("copy icon file from [%s] to [%s] failed: %s", srcIconFile, toIconFile, err)
		}
	}

	// 复制自定义表情图片
	emojis := emojisInTree(tree)
	for _, emoji := range emojis {
		from := filepath.Join(util.DataDir, emoji)
		to := filepath.Join(savePath, emoji)
		if err := filelock.Copy(from, to); err != nil {
			logging.LogErrorf("copy emojis from [%s] to [%s] failed: %s", from, to, err)
		}
	}

	if docx {
		processIFrame(tree)
		fillThemeStyleVar(tree)
	}

	luteEngine := NewLute()
	luteEngine.SetFootnotes(true)

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if ast.NodeEmojiImg == n.Type {
			// 自定义表情图片地址去掉开头的 /
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("src=\"/emojis"), []byte("src=\"emojis"))
		} else if ast.NodeList == n.Type {
			if nil != n.ListData && 1 == n.ListData.Typ {
				if 0 == n.ListData.Start {
					n.ListData.Start = 1
				}
				if li := n.ChildByType(ast.NodeListItem); nil != li && nil != li.ListData {
					n.ListData.Start = li.ListData.Num
				}
			}
		} else if n.IsTextMarkType("code") {
			if nil != n.Next && ast.NodeText == n.Next.Type {
				// 行级代码导出 word 之后会有多余的零宽空格 https://github.com/siyuan-note/siyuan/issues/14825
				n.Next.Tokens = bytes.TrimPrefix(n.Next.Tokens, []byte(editor.Zwsp))
			}
		}
		return ast.WalkContinue
	})

	if docx {
		renderer := render.NewProtyleExportDocxRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
		output := renderer.Render()
		dom = gulu.Str.FromBytes(output)
	} else {
		dom = luteEngine.ProtylePreview(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	}
	return
}

func ExportHTML(id, savePath string, pdf, image, keepFold, merge bool) (name, dom string, node *ast.Node) {
	savePath = strings.TrimSpace(savePath)

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}

	tree := prepareExportTree(bt)
	node = treenode.GetNodeInTree(tree, id)
	if ast.NodeDocument == node.Type {
		node.RemoveIALAttr("style")
	}

	if merge {
		var mergeErr error
		tree, mergeErr = mergeSubDocs(tree)
		if nil != mergeErr {
			logging.LogErrorf("merge sub docs failed: %s", mergeErr)
			return
		}
	}

	blockRefMode := Conf.Export.BlockRefMode
	var headings []*ast.Node
	if pdf { // 导出 PDF 需要标记目录书签
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeHeading == n.Type && !n.ParentIs(ast.NodeBlockquote) && !n.ParentIs(ast.NodeCallout) {
				headings = append(headings, n)
				return ast.WalkSkipChildren
			}
			return ast.WalkContinue
		})

		for _, h := range headings {
			link := &ast.Node{Type: ast.NodeLink}
			link.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
			link.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(" ")})
			link.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
			link.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
			link.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(PdfOutlineScheme + "://" + h.ID)})
			link.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
			h.PrependChild(link)
		}
	}

	tree = exportTree(tree, true, keepFold, true,
		blockRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle, Conf.Export.InlineMemo, true, true, map[string]*parse.Tree{})
	adjustHeadingLevel(bt, tree)
	name = path.Base(tree.HPath)
	name = util.FilterFileName(name) // 导出 PDF、HTML 和 Word 时未移除不支持的文件名符号 https://github.com/siyuan-note/siyuan/issues/5614

	if "" != savePath {
		if err := os.MkdirAll(savePath, 0755); err != nil {
			logging.LogErrorf("mkdir [%s] failed: %s", savePath, err)
			return
		}

		assets := getAssetsLinkDests(tree.Root, false)
		for _, asset := range assets {
			if strings.Contains(asset, "?") {
				asset = asset[:strings.LastIndex(asset, "?")]
			}

			srcAbsPath, err := GetAssetAbsPath(asset)
			if err != nil {
				logging.LogWarnf("resolve path of asset [%s] failed: %s", asset, err)
				continue
			}
			targetAbsPath := filepath.Join(savePath, asset)
			if err = filelock.Copy(srcAbsPath, targetAbsPath); err != nil {
				logging.LogWarnf("copy asset from [%s] to [%s] failed: %s", srcAbsPath, targetAbsPath, err)
			}
		}
	}

	if !pdf && "" != savePath { // 导出 HTML 需要复制静态资源
		srcs := []string{"stage/build/export", "stage/protyle"}
		for _, src := range srcs {
			from := filepath.Join(util.WorkingDir, src)
			to := filepath.Join(savePath, src)
			if err := filelock.Copy(from, to); err != nil {
				logging.LogErrorf("copy stage from [%s] to [%s] failed: %s", from, savePath, err)
				return
			}
		}

		theme := Conf.Appearance.ThemeLight
		if 1 == Conf.Appearance.Mode {
			theme = Conf.Appearance.ThemeDark
		}
		// 复制主题文件夹
		srcs = []string{"themes/" + theme}
		appearancePath := util.AppearancePath
		if util.IsSymlinkPath(util.AppearancePath) {
			// Support for symlinked theme folder when exporting HTML https://github.com/siyuan-note/siyuan/issues/9173
			var readErr error
			appearancePath, readErr = filepath.EvalSymlinks(util.AppearancePath)
			if nil != readErr {
				logging.LogErrorf("readlink [%s] failed: %s", util.AppearancePath, readErr)
				return
			}
		}
		for _, src := range srcs {
			from := filepath.Join(appearancePath, src)
			to := filepath.Join(savePath, "appearance", src)
			if err := filelock.Copy(from, to); err != nil {
				logging.LogErrorf("copy appearance from [%s] to [%s] failed: %s", from, savePath, err)
			}
		}

		// 只复制图标文件夹中的 icon.js 文件
		iconName := Conf.Appearance.Icon
		// 如果使用的不是内建图标（ant 或 material），需要复制 material 作为后备
		if iconName != "ant" && iconName != "material" && iconName != "" {
			srcIconFile := filepath.Join(appearancePath, "icons", "material", "icon.js")
			toIconDir := filepath.Join(savePath, "appearance", "icons", "material")
			if err := os.MkdirAll(toIconDir, 0755); err != nil {
				logging.LogErrorf("mkdir [%s] failed: %s", toIconDir, err)
				return
			}
			toIconFile := filepath.Join(toIconDir, "icon.js")
			if err := filelock.Copy(srcIconFile, toIconFile); err != nil {
				logging.LogWarnf("copy icon file from [%s] to [%s] failed: %s", srcIconFile, toIconFile, err)
			}
		}
		// 复制当前使用的图标文件
		if iconName != "" {
			srcIconFile := filepath.Join(appearancePath, "icons", iconName, "icon.js")
			toIconDir := filepath.Join(savePath, "appearance", "icons", iconName)
			if err := os.MkdirAll(toIconDir, 0755); err != nil {
				logging.LogErrorf("mkdir [%s] failed: %s", toIconDir, err)
				return
			}
			toIconFile := filepath.Join(toIconDir, "icon.js")
			if err := filelock.Copy(srcIconFile, toIconFile); err != nil {
				logging.LogWarnf("copy icon file from [%s] to [%s] failed: %s", srcIconFile, toIconFile, err)
			}
		}

		// 复制自定义表情图片
		emojis := emojisInTree(tree)
		for _, emoji := range emojis {
			from := filepath.Join(util.DataDir, emoji)
			to := filepath.Join(savePath, emoji)
			if err := filelock.Copy(from, to); err != nil {
				logging.LogErrorf("copy emojis from [%s] to [%s] failed: %s", from, to, err)
			}
		}
	}

	if pdf {
		processIFrame(tree)
	}

	luteEngine := NewLute()
	luteEngine.SetFootnotes(true)
	luteEngine.RenderOptions.ProtyleContenteditable = false
	luteEngine.SetProtyleMarkNetImg(false)

	// 不进行安全过滤，因为导出时需要保留所有的 HTML 标签
	// 使用属性 `data-export-html` 导出时 `<style></style>` 标签丢失 https://github.com/siyuan-note/siyuan/issues/6228
	luteEngine.SetSanitize(false)

	renderer := render.NewProtyleExportRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	dom = gulu.Str.FromBytes(renderer.Render())
	return
}

func prepareExportTree(bt *treenode.BlockTree) (ret *parse.Tree) {
	luteEngine := NewLute()
	ret, _ = filesys.LoadTree(bt.BoxID, bt.Path, luteEngine)
	if "d" != bt.Type {
		node := treenode.GetNodeInTree(ret, bt.ID)
		nodes := []*ast.Node{node}
		if "h" == bt.Type {
			children := treenode.HeadingChildren(node)
			for _, child := range children {
				nodes = append(nodes, child)
			}
		}

		oldRoot := ret.Root
		ret = parse.Parse("", []byte(""), luteEngine.ParseOptions)
		first := ret.Root.FirstChild
		for _, n := range nodes {
			first.InsertBefore(n)
		}
		ret.Root.KramdownIAL = oldRoot.KramdownIAL
	}
	ret.Path = bt.Path
	ret.HPath = bt.HPath
	ret.Box = bt.BoxID
	ret.ID = bt.RootID
	return
}

func processIFrame(tree *parse.Tree) {
	// 导出 PDF/Word 时 IFrame 块使用超链接 https://github.com/siyuan-note/siyuan/issues/4035
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeIFrame != n.Type {
			return ast.WalkContinue
		}

		n.Type = ast.NodeParagraph
		index := bytes.Index(n.Tokens, []byte("src=\""))
		if 0 > index {
			n.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: n.Tokens})
		} else {
			src := n.Tokens[index+len("src=\""):]
			src = src[:bytes.Index(src, []byte("\""))]
			src = html.UnescapeHTML(src)
			link := &ast.Node{Type: ast.NodeLink}
			link.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
			link.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: src})
			link.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
			link.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
			link.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: src})
			link.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
			n.AppendChild(link)
		}
		return ast.WalkContinue
	})
}

func ProcessPDF(id, p string, merge, removeAssets, watermark bool) (err error) {
	tree, _ := LoadTreeByBlockID(id)
	if nil == tree {
		return
	}

	if merge {
		var mergeErr error
		tree, mergeErr = mergeSubDocs(tree)
		if nil != mergeErr {
			logging.LogErrorf("merge sub docs failed: %s", mergeErr)
			return
		}
	}

	var headings []*ast.Node
	assetDests := getAssetsLinkDests(tree.Root, false)
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeHeading == n.Type && !n.ParentIs(ast.NodeBlockquote) && !n.ParentIs(ast.NodeCallout) {
			headings = append(headings, n)
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})

	api.DisableConfigDir()
	font.UserFontDir = filepath.Join(util.HomeDir, ".config", "siyuan", "fonts")
	if mkdirErr := os.MkdirAll(font.UserFontDir, 0755); nil != mkdirErr {
		logging.LogErrorf("mkdir [%s] failed: %s", font.UserFontDir, mkdirErr)
		return
	}
	if loadErr := api.LoadUserFonts(); nil != loadErr {
		logging.LogErrorf("load user fonts failed: %s", loadErr)
	}

	pdfCtx, ctxErr := api.ReadContextFile(p)
	if nil != ctxErr {
		logging.LogErrorf("read pdf context failed: %s", ctxErr)
		return
	}

	processPDFBookmarks(pdfCtx, headings)
	processPDFLinkEmbedAssets(pdfCtx, assetDests, removeAssets)
	processPDFWatermark(pdfCtx, watermark)

	pdfcpuVer := model.VersionStr
	model.VersionStr = "SiYuan v" + util.Ver + " (pdfcpu " + pdfcpuVer + ")"
	if writeErr := api.WriteContextFile(pdfCtx, p); nil != writeErr {
		logging.LogErrorf("write pdf context failed: %s", writeErr)
		return
	}
	return
}

func processPDFWatermark(pdfCtx *model.Context, watermark bool) {
	// Support adding the watermark on export PDF https://github.com/siyuan-note/siyuan/issues/9961
	// https://pdfcpu.io/core/watermark

	if !watermark {
		return
	}

	str := Conf.Export.PDFWatermarkStr
	if "" == str {
		return
	}

	mode := "text"
	if gulu.File.IsExist(str) {
		if ".pdf" == strings.ToLower(filepath.Ext(str)) {
			mode = "pdf"
		} else {
			mode = "image"
		}
	}

	desc := Conf.Export.PDFWatermarkDesc
	if "text" == mode && util.ContainsCJK(str) {
		// 中日韩文本水印需要安装字体文件
		descParts := strings.Split(desc, ",")
		m := map[string]string{}
		for _, descPart := range descParts {
			kv := strings.Split(descPart, ":")
			if 2 != len(kv) {
				continue
			}
			m[kv[0]] = kv[1]
		}

		useDefaultFont := true
		if "" != m["fontname"] {
			listFonts, e := api.ListFonts()
			var builtInFontNames []string
			if nil != e {
				logging.LogInfof("listFont failed: %s", e)
			} else {
				for _, f := range listFonts {
					if strings.Contains(f, "(") {
						f = f[:strings.Index(f, "(")]
					}
					f = strings.TrimSpace(f)
					if strings.Contains(f, ":") || "" == f || strings.Contains(f, "Corefonts") || strings.Contains(f, "Userfonts") {
						continue
					}

					builtInFontNames = append(builtInFontNames, f)
				}

				for _, font := range builtInFontNames {
					if font == m["fontname"] {
						useDefaultFont = false
						break
					}
				}
			}
		}
		if useDefaultFont {
			m["fontname"] = "LXGWWenKaiLite-Regular"
			fontPath := filepath.Join(util.AppearancePath, "fonts", "LxgwWenKai-Lite-1.501", "LXGWWenKaiLite-Regular.ttf")
			err := api.InstallFonts([]string{fontPath})
			if err != nil {
				logging.LogErrorf("install font [%s] failed: %s", fontPath, err)
			}
		}

		descBuilder := bytes.Buffer{}
		for k, v := range m {
			descBuilder.WriteString(k)
			descBuilder.WriteString(":")
			descBuilder.WriteString(v)
			descBuilder.WriteString(",")
		}
		desc = descBuilder.String()
		desc = desc[:len(desc)-1]
	}

	logging.LogInfof("add PDF watermark [mode=%s, str=%s, desc=%s]", mode, str, desc)

	var wm *model.Watermark
	var err error
	switch mode {
	case "text":
		wm, err = pdfcpu.ParseTextWatermarkDetails(str, desc, false, types.POINTS)
	case "image":
		wm, err = pdfcpu.ParseImageWatermarkDetails(str, desc, false, types.POINTS)
	case "pdf":
		wm, err = pdfcpu.ParsePDFWatermarkDetails(str, desc, false, types.POINTS)
	}

	if err != nil {
		logging.LogErrorf("parse watermark failed: %s", err)
		util.PushErrMsg(err.Error(), 7000)
		return
	}

	wm.OnTop = true // Export PDF and add watermarks no longer covered by images https://github.com/siyuan-note/siyuan/issues/10818
	err = pdfcpu.AddWatermarks(pdfCtx, nil, wm)
	if err != nil {
		logging.LogErrorf("add watermark failed: %s", err)
		return
	}
}

func processPDFBookmarks(pdfCtx *model.Context, headings []*ast.Node) {
	links, err := PdfListToCLinks(pdfCtx)
	if err != nil {
		return
	}

	sort.Slice(links, func(i, j int) bool {
		return links[i].Page < links[j].Page
	})

	titles := map[string]bool{}
	bms := map[string]*pdfcpu.Bookmark{}
	for _, link := range links {
		linkID := link.URI[strings.LastIndex(link.URI, "/")+1:]
		b := sql.GetBlock(linkID)
		if nil == b {
			logging.LogWarnf("pdf outline block [%s] not found", linkID)
			continue
		}
		title := b.Content
		title, _ = url.QueryUnescape(title)
		for {
			if _, ok := titles[title]; ok {
				title += "\x01"
			} else {
				titles[title] = true
				break
			}
		}
		bm := &pdfcpu.Bookmark{
			Title:    title,
			PageFrom: link.Page,
			AbsPos:   link.Rect.UR.Y,
		}
		bms[linkID] = bm
	}

	if 1 > len(bms) {
		return
	}

	var topBms []*pdfcpu.Bookmark
	stack := linkedliststack.New()
	for _, h := range headings {
	L:
		for ; ; stack.Pop() {
			cur, ok := stack.Peek()
			if !ok {
				bm, ok := bms[h.ID]
				if !ok {
					break L
				}
				bm.Level = h.HeadingLevel
				stack.Push(bm)
				topBms = append(topBms, bm)
				break L
			}

			tip := cur.(*pdfcpu.Bookmark)
			if tip.Level < h.HeadingLevel {
				bm := bms[h.ID]
				bm.Level = h.HeadingLevel
				bm.Parent = tip
				tip.Kids = append(tip.Kids, bm)
				stack.Push(bm)
				break L
			}
		}
	}

	err = pdfcpu.AddBookmarks(pdfCtx, topBms, true)
	if err != nil {
		logging.LogErrorf("add bookmark failed: %s", err)
		return
	}
}

// processPDFLinkEmbedAssets 处理资源文件超链接，根据 removeAssets 参数决定是否将资源文件嵌入到 PDF 中。
// 导出 PDF 时支持将资源文件作为附件嵌入 https://github.com/siyuan-note/siyuan/issues/7414
func processPDFLinkEmbedAssets(pdfCtx *model.Context, assetDests []string, removeAssets bool) {
	var assetAbsPaths []string
	for _, dest := range assetDests {
		if absPath, _ := GetAssetAbsPath(dest); "" != absPath {
			assetAbsPaths = append(assetAbsPaths, absPath)
		}
	}

	if 1 > len(assetAbsPaths) {
		return
	}

	assetLinks, otherLinks, listErr := PdfListLinks(pdfCtx)
	if nil != listErr {
		logging.LogErrorf("list asset links failed: %s", listErr)
		return
	}

	if 1 > len(assetLinks) {
		return
	}

	if _, removeErr := pdfcpu.RemoveAnnotations(pdfCtx, nil, nil, nil, false); nil != removeErr {
		logging.LogWarnf("remove annotations failed: %s", removeErr)
	}

	linkMap := map[int][]model.AnnotationRenderer{}
	for _, link := range otherLinks {
		link.URI, _ = url.PathUnescape(link.URI)
		if 1 > len(linkMap[link.Page]) {
			linkMap[link.Page] = []model.AnnotationRenderer{link}
		} else {
			linkMap[link.Page] = append(linkMap[link.Page], link)
		}
	}

	attachmentMap := map[int][]*types.IndirectRef{}
	now := types.StringLiteral(types.DateString(time.Now()))
	for _, link := range assetLinks {
		link.URI = strings.ReplaceAll(link.URI, "http://"+util.LocalHost+":"+util.ServerPort+"/export/temp/", "")
		link.URI = strings.ReplaceAll(link.URI, "http://"+util.LocalHost+":6806/export/temp/", "")
		link.URI = strings.ReplaceAll(link.URI, "http://"+util.LocalHost+":"+util.ServerPort+"/", "") // Exporting PDF embedded asset files as attachments fails https://github.com/siyuan-note/siyuan/issues/7414#issuecomment-1704573557
		link.URI = strings.ReplaceAll(link.URI, "http://"+util.LocalHost+":6806/", "")
		link.URI, _ = url.PathUnescape(link.URI)
		if idx := strings.Index(link.URI, "?"); 0 < idx {
			link.URI = link.URI[:idx]
		}

		if !removeAssets {
			// 不移除资源文件夹的话将超链接指向资源文件夹
			if 1 > len(linkMap[link.Page]) {
				linkMap[link.Page] = []model.AnnotationRenderer{link}
			} else {
				linkMap[link.Page] = append(linkMap[link.Page], link)
			}

			continue
		}

		// 移除资源文件夹的话使用内嵌附件

		absPath, getErr := GetAssetAbsPath(link.URI)
		if nil != getErr {
			continue
		}

		ir, newErr := pdfCtx.XRefTable.NewEmbeddedFileStreamDict(absPath)
		if nil != newErr {
			logging.LogWarnf("new embedded file stream dict failed: %s", newErr)
			continue
		}

		fn := filepath.Base(absPath)
		fileSpecDict, newErr := pdfCtx.XRefTable.NewFileSpecDict(fn, fn, "attached by SiYuan", *ir)
		if nil != newErr {
			logging.LogWarnf("new file spec dict failed: %s", newErr)
			continue
		}

		ir, indErr := pdfCtx.XRefTable.IndRefForNewObject(fileSpecDict)
		if nil != indErr {
			logging.LogWarnf("ind ref for new object failed: %s", indErr)
			continue
		}

		lx := link.Rect.LL.X + link.Rect.Width()
		ly := link.Rect.LL.Y + link.Rect.Height()/2
		w := link.Rect.Height() / 2
		h := link.Rect.Height() / 2

		d := types.Dict(
			map[string]types.Object{
				"Type":         types.Name("Annot"),
				"Subtype":      types.Name("FileAttachment"),
				"Contents":     types.StringLiteral(""),
				"Rect":         types.RectForWidthAndHeight(lx, ly, w, h).Array(),
				"P":            link.P,
				"M":            now,
				"F":            types.Integer(0),
				"Border":       types.NewIntegerArray(0, 0, 1),
				"C":            types.NewNumberArray(0.5, 0.0, 0.5),
				"CA":           types.Float(0.95),
				"CreationDate": now,
				"Name":         types.Name("FileAttachment"),
				"FS":           *ir,
				"NM":           types.StringLiteral(""),
			},
		)

		ann, indErr := pdfCtx.XRefTable.IndRefForNewObject(d)
		if nil != indErr {
			logging.LogWarnf("ind ref for new object failed: %s", indErr)
			continue
		}

		pageDictIndRef, pageErr := pdfCtx.PageDictIndRef(link.Page)
		if nil != pageErr {
			logging.LogWarnf("page dict ind ref failed: %s", pageErr)
			continue
		}

		d, defErr := pdfCtx.DereferenceDict(*pageDictIndRef)
		if nil != defErr {
			logging.LogWarnf("dereference dict failed: %s", defErr)
			continue
		}

		if 1 > len(attachmentMap[link.Page]) {
			attachmentMap[link.Page] = []*types.IndirectRef{ann}
		} else {
			attachmentMap[link.Page] = append(attachmentMap[link.Page], ann)
		}
	}

	if 0 < len(linkMap) {
		if _, addErr := pdfcpu.AddAnnotationsMap(pdfCtx, linkMap, false); nil != addErr {
			logging.LogErrorf("add annotations map failed: %s", addErr)
		}
	}

	// 添加附件注解指向内嵌的附件
	for page, anns := range attachmentMap {
		pageDictIndRef, pageErr := pdfCtx.PageDictIndRef(page)
		if nil != pageErr {
			logging.LogWarnf("page dict ind ref failed: %s", pageErr)
			continue
		}

		pageDict, defErr := pdfCtx.DereferenceDict(*pageDictIndRef)
		if nil != defErr {
			logging.LogWarnf("dereference dict failed: %s", defErr)
			continue
		}

		array := types.Array{}
		for _, ann := range anns {
			array = append(array, *ann)
		}

		obj, found := pageDict.Find("Annots")
		if !found {
			pageDict.Insert("Annots", array)
			pdfCtx.EnsureVersionForWriting()
			continue
		}

		ir, ok := obj.(types.IndirectRef)
		if !ok {
			pageDict.Update("Annots", append(obj.(types.Array), array...))
			pdfCtx.EnsureVersionForWriting()
			continue
		}

		// Annots array is an IndirectReference.

		o, err := pdfCtx.Dereference(ir)
		if err != nil || o == nil {
			continue
		}

		annots, _ := o.(types.Array)
		entry, ok := pdfCtx.FindTableEntryForIndRef(&ir)
		if !ok {
			continue
		}
		entry.Object = append(annots, array...)
		pdfCtx.EnsureVersionForWriting()
	}
}

func ExportStdMarkdown(id string, assetsDestSpace2Underscore, fillCSSVar, adjustHeadingLevel, imgTag bool) string {
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		logging.LogErrorf("block tree [%s] not found", id)
		return ""
	}

	tree := prepareExportTree(bt)
	cloudAssetsBase := ""
	if IsSubscriber() {
		cloudAssetsBase = util.GetCloudAssetsServer() + Conf.GetUser().UserId + "/"
	}

	var defBlockIDs []string
	if 4 == Conf.Export.BlockRefMode { // 脚注+锚点哈希
		// 导出锚点哈希，这里先记录下所有定义块的 ID
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			var defID string
			if treenode.IsBlockLink(n) {
				defID = strings.TrimPrefix(n.TextMarkAHref, "siyuan://blocks/")
			} else if treenode.IsBlockRef(n) {
				defID, _, _ = treenode.GetBlockRef(n)
			}

			if "" != defID {
				if defBt := treenode.GetBlockTree(defID); nil != defBt {
					defBlockIDs = append(defBlockIDs, defID)
					defBlockIDs = gulu.Str.RemoveDuplicatedElem(defBlockIDs)
				}
			}
			return ast.WalkContinue
		})
	}
	defBlockIDs = gulu.Str.RemoveDuplicatedElem(defBlockIDs)

	return exportMarkdownContent0(id, tree, cloudAssetsBase, assetsDestSpace2Underscore, adjustHeadingLevel, imgTag,
		".md", Conf.Export.BlockRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle, Conf.Export.InlineMemo, defBlockIDs, true, fillCSSVar, map[string]*parse.Tree{})
}

func ExportPandocConvertZip(ids []string, pandocTo, ext string) (name, zipPath string) {
	block := treenode.GetBlockTree(ids[0])
	box := Conf.Box(block.BoxID)
	baseFolderName := path.Base(block.HPath)
	if "." == baseFolderName {
		baseFolderName = path.Base(block.Path)
	}

	var docPaths []string
	bts := treenode.GetBlockTrees(ids)
	for _, bt := range bts {
		docPaths = append(docPaths, bt.Path)

		if Conf.Export.IncludeSubDocs {
			docFiles := box.ListFiles(strings.TrimSuffix(bt.Path, ".sy"))
			for _, docFile := range docFiles {
				docPaths = append(docPaths, docFile.path)
			}
		}
	}

	defBlockIDs, trees, docPaths := prepareExportTrees(docPaths)
	zipPath = exportPandocConvertZip(baseFolderName, docPaths, defBlockIDs, "gfm+footnotes+hard_line_breaks", pandocTo, ext, trees)
	name = util.GetTreeID(block.Path)
	return
}

func ExportNotebookMarkdown(boxID string) (zipPath string) {
	util.PushEndlessProgress(Conf.Language(65))
	defer util.ClearPushProgress(100)

	box := Conf.Box(boxID)
	if nil == box {
		logging.LogErrorf("not found box [%s]", boxID)
		return
	}

	var docPaths []string
	docFiles := box.ListFiles("/")
	for _, docFile := range docFiles {
		docPaths = append(docPaths, docFile.path)
	}

	defBlockIDs, trees, docPaths := prepareExportTrees(docPaths)
	zipPath = exportPandocConvertZip(box.Name, docPaths, defBlockIDs, "", "", ".md", trees)
	return
}

func yfm(docIAL map[string]string) string {
	// 导出 Markdown 文件时开头附上一些元数据 https://github.com/siyuan-note/siyuan/issues/6880

	buf := bytes.Buffer{}
	buf.WriteString("---\n")
	var title, created, updated, tags string
	for k, v := range docIAL {
		if "id" == k {
			createdTime, parseErr := time.Parse("20060102150405", util.TimeFromID(v))
			if nil == parseErr {
				created = createdTime.Format(time.RFC3339)
			}
			continue
		}
		if "title" == k {
			title = v
			continue
		}
		if "updated" == k {
			updatedTime, parseErr := time.Parse("20060102150405", v)
			if nil == parseErr {
				updated = updatedTime.Format(time.RFC3339)
			}
			continue
		}
		if "tags" == k {
			tags = v
			continue
		}
	}
	if "" != title {
		buf.WriteString("title: ")
		buf.WriteString(title)
		buf.WriteString("\n")
	}
	if "" == updated {
		updated = time.Now().Format(time.RFC3339)
	}
	if "" == created {
		created = updated
	}
	buf.WriteString("date: ")
	buf.WriteString(created)
	buf.WriteString("\n")
	buf.WriteString("lastmod: ")
	buf.WriteString(updated)
	buf.WriteString("\n")
	if "" != tags {
		buf.WriteString("tags: [")
		buf.WriteString(tags)
		buf.WriteString("]\n")
	}
	buf.WriteString("---\n\n")
	return buf.String()
}

func exportBoxSYZip(boxID string) (zipPath string) {
	util.PushEndlessProgress(Conf.Language(65))
	defer util.ClearPushProgress(100)

	box := Conf.Box(boxID)
	if nil == box {
		logging.LogErrorf("not found box [%s]", boxID)
		return
	}
	baseFolderName := box.Name

	var docPaths []string
	docFiles := box.ListFiles("/")
	for _, docFile := range docFiles {
		docPaths = append(docPaths, docFile.path)
	}
	zipPath = exportSYZip(boxID, "/", baseFolderName, docPaths)
	return
}

func exportSYZip(boxID, rootDirPath, baseFolderName string, docPaths []string) (zipPath string) {
	defer util.ClearPushProgress(100)

	dir, name := path.Split(baseFolderName)
	name = util.FilterFileName(name)
	if strings.HasSuffix(name, "..") {
		// 文档标题以 `..` 结尾时无法导出 Markdown https://github.com/siyuan-note/siyuan/issues/4698
		// 似乎是 os.MkdirAll 的 bug，以 .. 结尾的路径无法创建，所以这里加上 _ 结尾
		name += "_"
	}
	baseFolderName = path.Join(dir, name)
	box := Conf.Box(boxID)

	exportDir := filepath.Join(util.TempDir, "export", baseFolderName)
	if err := os.MkdirAll(exportDir, 0755); err != nil {
		logging.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	trees := map[string]*parse.Tree{}
	refTrees := map[string]*parse.Tree{}
	luteEngine := util.NewLute()
	for i, p := range docPaths {
		if !strings.HasSuffix(p, ".sy") {
			continue
		}

		tree, err := filesys.LoadTree(boxID, p, luteEngine)
		if err != nil {
			continue
		}
		trees[tree.ID] = tree

		util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.language(70), fmt.Sprintf("%d/%d %s", i+1, len(docPaths), tree.Root.IALAttr("title"))))
	}

	count := 1
	treeCache := map[string]*parse.Tree{}
	for _, tree := range trees {
		util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.language(70), fmt.Sprintf("%d/%d %s", count, len(docPaths), tree.Root.IALAttr("title"))))

		refs := map[string]*parse.Tree{}
		exportRefTrees(tree, &[]string{}, refs, treeCache)
		for refTreeID, refTree := range refs {
			if nil == trees[refTreeID] {
				refTrees[refTreeID] = refTree
			}
		}
		count++
	}

	util.PushEndlessProgress(Conf.Language(65))
	count = 0

	// 按文件夹结构复制选择的树
	total := len(trees) + len(refTrees)
	for _, tree := range trees {
		readPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
		data, readErr := filelock.ReadFile(readPath)
		if nil != readErr {
			logging.LogErrorf("read file [%s] failed: %s", readPath, readErr)
			continue
		}

		writePath := strings.TrimPrefix(tree.Path, rootDirPath)
		writePath = filepath.Join(exportDir, writePath)
		writeFolder := filepath.Dir(writePath)
		if mkdirErr := os.MkdirAll(writeFolder, 0755); nil != mkdirErr {
			logging.LogErrorf("create export temp folder [%s] failed: %s", writeFolder, mkdirErr)
			continue
		}
		if writeErr := os.WriteFile(writePath, data, 0644); nil != writeErr {
			logging.LogErrorf("write export file [%s] failed: %s", writePath, writeErr)
			continue
		}
		count++

		util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.Language(66), fmt.Sprintf("%d/%d ", count, total)+tree.HPath))
	}

	count = 0
	// 引用树放在导出文件夹根路径下
	for treeID, tree := range refTrees {
		readPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
		data, readErr := filelock.ReadFile(readPath)
		if nil != readErr {
			logging.LogErrorf("read file [%s] failed: %s", readPath, readErr)
			continue
		}

		writePath := strings.TrimPrefix(tree.Path, rootDirPath)
		writePath = filepath.Join(exportDir, treeID+".sy")
		if writeErr := os.WriteFile(writePath, data, 0644); nil != writeErr {
			logging.LogErrorf("write export file [%s] failed: %s", writePath, writeErr)
			continue
		}
		count++

		util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.Language(66), fmt.Sprintf("%d/%d ", count, total)+tree.HPath))
	}

	// 将引用树合并到选择树中，以便后面一次性导出资源文件
	for treeID, tree := range refTrees {
		trees[treeID] = tree
	}

	// 导出引用的资源文件
	assetPathMap, err := allAssetAbsPaths()
	if nil != err {
		logging.LogWarnf("get assets abs path failed: %s", err)
		return
	}
	copiedAssets := hashset.New()
	for _, tree := range trees {
		var assets []string
		assets = append(assets, getAssetsLinkDests(tree.Root, false)...)
		titleImgPath := treenode.GetDocTitleImgPath(tree.Root) // Export .sy.zip doc title image is not exported https://github.com/siyuan-note/siyuan/issues/8748
		if "" != titleImgPath {
			if util.IsAssetLinkDest([]byte(titleImgPath), false) {
				assets = append(assets, titleImgPath)
			}
		}

		for _, asset := range assets {
			util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.language(70), asset))

			asset = string(html.DecodeDestination([]byte(asset)))
			if strings.Contains(asset, "?") {
				asset = asset[:strings.LastIndex(asset, "?")]
			}

			if copiedAssets.Contains(asset) {
				continue
			}

			srcPath := assetPathMap[asset]
			if "" == srcPath {
				logging.LogWarnf("get asset [%s] abs path failed", asset)
				continue
			}

			destPath := filepath.Join(exportDir, asset)
			assetErr := filelock.Copy(srcPath, destPath)
			if nil != assetErr {
				logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", srcPath, destPath, assetErr)
				continue
			}

			if !gulu.File.IsDir(srcPath) && strings.HasSuffix(strings.ToLower(srcPath), ".pdf") {
				sya := srcPath + ".sya"
				if filelock.IsExist(sya) {
					// Related PDF annotation information is not exported when exporting .sy.zip https://github.com/siyuan-note/siyuan/issues/7836
					if syaErr := filelock.Copy(sya, destPath+".sya"); nil != syaErr {
						logging.LogErrorf("copy sya from [%s] to [%s] failed: %s", sya, destPath+".sya", syaErr)
					}
				}
			}

			copiedAssets.Add(asset)
		}

		// 复制自定义表情图片
		emojis := emojisInTree(tree)
		for _, emoji := range emojis {
			from := filepath.Join(util.DataDir, emoji)
			to := filepath.Join(exportDir, emoji)
			if copyErr := filelock.Copy(from, to); copyErr != nil {
				logging.LogErrorf("copy emojis from [%s] to [%s] failed: %s", from, to, copyErr)
			}
		}
	}

	// 导出数据库 Attribute View export https://github.com/siyuan-note/siyuan/issues/8710
	exportStorageAvDir := filepath.Join(exportDir, "storage", "av")
	var avIDs []string
	for _, tree := range trees {
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			if ast.NodeAttributeView == n.Type {
				avIDs = append(avIDs, n.AttributeViewID)
			}

			avs := n.IALAttr(av.NodeAttrNameAvs)
			if "" == avs {
				return ast.WalkContinue
			}

			for _, avID := range strings.Split(avs, ",") {
				avIDs = append(avIDs, strings.TrimSpace(avID))
			}
			return ast.WalkContinue
		})
	}
	avIDs = gulu.Str.RemoveDuplicatedElem(avIDs)
	for _, avID := range avIDs {
		if !ast.IsNodeIDPattern(avID) {
			continue
		}

		exportAv(avID, exportStorageAvDir, exportDir, assetPathMap)
	}

	// 导出闪卡 Export related flashcard data when exporting .sy.zip https://github.com/siyuan-note/siyuan/issues/9372
	exportStorageRiffDir := filepath.Join(exportDir, "storage", "riff")
	deck, loadErr := riff.LoadDeck(exportStorageRiffDir, builtinDeckID, Conf.Flashcard.RequestRetention, Conf.Flashcard.MaximumInterval, Conf.Flashcard.Weights)
	if nil != loadErr {
		logging.LogErrorf("load deck [%s] failed: %s", name, loadErr)
	} else {
		for _, tree := range trees {
			cards := getTreeFlashcards(tree.ID)

			for _, card := range cards {
				deck.AddCard(card.ID(), card.BlockID())
			}
		}
		if 0 < deck.CountCards() {
			if saveErr := deck.Save(); nil != saveErr {
				logging.LogErrorf("save deck [%s] failed: %s", name, saveErr)
			}
		}
	}

	// 导出自定义排序
	sortPath := filepath.Join(util.DataDir, box.ID, ".siyuan", "sort.json")
	fullSortIDs := map[string]int{}
	sortIDs := map[string]int{}
	var sortData []byte
	var sortErr error
	if filelock.IsExist(sortPath) {
		sortData, sortErr = filelock.ReadFile(sortPath)
		if nil != sortErr {
			logging.LogErrorf("read sort conf failed: %s", sortErr)
		}

		if sortErr = gulu.JSON.UnmarshalJSON(sortData, &fullSortIDs); nil != sortErr {
			logging.LogErrorf("unmarshal sort conf failed: %s", sortErr)
		}

		if 0 < len(fullSortIDs) {
			for _, tree := range trees {
				if v, ok := fullSortIDs[tree.ID]; ok {
					sortIDs[tree.ID] = v
				}
			}
		}

		if 0 < len(sortIDs) {
			sortData, sortErr = gulu.JSON.MarshalJSON(sortIDs)
			if nil != sortErr {
				logging.LogErrorf("marshal sort conf failed: %s", sortErr)
			}
			if 0 < len(sortData) {
				confDir := filepath.Join(exportDir, ".siyuan")
				if mkdirErr := os.MkdirAll(confDir, 0755); nil != mkdirErr {
					logging.LogErrorf("create export conf folder [%s] failed: %s", confDir, mkdirErr)
				} else {
					sortPath = filepath.Join(confDir, "sort.json")
					if writeErr := os.WriteFile(sortPath, sortData, 0644); nil != writeErr {
						logging.LogErrorf("write sort conf failed: %s", writeErr)
					}
				}
			}
		}
	}

	zipPath = exportDir + ".sy.zip"
	zip, err := gulu.Zip.Create(zipPath)
	if err != nil {
		logging.LogErrorf("create export .sy.zip [%s] failed: %s", exportDir, err)
		return ""
	}

	zipCallback := func(filename string) {
		util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.language(253), filename))
	}

	if err = zip.AddDirectory(baseFolderName, exportDir, zipCallback); err != nil {
		logging.LogErrorf("create export .sy.zip [%s] failed: %s", exportDir, err)
		return ""
	}

	if err = zip.Close(); err != nil {
		logging.LogErrorf("close export .sy.zip failed: %s", err)
	}

	os.RemoveAll(exportDir)
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func exportAv(avID, exportStorageAvDir, exportFolder string, assetPathMap map[string]string) {
	avJSONPath := av.GetAttributeViewDataPath(avID)
	if !filelock.IsExist(avJSONPath) {
		return
	}

	if copyErr := filelock.Copy(avJSONPath, filepath.Join(exportStorageAvDir, avID+".json")); nil != copyErr {
		logging.LogErrorf("copy av json failed: %s", copyErr)
	}

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	for _, keyValues := range attrView.KeyValues {
		switch keyValues.Key.Type {
		case av.KeyTypeMAsset: // 导出资源文件列 https://github.com/siyuan-note/siyuan/issues/9919
			for _, value := range keyValues.Values {
				for _, asset := range value.MAsset {
					if !util.IsAssetLinkDest([]byte(asset.Content), false) {
						continue
					}

					destPath := filepath.Join(exportFolder, asset.Content)
					srcPath := assetPathMap[asset.Content]
					if "" == srcPath {
						logging.LogWarnf("get asset [%s] abs path failed", asset.Content)
						continue
					}

					if copyErr := filelock.Copy(srcPath, destPath); nil != copyErr {
						logging.LogErrorf("copy asset failed: %s", copyErr)
					}
				}
			}
		}
	}

	// 级联导出关联列关联的数据库
	exportRelationAvs(avID, exportStorageAvDir)
}

func exportRelationAvs(avID, exportStorageAvDir string) {
	avIDs := hashset.New()
	walkRelationAvs(avID, avIDs)

	for _, v := range avIDs.Values() {
		relAvID := v.(string)
		relAvJSONPath := av.GetAttributeViewDataPath(relAvID)
		if !filelock.IsExist(relAvJSONPath) {
			continue
		}

		if copyErr := filelock.Copy(relAvJSONPath, filepath.Join(exportStorageAvDir, relAvID+".json")); nil != copyErr {
			logging.LogErrorf("copy av json failed: %s", copyErr)
		}
	}
}

func walkRelationAvs(avID string, exportAvIDs *hashset.Set) {
	if exportAvIDs.Contains(avID) {
		return
	}

	attrView, _ := av.ParseAttributeView(avID)
	if nil == attrView {
		return
	}

	exportAvIDs.Add(avID)
	for _, keyValues := range attrView.KeyValues {
		switch keyValues.Key.Type {
		case av.KeyTypeRelation: // 导出关联列
			if nil == keyValues.Key.Relation {
				break
			}

			walkRelationAvs(keyValues.Key.Relation.AvID, exportAvIDs)
		}
	}
}

func ExportMarkdownContent(id string, refMode, embedMode int, addYfm, fillCSSVar, adjustHeadingLv, imgTag, addTitle bool) (hPath, exportedMd string) {
	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return
	}

	tree := prepareExportTree(bt)
	hPath = tree.HPath
	exportedMd = exportMarkdownContent0(id, tree, "", false, adjustHeadingLv, imgTag,
		".md", refMode, embedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		addTitle, Conf.Export.InlineMemo, nil, true, fillCSSVar, map[string]*parse.Tree{})
	docIAL := parse.IAL2Map(tree.Root.KramdownIAL)
	if addYfm {
		exportedMd = yfm(docIAL) + exportedMd
	}
	return
}

func exportMarkdownContent(id, ext string, exportRefMode int, defBlockIDs []string, singleFile bool, treeCache map[string]*parse.Tree) (tree *parse.Tree, exportedMd string, isEmpty bool) {
	tree, err := loadTreeWithCache(id, treeCache)
	if err != nil {
		logging.LogErrorf("load tree by block id [%s] failed: %s", id, err)
		return
	}

	refCount := sql.QueryRootChildrenRefCount(tree.ID)
	if !Conf.Export.MarkdownYFM && treenode.ContainOnlyDefaultIAL(tree) && 1 > len(refCount) {
		for c := tree.Root.FirstChild; nil != c; c = c.Next {
			if ast.NodeParagraph == c.Type {
				isEmpty = nil == c.FirstChild
				if !isEmpty {
					break
				}
			} else {
				isEmpty = false
				break
			}
		}
	}

	exportedMd = exportMarkdownContent0(id, tree, "", false, false, false,
		ext, exportRefMode, Conf.Export.BlockEmbedMode, Conf.Export.FileAnnotationRefMode,
		Conf.Export.TagOpenMarker, Conf.Export.TagCloseMarker,
		Conf.Export.BlockRefTextLeft, Conf.Export.BlockRefTextRight,
		Conf.Export.AddTitle, Conf.Export.InlineMemo, defBlockIDs, singleFile, false, treeCache)
	docIAL := parse.IAL2Map(tree.Root.KramdownIAL)
	if Conf.Export.MarkdownYFM {
		// 导出 Markdown 时在文档头添加 YFM 开关 https://github.com/siyuan-note/siyuan/issues/7727
		exportedMd = yfm(docIAL) + exportedMd
	}
	return
}

func exportMarkdownContent0(id string, tree *parse.Tree, cloudAssetsBase string, assetsDestSpace2Underscore, adjustHeadingLv, imgTag bool,
	ext string, blockRefMode, blockEmbedMode, fileAnnotationRefMode int,
	tagOpenMarker, tagCloseMarker string, blockRefTextLeft, blockRefTextRight string,
	addTitle, inlineMemo bool, defBlockIDs []string, singleFile, fillCSSVar bool, treeCache map[string]*parse.Tree) (ret string) {
	tree = exportTree(tree, false, false, false,
		blockRefMode, blockEmbedMode, fileAnnotationRefMode,
		tagOpenMarker, tagCloseMarker,
		blockRefTextLeft, blockRefTextRight,
		addTitle, inlineMemo, 0 < len(defBlockIDs), singleFile, treeCache)
	if adjustHeadingLv {
		bt := treenode.GetBlockTree(id)
		adjustHeadingLevel(bt, tree)
	}

	luteEngine := NewLute()
	luteEngine.SetFootnotes(true)
	luteEngine.SetKramdownIAL(false)
	if "" != cloudAssetsBase {
		luteEngine.RenderOptions.LinkBase = cloudAssetsBase
	}
	if assetsDestSpace2Underscore { // 上传到社区图床的资源文件会将空格转为下划线，所以这里也需要将文档内容做相应的转换
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if ast.NodeLinkDest == n.Type {
				if util.IsAssetLinkDest(n.Tokens, false) {
					n.Tokens = bytes.ReplaceAll(n.Tokens, []byte(" "), []byte("_"))
				}
			} else if n.IsTextMarkType("a") {
				href := n.TextMarkAHref
				if util.IsAssetLinkDest([]byte(href), false) {
					n.TextMarkAHref = strings.ReplaceAll(href, " ", "_")
				}
			} else if ast.NodeIFrame == n.Type || ast.NodeAudio == n.Type || ast.NodeVideo == n.Type {
				dest := treenode.GetNodeSrcTokens(n)
				if util.IsAssetLinkDest([]byte(dest), false) {
					setAssetsLinkDest(n, dest, strings.ReplaceAll(dest, " ", "_"))
				}
			}
			return ast.WalkContinue
		})
	}

	currentDocDir := path.Dir(tree.HPath)
	currentDocDir = util.FilterFilePath(currentDocDir)

	var unlinks []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeBr == n.Type {
			if !n.ParentIs(ast.NodeTableCell) {
				// When exporting Markdown, `<br />` nodes in non-tables are replaced with `\n` text nodes https://github.com/siyuan-note/siyuan/issues/9509
				n.InsertBefore(&ast.Node{Type: ast.NodeText, Tokens: []byte("\n")})
				unlinks = append(unlinks, n)
			}
		}

		if 4 == blockRefMode { // 脚注+锚点哈希
			if n.IsBlock() && gulu.Str.Contains(n.ID, defBlockIDs) {
				// 如果是定义块，则在开头处添加锚点
				anchorSpan := treenode.NewSpanAnchor(n.ID)
				if ast.NodeDocument != n.Type {
					firstLeaf := treenode.FirstLeafBlock(n)
					if nil != firstLeaf {
						if ast.NodeTable == firstLeaf.Type {
							firstLeaf.InsertBefore(anchorSpan)
							firstLeaf.InsertBefore(&ast.Node{Type: ast.NodeHardBreak})
						} else {
							if nil != firstLeaf.FirstChild {
								firstLeaf.FirstChild.InsertBefore(anchorSpan)
							} else {
								firstLeaf.AppendChild(anchorSpan)
							}
						}
					} else {
						n.AppendChild(anchorSpan)
					}
				}
			}

			if treenode.IsBlockRef(n) {
				// 如果是引用元素，则将其转换为超链接，指向 xxx.md#block-id
				defID, linkText := getExportBlockRefLinkText(n, blockRefTextLeft, blockRefTextRight)
				if gulu.Str.Contains(defID, defBlockIDs) {
					var href string
					bt := treenode.GetBlockTree(defID)
					if nil != bt {
						href += bt.HPath + ext
						if "d" != bt.Type {
							href += "#" + defID
						}
						if tree.ID == bt.RootID {
							href = "#" + defID
						}
					}

					sameDir := path.Dir(href) == currentDocDir
					if strings.HasPrefix(href, "#") {
						sameDir = true
					}
					href = util.FilterFilePath(href)
					if !sameDir {
						var relErr error
						href, relErr = filepath.Rel(currentDocDir, href)
						if nil != relErr {
							logging.LogWarnf("get relative path from [%s] to [%s] failed: %s", currentDocDir, href, relErr)
						}
						href = filepath.ToSlash(href)
					} else {
						href = strings.TrimPrefix(href, currentDocDir+"/")
					}
					blockRefLink := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkTextContent: linkText, TextMarkAHref: href}
					blockRefLink.KramdownIAL = n.KramdownIAL
					n.InsertBefore(blockRefLink)
					unlinks = append(unlinks, n)
				}
			}
		}
		return ast.WalkContinue
	})
	for _, unlink := range unlinks {
		unlink.Unlink()
	}

	if fillCSSVar {
		fillThemeStyleVar(tree)
	}

	luteEngine.SetUnorderedListMarker("-")
	luteEngine.SetImgTag(imgTag)
	renderer := render.NewProtyleExportMdRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	ret = gulu.Str.FromBytes(renderer.Render())
	return
}

func exportTree(tree *parse.Tree, wysiwyg, keepFold, avHiddenCol bool,
	blockRefMode, blockEmbedMode, fileAnnotationRefMode int,
	tagOpenMarker, tagCloseMarker string,
	blockRefTextLeft, blockRefTextRight string,
	addTitle, inlineMemo, addDocAnchorSpan, singleFile bool, treeCache map[string]*parse.Tree) (ret *parse.Tree) {
	luteEngine := NewLute()
	ret = tree
	id := tree.Root.ID
	treeCache[tree.ID] = tree

	// 解析查询嵌入节点
	depth := 0
	resolveEmbedR(ret.Root, blockEmbedMode, luteEngine, &[]string{}, &depth)

	// 将块超链接转换为引用
	depth = 0
	blockLink2Ref(ret, ret.ID, treeCache, &depth)

	// 收集引用转脚注+锚点哈希
	var refFootnotes []*refAsFootnotes
	if 4 == blockRefMode && singleFile {
		depth = 0
		collectFootnotesDefs(ret, ret.ID, &refFootnotes, treeCache, &depth)
	}

	currentTreeNodeIDs := map[string]bool{}
	ast.Walk(ret.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if "" != n.ID {
			currentTreeNodeIDs[n.ID] = true
		}
		return ast.WalkContinue
	})

	var unlinks []*ast.Node
	ast.Walk(ret.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		switch n.Type {
		case ast.NodeSuperBlockOpenMarker, ast.NodeSuperBlockLayoutMarker, ast.NodeSuperBlockCloseMarker:
			if !wysiwyg {
				unlinks = append(unlinks, n)
				return ast.WalkContinue
			}
		case ast.NodeHeading:
			n.SetIALAttr("id", n.ID)
		case ast.NodeMathBlockContent:
			n.Tokens = bytes.TrimSpace(n.Tokens) // 导出 Markdown 时去除公式内容中的首尾空格 https://github.com/siyuan-note/siyuan/issues/4666
			return ast.WalkContinue
		case ast.NodeTextMark:
			if n.IsTextMarkType("inline-memo") {
				if !inlineMemo {
					n.TextMarkInlineMemoContent = ""
				}
			}

			if n.IsTextMarkType("inline-math") {
				n.TextMarkInlineMathContent = strings.TrimSpace(n.TextMarkInlineMathContent)
				return ast.WalkContinue
			} else if treenode.IsFileAnnotationRef(n) {
				refID := n.TextMarkFileAnnotationRefID
				if !strings.Contains(refID, "/") {
					return ast.WalkSkipChildren
				}

				status := processFileAnnotationRef(refID, n, fileAnnotationRefMode)
				unlinks = append(unlinks, n)
				return status
			} else if n.IsTextMarkType("tag") {
				if !wysiwyg {
					n.Type = ast.NodeText
					n.Tokens = []byte(tagOpenMarker + n.TextMarkTextContent + tagCloseMarker)
					return ast.WalkContinue
				}
			}
		}

		if !treenode.IsBlockRef(n) {
			return ast.WalkContinue
		}

		// 处理引用节点
		defID, linkText := getExportBlockRefLinkText(n, blockRefTextLeft, blockRefTextRight)

		switch blockRefMode {
		case 2: // 锚文本块链
			blockRefLink := &ast.Node{Type: ast.NodeTextMark, TextMarkTextContent: linkText, TextMarkAHref: "siyuan://blocks/" + defID}
			blockRefLink.KramdownIAL = n.KramdownIAL
			blockRefLink.TextMarkType = "a " + n.TextMarkType
			blockRefLink.TextMarkInlineMemoContent = n.TextMarkInlineMemoContent
			n.InsertBefore(blockRefLink)
			unlinks = append(unlinks, n)
		case 3: // 仅锚文本
			blockRefLink := &ast.Node{Type: ast.NodeTextMark, TextMarkType: strings.TrimSpace(strings.ReplaceAll(n.TextMarkType, "block-ref", "")), TextMarkTextContent: linkText}
			blockRefLink.KramdownIAL = n.KramdownIAL
			blockRefLink.TextMarkInlineMemoContent = n.TextMarkInlineMemoContent
			n.InsertBefore(blockRefLink)
			unlinks = append(unlinks, n)
		case 4: // 脚注+锚点哈希
			if currentTreeNodeIDs[defID] {
				// 当前文档内不转换脚注，直接使用锚点哈希 https://github.com/siyuan-note/siyuan/issues/13283
				n.TextMarkType = "a " + n.TextMarkType
				n.TextMarkTextContent = linkText
				n.TextMarkAHref = "#" + defID
				return ast.WalkContinue
			}

			refFoot := getRefAsFootnotes(defID, &refFootnotes)
			if nil == refFoot {
				return ast.WalkContinue
			}

			text := &ast.Node{Type: ast.NodeText, Tokens: []byte(linkText)}
			if "block-ref" != n.TextMarkType {
				text.Type = ast.NodeTextMark
				text.TextMarkType = strings.TrimSpace(strings.ReplaceAll(n.TextMarkType, "block-ref", ""))
				text.TextMarkTextContent = linkText
				text.TextMarkInlineMemoContent = n.TextMarkInlineMemoContent
			}
			n.InsertBefore(text)
			n.InsertBefore(&ast.Node{Type: ast.NodeFootnotesRef, Tokens: []byte("^" + refFoot.refNum), FootnotesRefId: refFoot.refNum, FootnotesRefLabel: []byte("^" + refFoot.refNum)})
			unlinks = append(unlinks, n)
		}
		return ast.WalkSkipChildren
	})
	for _, n := range unlinks {
		n.Unlink()
	}

	if 4 == blockRefMode { // 脚注+锚点哈希
		unlinks = nil
		footnotesDefBlock := resolveFootnotesDefs(&refFootnotes, ret, currentTreeNodeIDs, blockRefTextLeft, blockRefTextRight, treeCache)
		if nil != footnotesDefBlock {
			// 如果是聚焦导出，可能存在没有使用的脚注定义块，在这里进行清理
			// Improve focus export conversion of block refs to footnotes https://github.com/siyuan-note/siyuan/issues/10647
			footnotesRefs := ret.Root.ChildrenByType(ast.NodeFootnotesRef)
			for footnotesDef := footnotesDefBlock.FirstChild; nil != footnotesDef; footnotesDef = footnotesDef.Next {
				fnRefsInDef := footnotesDef.ChildrenByType(ast.NodeFootnotesRef)
				footnotesRefs = append(footnotesRefs, fnRefsInDef...)
			}

			for footnotesDef := footnotesDefBlock.FirstChild; nil != footnotesDef; footnotesDef = footnotesDef.Next {
				exist := false
				for _, ref := range footnotesRefs {
					if ref.FootnotesRefId == footnotesDef.FootnotesRefId {
						exist = true
						break
					}
				}
				if !exist {
					unlinks = append(unlinks, footnotesDef)
				}
			}

			for _, n := range unlinks {
				n.Unlink()
			}

			ret.Root.AppendChild(footnotesDefBlock)
		}
	}

	if addTitle {
		if root, _ := getBlock(id, tree); nil != root {
			root.IAL["type"] = "doc"
			title := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1}
			for k, v := range root.IAL {
				if "type" == k || "style" == k {
					continue
				}
				title.SetIALAttr(k, v)
			}
			title.InsertAfter(&ast.Node{Type: ast.NodeKramdownBlockIAL, Tokens: parse.IAL2Tokens(title.KramdownIAL)})
			content := html.UnescapeString(root.Content)
			title.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(content)})
			ret.Root.PrependChild(title)
		}
	} else {
		if 4 == blockRefMode { // 脚注+锚点哈希
			refRoot := false

			for _, refFoot := range refFootnotes {
				if id == refFoot.defID {
					refRoot = true
					break
				}
			}

			footnotesDefs := tree.Root.ChildrenByType(ast.NodeFootnotesDef)
			for _, footnotesDef := range footnotesDefs {
				ast.Walk(footnotesDef, func(n *ast.Node, entering bool) ast.WalkStatus {
					if !entering {
						return ast.WalkContinue
					}

					if id == n.TextMarkBlockRefID {
						refRoot = true
						return ast.WalkStop
					}
					return ast.WalkContinue
				})
			}

			if refRoot && addDocAnchorSpan {
				anchorSpan := treenode.NewSpanAnchor(id)
				ret.Root.PrependChild(anchorSpan)
			}
		}
	}

	// 导出时支持导出题头图 https://github.com/siyuan-note/siyuan/issues/4372
	titleImgPath := treenode.GetDocTitleImgPath(ret.Root)
	if "" != titleImgPath {
		p := &ast.Node{Type: ast.NodeParagraph}
		titleImg := &ast.Node{Type: ast.NodeImage}
		titleImg.AppendChild(&ast.Node{Type: ast.NodeBang})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte("image")})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(titleImgPath)})
		titleImg.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
		p.AppendChild(titleImg)
		ret.Root.PrependChild(p)
	}

	unlinks = nil
	var emptyParagraphs []*ast.Node
	ast.Walk(ret.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		// 支持按照现有折叠状态导出 PDF https://github.com/siyuan-note/siyuan/issues/5941
		if !keepFold {
			// 块折叠以后导出 HTML/PDF 固定展开 https://github.com/siyuan-note/siyuan/issues/4064
			n.RemoveIALAttr("fold")
			n.RemoveIALAttr("heading-fold")
		} else {
			if "1" == n.IALAttr("heading-fold") {
				unlinks = append(unlinks, n)
				return ast.WalkContinue
			}
		}

		// 导出时去掉内容块闪卡样式 https://github.com/siyuan-note/siyuan/issues/7374
		if n.IsBlock() {
			n.RemoveIALAttr(NodeAttrRiffDecks)
		}

		switch n.Type {
		case ast.NodeParagraph:
			if nil == n.FirstChild {
				// 空的段落块需要补全文本展位，否则后续格式化后再解析树会语义不一致 https://github.com/siyuan-note/siyuan/issues/5806
				emptyParagraphs = append(emptyParagraphs, n)
			}
		case ast.NodeWidget:
			// 挂件块导出 https://github.com/siyuan-note/siyuan/issues/3834 https://github.com/siyuan-note/siyuan/issues/6188

			if wysiwyg {
				exportHtmlVal := n.IALAttr("data-export-html")
				if "" != exportHtmlVal {
					htmlBlock := &ast.Node{Type: ast.NodeHTMLBlock, Tokens: []byte(exportHtmlVal)}
					n.InsertBefore(htmlBlock)
					unlinks = append(unlinks, n)
					return ast.WalkContinue
				}
			}

			exportMdVal := n.IALAttr("data-export-md")
			exportMdVal = html.UnescapeString(exportMdVal) // 导出 `data-export-md` 时未解析代码块与行内代码内的转义字符 https://github.com/siyuan-note/siyuan/issues/4180
			if "" != exportMdVal {
				luteEngine0 := util.NewLute()
				luteEngine0.SetYamlFrontMatter(true) // 挂件导出属性 `data-export-md` 支持 YFM https://github.com/siyuan-note/siyuan/issues/7752
				exportMdTree := parse.Parse("", []byte(exportMdVal), luteEngine0.ParseOptions)
				var insertNodes []*ast.Node
				for c := exportMdTree.Root.FirstChild; nil != c; c = c.Next {
					if ast.NodeKramdownBlockIAL != c.Type {
						insertNodes = append(insertNodes, c)
					}
				}
				for _, insertNode := range insertNodes {
					n.InsertBefore(insertNode)
				}
				unlinks = append(unlinks, n)
			}
		case ast.NodeSuperBlockOpenMarker, ast.NodeSuperBlockLayoutMarker, ast.NodeSuperBlockCloseMarker:
			if !wysiwyg {
				unlinks = append(unlinks, n)
			}
		}

		if ast.NodeText != n.Type {
			return ast.WalkContinue
		}

		// Shift+Enter 换行在导出为 Markdown 时使用硬换行 https://github.com/siyuan-note/siyuan/issues/3458
		n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("\n"), []byte("  \n"))
		return ast.WalkContinue
	})
	for _, n := range unlinks {
		n.Unlink()
	}
	for _, emptyParagraph := range emptyParagraphs {
		emptyParagraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(editor.Zwj)})
	}

	unlinks = nil
	// Attribute View export https://github.com/siyuan-note/siyuan/issues/8710
	ast.Walk(ret.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeAttributeView != n.Type {
			return ast.WalkContinue
		}

		avID := n.AttributeViewID
		if avJSONPath := av.GetAttributeViewDataPath(avID); !filelock.IsExist(avJSONPath) {
			return ast.WalkContinue
		}

		attrView, err := av.ParseAttributeView(avID)
		if err != nil {
			logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
			return ast.WalkContinue
		}

		viewID := n.IALAttr(av.NodeAttrView)
		view, err := attrView.GetCurrentView(viewID)
		if err != nil {
			logging.LogErrorf("get attribute view [%s] failed: %s", avID, err)
			return ast.WalkContinue
		}

		table := getAttrViewTable(attrView, view, "")

		// 遵循视图过滤和排序规则 Use filtering and sorting of current view settings when exporting database blocks https://github.com/siyuan-note/siyuan/issues/10474
		cachedAttrViews := map[string]*av.AttributeView{}
		rollupFurtherCollections := sql.GetFurtherCollections(attrView, cachedAttrViews)
		av.Filter(table, attrView, rollupFurtherCollections, cachedAttrViews)
		av.Sort(table, attrView)

		var aligns []int
		for range table.Columns {
			aligns = append(aligns, 0)
		}
		mdTable := &ast.Node{Type: ast.NodeTable, TableAligns: aligns}
		mdTableHead := &ast.Node{Type: ast.NodeTableHead}
		mdTable.AppendChild(mdTableHead)
		mdTableHeadRow := &ast.Node{Type: ast.NodeTableRow, TableAligns: aligns}
		mdTableHead.AppendChild(mdTableHeadRow)
		for _, col := range table.Columns {
			if avHiddenCol && col.Hidden {
				// 按需跳过隐藏列 Improve database table view exporting https://github.com/siyuan-note/siyuan/issues/12232
				continue
			}

			cell := &ast.Node{Type: ast.NodeTableCell}
			name := col.Name
			if !wysiwyg {
				name = string(lex.EscapeProtyleMarkers([]byte(col.Name)))
				name = strings.ReplaceAll(name, "\\|", "|")
				name = strings.ReplaceAll(name, "|", "\\|")
			}
			cell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(name)})
			mdTableHeadRow.AppendChild(cell)
		}

		rowNum := 1
		for _, row := range table.Rows {
			mdTableRow := &ast.Node{Type: ast.NodeTableRow, TableAligns: aligns}
			mdTable.AppendChild(mdTableRow)
			for _, cell := range row.Cells {
				if avHiddenCol && nil != cell.Value {
					if col := table.GetColumn(cell.Value.KeyID); nil != col && col.Hidden {
						continue
					}
				}

				mdTableCell := &ast.Node{Type: ast.NodeTableCell}
				mdTableRow.AppendChild(mdTableCell)
				var val string
				if nil != cell.Value {
					if av.KeyTypeBlock == cell.Value.Type {
						if nil != cell.Value.Block {
							val = cell.Value.Block.Content
							if !wysiwyg {
								val = string(lex.EscapeProtyleMarkers([]byte(val)))
								val = strings.ReplaceAll(val, "\\|", "|")
								val = strings.ReplaceAll(val, "|", "\\|")
							}
							col := table.GetColumn(cell.Value.KeyID)
							if nil != col && col.Wrap {
								lines := strings.Split(val, "\n")
								for _, line := range lines {
									mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(line)})
									mdTableCell.AppendChild(&ast.Node{Type: ast.NodeHardBreak})
								}
							} else {
								val = strings.ReplaceAll(val, "\n", " ")
								mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(val)})
							}
							continue
						}
					} else if av.KeyTypeText == cell.Value.Type {
						if nil != cell.Value.Text {
							val = cell.Value.Text.Content
							if !wysiwyg {
								val = string(lex.EscapeProtyleMarkers([]byte(val)))
								val = strings.ReplaceAll(val, "\\|", "|")
								val = strings.ReplaceAll(val, "|", "\\|")
							}
							col := table.GetColumn(cell.Value.KeyID)
							if nil != col && col.Wrap {
								lines := strings.Split(val, "\n")
								for _, line := range lines {
									mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(line)})
									mdTableCell.AppendChild(&ast.Node{Type: ast.NodeHardBreak})
								}
							} else {
								val = strings.ReplaceAll(val, "\n", " ")
								mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(val)})
							}
							continue
						}
					} else if av.KeyTypeTemplate == cell.Value.Type {
						if nil != cell.Value.Template {
							val = cell.Value.Template.Content
							val = strings.ReplaceAll(val, "\\|", "|")
							val = strings.ReplaceAll(val, "|", "\\|")
							col := table.GetColumn(cell.Value.KeyID)
							if nil != col && col.Wrap {
								lines := strings.Split(val, "\n")
								for _, line := range lines {
									mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(line)})
									mdTableCell.AppendChild(&ast.Node{Type: ast.NodeHardBreak})
								}
							} else {
								val = strings.ReplaceAll(val, "\n", " ")
								mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(val)})
							}
							continue
						}
					} else if av.KeyTypeDate == cell.Value.Type {
						if nil != cell.Value.Date {
							cell.Value.Date = av.NewFormattedValueDate(cell.Value.Date.Content, cell.Value.Date.Content2, av.DateFormatNone, cell.Value.Date.IsNotTime, cell.Value.Date.HasEndDate)
						}
					} else if av.KeyTypeCreated == cell.Value.Type {
						if nil != cell.Value.Created {
							key, _ := attrView.GetKey(cell.Value.KeyID)
							isNotTime := false
							if nil != key && nil != key.Created {
								isNotTime = !key.Created.IncludeTime
							}

							cell.Value.Created = av.NewFormattedValueCreated(cell.Value.Created.Content, 0, av.CreatedFormatNone, isNotTime)
						}
					} else if av.KeyTypeUpdated == cell.Value.Type {
						if nil != cell.Value.Updated {
							key, _ := attrView.GetKey(cell.Value.KeyID)
							isNotTime := false
							if nil != key && nil != key.Updated {
								isNotTime = !key.Updated.IncludeTime
							}

							cell.Value.Updated = av.NewFormattedValueUpdated(cell.Value.Updated.Content, 0, av.UpdatedFormatNone, isNotTime)
						}
					} else if av.KeyTypeURL == cell.Value.Type {
						if nil != cell.Value.URL {
							if "" != strings.TrimSpace(cell.Value.URL.Content) {
								link := &ast.Node{Type: ast.NodeLink}
								link.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
								link.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(cell.Value.URL.Content)})
								link.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
								link.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
								link.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(cell.Value.URL.Content)})
								link.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
								mdTableCell.AppendChild(link)
							}
							continue
						}
					} else if av.KeyTypeMAsset == cell.Value.Type {
						if nil != cell.Value.MAsset {
							for i, a := range cell.Value.MAsset {
								if av.AssetTypeImage == a.Type {
									img := &ast.Node{Type: ast.NodeImage}
									img.AppendChild(&ast.Node{Type: ast.NodeBang})
									img.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
									img.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(a.Name)})
									img.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
									img.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
									img.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(a.Content)})
									img.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
									mdTableCell.AppendChild(img)
									img.SetIALAttr("style", "max-height: 128px;")

									width, height := GetAssetImgSize(a.Content)
									if height > 128 {
										img.SetIALAttr("height", "128px")
										newWidth := int(float64(width) * (128.0 / float64(height)))
										img.SetIALAttr("width", strconv.Itoa(newWidth)+"px")
									}
								} else if av.AssetTypeFile == a.Type {
									linkText := strings.TrimSpace(a.Name)
									if "" == linkText {
										linkText = a.Content
									}

									if "" != strings.TrimSpace(a.Content) {
										file := &ast.Node{Type: ast.NodeLink}
										file.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
										file.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(linkText)})
										file.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
										file.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
										file.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(a.Content)})
										file.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
										mdTableCell.AppendChild(file)
									} else {
										mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(linkText)})
									}
								}
								if i < len(cell.Value.MAsset)-1 {
									mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(" ")})
								}
							}
							continue
						}
					} else if av.KeyTypeLineNumber == cell.Value.Type {
						val = strconv.Itoa(rowNum)
						rowNum++
					} else if av.KeyTypeRelation == cell.Value.Type {
						for i, v := range cell.Value.Relation.Contents {
							if nil == v {
								continue
							}

							if av.KeyTypeBlock == v.Type && nil != v.Block {
								val = v.Block.Content
								if !wysiwyg {
									val = string(lex.EscapeProtyleMarkers([]byte(val)))
									val = strings.ReplaceAll(val, "\\|", "|")
									val = strings.ReplaceAll(val, "|", "\\|")
								}

								col := table.GetColumn(cell.Value.KeyID)
								if nil != col && col.Wrap {
									lines := strings.Split(val, "\n")
									for _, line := range lines {
										mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(line)})
										mdTableCell.AppendChild(&ast.Node{Type: ast.NodeHardBreak})
									}
								} else {
									val = strings.ReplaceAll(val, "\n", " ")
									mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(val)})
								}
							}
							if i < len(cell.Value.Relation.Contents)-1 {
								mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(", ")})
							}
						}
						continue
					} else if av.KeyTypeRollup == cell.Value.Type {
						for i, v := range cell.Value.Rollup.Contents {
							if nil == v {
								continue
							}

							if av.KeyTypeBlock == v.Type {
								if nil != v.Block {
									val = v.Block.Content
									if !wysiwyg {
										val = string(lex.EscapeProtyleMarkers([]byte(val)))
										val = strings.ReplaceAll(val, "\\|", "|")
										val = strings.ReplaceAll(val, "|", "\\|")
									}

									col := table.GetColumn(cell.Value.KeyID)
									if nil != col && col.Wrap {
										lines := strings.Split(val, "\n")
										for _, line := range lines {
											mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(line)})
											mdTableCell.AppendChild(&ast.Node{Type: ast.NodeHardBreak})
										}
									} else {
										val = strings.ReplaceAll(val, "\n", " ")
										mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(val)})
									}
								}
							} else if av.KeyTypeText == v.Type {
								val = v.Text.Content
								if !wysiwyg {
									val = string(lex.EscapeProtyleMarkers([]byte(val)))
									val = strings.ReplaceAll(val, "\\|", "|")
									val = strings.ReplaceAll(val, "|", "\\|")
								}

								col := table.GetColumn(cell.Value.KeyID)
								if nil != col && col.Wrap {
									lines := strings.Split(val, "\n")
									for _, line := range lines {
										mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(line)})
										mdTableCell.AppendChild(&ast.Node{Type: ast.NodeHardBreak})
									}
								} else {
									val = strings.ReplaceAll(val, "\n", " ")
									mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(val)})
								}
							} else {
								mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(v.String(true))})
							}

							if i < len(cell.Value.Rollup.Contents)-1 {
								mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(", ")})
							}
						}
						continue
					}

					if "" == val {
						val = cell.Value.String(true)
					}
				}
				mdTableCell.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(val)})
			}
		}

		n.InsertBefore(mdTable)
		unlinks = append(unlinks, n)
		return ast.WalkContinue
	})
	for _, n := range unlinks {
		n.Unlink()
	}
	return ret
}

func resolveFootnotesDefs(refFootnotes *[]*refAsFootnotes, currentTree *parse.Tree, currentTreeNodeIDs map[string]bool, blockRefTextLeft, blockRefTextRight string, treeCache map[string]*parse.Tree) (footnotesDefBlock *ast.Node) {
	if 1 > len(*refFootnotes) {
		return nil
	}

	footnotesDefBlock = &ast.Node{Type: ast.NodeFootnotesDefBlock}
	var rendered []string
	for _, foot := range *refFootnotes {
		t, err := loadTreeWithCache(foot.defID, treeCache)
		if nil != err {
			return
		}

		defNode := treenode.GetNodeInTree(t, foot.defID)
		docID := util.GetTreeID(defNode.Path)
		var nodes []*ast.Node
		if ast.NodeHeading == defNode.Type {
			nodes = append(nodes, defNode)
			if currentTree.ID != docID {
				// 同文档块引转脚注缩略定义考虑容器块和标题块 https://github.com/siyuan-note/siyuan/issues/5917
				children := treenode.HeadingChildren(defNode)
				nodes = append(nodes, children...)
			}
		} else if ast.NodeDocument == defNode.Type {
			docTitle := &ast.Node{ID: defNode.ID, Type: ast.NodeHeading, HeadingLevel: 1}
			docTitle.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(defNode.IALAttr("title"))})
			nodes = append(nodes, docTitle)
			for c := defNode.FirstChild; nil != c; c = c.Next {
				nodes = append(nodes, c)
			}
		} else {
			nodes = append(nodes, defNode)
		}

		var newNodes []*ast.Node
		for _, node := range nodes {
			var unlinks []*ast.Node

			ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}

				if treenode.IsBlockRef(n) {
					defID, _, _ := treenode.GetBlockRef(n)
					if f := getRefAsFootnotes(defID, refFootnotes); nil != f {
						n.InsertBefore(&ast.Node{Type: ast.NodeText, Tokens: []byte(blockRefTextLeft + f.refAnchorText + blockRefTextRight)})
						n.InsertBefore(&ast.Node{Type: ast.NodeFootnotesRef, Tokens: []byte("^" + f.refNum), FootnotesRefId: f.refNum, FootnotesRefLabel: []byte("^" + f.refNum)})
						unlinks = append(unlinks, n)
					} else {
						if isNodeInTree(defID, currentTree) {
							if currentTreeNodeIDs[defID] {
								// 当前文档内不转换脚注，直接使用锚点哈希 https://github.com/siyuan-note/siyuan/issues/13283
								n.TextMarkType = "a"
								n.TextMarkTextContent = blockRefTextLeft + n.TextMarkTextContent + blockRefTextRight
								n.TextMarkAHref = "#" + defID
								return ast.WalkSkipChildren
							}
						}
					}
					return ast.WalkSkipChildren
				} else if ast.NodeBlockQueryEmbed == n.Type {
					stmt := n.ChildByType(ast.NodeBlockQueryEmbedScript).TokensStr()
					stmt = html.UnescapeString(stmt)
					stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")
					sqlBlocks := sql.SelectBlocksRawStmt(stmt, 1, Conf.Search.Limit)
					for _, b := range sqlBlocks {
						subNodes := renderBlockMarkdownR(b.ID, &rendered)
						for _, subNode := range subNodes {
							if ast.NodeListItem == subNode.Type {
								parentList := &ast.Node{Type: ast.NodeList, ListData: &ast.ListData{Typ: subNode.ListData.Typ}}
								parentList.AppendChild(subNode)
								newNodes = append(newNodes, parentList)
							} else {
								newNodes = append(newNodes, subNode)
							}
						}
					}
					unlinks = append(unlinks, n)
					return ast.WalkSkipChildren
				}
				return ast.WalkContinue
			})
			for _, n := range unlinks {
				n.Unlink()
			}

			if ast.NodeBlockQueryEmbed != node.Type {
				if ast.NodeListItem == node.Type {
					parentList := &ast.Node{Type: ast.NodeList, ListData: &ast.ListData{Typ: node.ListData.Typ}}
					parentList.AppendChild(node)
					newNodes = append(newNodes, parentList)
				} else {
					newNodes = append(newNodes, node)
				}
			}
		}

		footnotesDef := &ast.Node{Type: ast.NodeFootnotesDef, Tokens: []byte("^" + foot.refNum), FootnotesRefId: foot.refNum, FootnotesRefLabel: []byte("^" + foot.refNum)}
		for _, node := range newNodes {
			ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}
				if ast.NodeParagraph != n.Type {
					return ast.WalkContinue
				}

				docID := util.GetTreeID(n.Path)
				if currentTree.ID == docID {
					// 同文档块引转脚注缩略定义 https://github.com/siyuan-note/siyuan/issues/3299
					if text := sql.GetRefText(n.ID); 64 < utf8.RuneCountInString(text) {
						var unlinkChildren []*ast.Node
						for c := n.FirstChild; nil != c; c = c.Next {
							unlinkChildren = append(unlinkChildren, c)
						}
						for _, c := range unlinkChildren {
							c.Unlink()
						}
						text = gulu.Str.SubStr(text, 64) + "..."
						n.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(text)})
						return ast.WalkSkipChildren
					}
				}
				return ast.WalkContinue
			})

			footnotesDef.AppendChild(node)
		}
		footnotesDefBlock.AppendChild(footnotesDef)
	}
	return
}

func blockLink2Ref(currentTree *parse.Tree, id string, treeCache map[string]*parse.Tree, depth *int) {
	*depth++
	if 4096 < *depth {
		return
	}

	b := treenode.GetBlockTree(id)
	if nil == b {
		return
	}
	t, err := loadTreeWithCache(b.RootID, treeCache)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(t, b.ID)
	if nil == node {
		logging.LogErrorf("not found node [%s] in tree [%s]", b.ID, t.Root.ID)
		return
	}
	blockLink2Ref0(currentTree, node, treeCache, depth)
	if ast.NodeHeading == node.Type {
		children := treenode.HeadingChildren(node)
		for _, c := range children {
			blockLink2Ref0(currentTree, c, treeCache, depth)
		}
	}
	return
}

func blockLink2Ref0(currentTree *parse.Tree, node *ast.Node, treeCache map[string]*parse.Tree, depth *int) {
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if treenode.IsBlockLink(n) {
			n.TextMarkType = strings.TrimSpace(strings.TrimPrefix(n.TextMarkType, "a") + " block-ref")
			n.TextMarkBlockRefID = strings.TrimPrefix(n.TextMarkAHref, "siyuan://blocks/")
			n.TextMarkBlockRefSubtype = "s"

			blockLink2Ref(currentTree, n.TextMarkBlockRefID, treeCache, depth)
			return ast.WalkSkipChildren
		} else if treenode.IsBlockRef(n) {
			defID, _, _ := treenode.GetBlockRef(n)
			blockLink2Ref(currentTree, defID, treeCache, depth)
		}
		return ast.WalkContinue
	})
}

func collectFootnotesDefs(currentTree *parse.Tree, id string, refFootnotes *[]*refAsFootnotes, treeCache map[string]*parse.Tree, depth *int) {
	*depth++
	if 4096 < *depth {
		return
	}
	b := treenode.GetBlockTree(id)
	if nil == b {
		return
	}
	t, err := loadTreeWithCache(b.RootID, treeCache)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(t, b.ID)
	if nil == node {
		logging.LogErrorf("not found node [%s] in tree [%s]", b.ID, t.Root.ID)
		return
	}
	collectFootnotesDefs0(currentTree, node, refFootnotes, treeCache, depth)
	if ast.NodeHeading == node.Type {
		children := treenode.HeadingChildren(node)
		for _, c := range children {
			collectFootnotesDefs0(currentTree, c, refFootnotes, treeCache, depth)
		}
	}
	return
}

func collectFootnotesDefs0(currentTree *parse.Tree, node *ast.Node, refFootnotes *[]*refAsFootnotes, treeCache map[string]*parse.Tree, depth *int) {
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if treenode.IsBlockRef(n) {
			defID, refText, _ := treenode.GetBlockRef(n)
			if nil == getRefAsFootnotes(defID, refFootnotes) {
				if isNodeInTree(defID, currentTree) {
					// 当前文档内不转换脚注，直接使用锚点哈希 https://github.com/siyuan-note/siyuan/issues/13283
					return ast.WalkSkipChildren
				}
				anchorText := refText
				if Conf.Editor.BlockRefDynamicAnchorTextMaxLen < utf8.RuneCountInString(anchorText) {
					anchorText = gulu.Str.SubStr(anchorText, Conf.Editor.BlockRefDynamicAnchorTextMaxLen) + "..."
				}
				*refFootnotes = append(*refFootnotes, &refAsFootnotes{
					defID:         defID,
					refNum:        strconv.Itoa(len(*refFootnotes) + 1),
					refAnchorText: anchorText,
				})
				collectFootnotesDefs(currentTree, defID, refFootnotes, treeCache, depth)
			}
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
}

func isNodeInTree(id string, tree *parse.Tree) (ret bool) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if n.ID == id {
			ret = true
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	return
}

func getRefAsFootnotes(defID string, slice *[]*refAsFootnotes) *refAsFootnotes {
	for _, e := range *slice {
		if e.defID == defID {
			return e
		}
	}
	return nil
}

type refAsFootnotes struct {
	defID         string
	refNum        string
	refAnchorText string
}

func processFileAnnotationRef(refID string, n *ast.Node, fileAnnotationRefMode int) ast.WalkStatus {
	p := refID[:strings.LastIndex(refID, "/")]
	absPath, err := GetAssetAbsPath(p)
	if err != nil {
		logging.LogWarnf("get assets abs path by rel path [%s] failed: %s", p, err)
		return ast.WalkSkipChildren
	}
	sya := absPath + ".sya"
	syaData, err := os.ReadFile(sya)
	if err != nil {
		logging.LogErrorf("read file [%s] failed: %s", sya, err)
		return ast.WalkSkipChildren
	}
	syaJSON := map[string]interface{}{}
	if err = gulu.JSON.UnmarshalJSON(syaData, &syaJSON); err != nil {
		logging.LogErrorf("unmarshal file [%s] failed: %s", sya, err)
		return ast.WalkSkipChildren
	}
	annotationID := refID[strings.LastIndex(refID, "/")+1:]
	annotationData := syaJSON[annotationID]
	if nil == annotationData {
		logging.LogErrorf("not found annotation [%s] in .sya", annotationID)
		return ast.WalkSkipChildren
	}
	pages := annotationData.(map[string]interface{})["pages"].([]interface{})
	page := int(pages[0].(map[string]interface{})["index"].(float64)) + 1
	pageStr := strconv.Itoa(page)

	refText := n.TextMarkTextContent
	ext := filepath.Ext(p)
	file := p[7:len(p)-23-len(ext)] + ext
	fileAnnotationRefLink := &ast.Node{Type: ast.NodeLink}
	fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeOpenBracket})
	if 0 == fileAnnotationRefMode {
		fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(file + " - p" + pageStr + " - " + refText)})
	} else {
		fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte(refText)})
	}
	fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeCloseBracket})
	fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeOpenParen})
	dest := p + "#page=" + pageStr // https://github.com/siyuan-note/siyuan/issues/11780
	fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(dest)})
	fileAnnotationRefLink.AppendChild(&ast.Node{Type: ast.NodeCloseParen})
	n.InsertBefore(fileAnnotationRefLink)
	return ast.WalkSkipChildren
}

func exportPandocConvertZip(baseFolderName string, docPaths, defBlockIDs []string,
	pandocFrom, pandocTo, ext string, treeCache map[string]*parse.Tree) (zipPath string) {
	defer util.ClearPushProgress(100)

	dir, name := path.Split(baseFolderName)
	name = util.FilterFileName(name)
	if strings.HasSuffix(name, "..") {
		// 文档标题以 `..` 结尾时无法导出 Markdown https://github.com/siyuan-note/siyuan/issues/4698
		// 似乎是 os.MkdirAll 的 bug，以 .. 结尾的路径无法创建，所以这里加上 _ 结尾
		name += "_"
	}
	baseFolderName = path.Join(dir, name)

	exportFolder := filepath.Join(util.TempDir, "export", baseFolderName+ext)
	os.RemoveAll(exportFolder)
	if err := os.MkdirAll(exportFolder, 0755); err != nil {
		logging.LogErrorf("create export temp folder failed: %s", err)
		return
	}

	exportRefMode := Conf.Export.BlockRefMode
	wrotePathHash := map[string]string{}
	assetsPathMap, err := allAssetAbsPaths()
	if nil != err {
		logging.LogWarnf("get assets abs path failed: %s", err)
		return
	}

	assetsOldNew, assetsNewOld := map[string]string{}, map[string]string{}
	luteEngine := util.NewLute()
	for i, p := range docPaths {
		id := util.GetTreeID(p)
		tree, md, isEmpty := exportMarkdownContent(id, ext, exportRefMode, defBlockIDs, false, treeCache)
		if nil == tree {
			continue
		}
		hPath := tree.HPath
		dir, name = path.Split(hPath)
		dir = util.FilterFilePath(dir) // 导出文档时未移除不支持的文件名符号 https://github.com/siyuan-note/siyuan/issues/4590
		name = util.FilterFileName(name)
		hPath = path.Join(dir, name)
		p = hPath + ext
		if 1 == len(docPaths) {
			// 如果仅导出单个文档则使用文档标题作为文件名，不使用父路径 https://github.com/siyuan-note/siyuan/issues/13635#issuecomment-3794560233
			p = name + ext
		}

		writePath := filepath.Join(exportFolder, p)
		hash := fmt.Sprintf("%x", sha1.Sum([]byte(md)))
		if gulu.File.IsExist(writePath) && hash != wrotePathHash[writePath] {
			// 重名文档加 ID
			p = hPath + "-" + id + ext
			writePath = filepath.Join(exportFolder, p)
		}
		writeFolder := filepath.Dir(writePath)
		if err := os.MkdirAll(writeFolder, 0755); err != nil {
			logging.LogErrorf("create export temp folder [%s] failed: %s", writeFolder, err)
			continue
		}

		if isEmpty {
			entries, readErr := os.ReadDir(filepath.Join(util.DataDir, tree.Box, strings.TrimSuffix(tree.Path, ".sy")))
			if nil == readErr && 0 < len(entries) {
				// 如果文档内容为空并且存在子文档则仅导出文件夹
				// Improve export of empty documents with subdocuments https://github.com/siyuan-note/siyuan/issues/15009
				continue
			}
		}

		// 解析导出后的标准 Markdown，汇总 assets
		tree = parse.Parse("", gulu.Str.ToBytes(md), luteEngine.ParseOptions)
		removeAssetsID(tree, assetsOldNew, assetsNewOld)

		newAssets := getAssetsLinkDests(tree.Root, false)
		for _, newAsset := range newAssets {
			newAsset = string(html.DecodeDestination([]byte(newAsset)))
			if strings.Contains(newAsset, "?") {
				newAsset = newAsset[:strings.LastIndex(newAsset, "?")]
			}

			if !strings.HasPrefix(newAsset, "assets/") {
				continue
			}

			oldAsset := assetsNewOld[newAsset]
			if "" == oldAsset {
				logging.LogWarnf("get asset old path for new asset [%s] failed", newAsset)
				continue
			}

			srcPath := assetsPathMap[oldAsset]
			if "" == srcPath {
				logging.LogWarnf("get asset [%s] abs path failed", oldAsset)
				continue
			}

			destPath := filepath.Join(writeFolder, newAsset)
			if copyErr := filelock.Copy(srcPath, destPath); copyErr != nil {
				logging.LogErrorf("copy asset from [%s] to [%s] failed: %s", srcPath, destPath, err)
				continue
			}
		}

		for assetsOld, assetsNew := range assetsOldNew {
			md = strings.ReplaceAll(md, assetsOld, assetsNew)
		}

		// 调用 Pandoc 进行格式转换
		pandocErr := util.Pandoc(pandocFrom, pandocTo, writePath, md)
		if pandocErr != nil {
			logging.LogErrorf("pandoc failed: %s", pandocErr)
			continue
		}

		wrotePathHash[writePath] = hash
		util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.language(70), fmt.Sprintf("%d/%d %s", i+1, len(docPaths), name)))
	}

	zipPath = exportFolder + ".zip"
	zip, err := gulu.Zip.Create(zipPath)
	if err != nil {
		logging.LogErrorf("create export markdown zip [%s] failed: %s", exportFolder, err)
		return ""
	}

	// 导出 Markdown zip 包内不带文件夹 https://github.com/siyuan-note/siyuan/issues/6869
	entries, err := os.ReadDir(exportFolder)
	if err != nil {
		logging.LogErrorf("read export markdown folder [%s] failed: %s", exportFolder, err)
		return ""
	}

	zipCallback := func(filename string) {
		util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.language(253), filename))
	}
	for _, entry := range entries {
		entryName := entry.Name()
		entryPath := filepath.Join(exportFolder, entryName)
		if gulu.File.IsDir(entryPath) {
			err = zip.AddDirectory(entryName, entryPath, zipCallback)
		} else {
			err = zip.AddEntry(entryName, entryPath, zipCallback)
		}
		if err != nil {
			logging.LogErrorf("add entry [%s] to zip failed: %s", entryName, err)
			return ""
		}
	}

	if err = zip.Close(); err != nil {
		logging.LogErrorf("close export markdown zip failed: %s", err)
	}

	os.RemoveAll(exportFolder)
	zipPath = "/export/" + url.PathEscape(filepath.Base(zipPath))
	return
}

func removeAssetsID(tree *parse.Tree, assetsOldNew, assetsNewOld map[string]string) {
	assetNodes := getAssetsLinkDestsInTree(tree, false)
	for _, node := range assetNodes {
		dests := getAssetsLinkDests(node, false)
		if 1 > len(dests) {
			continue
		}

		for _, dest := range dests {
			if !Conf.Export.RemoveAssetsID {
				assetsOldNew[dest] = dest
				assetsNewOld[dest] = dest
				continue
			}

			if newDest := assetsOldNew[dest]; "" != newDest {
				setAssetsLinkDest(node, dest, newDest)
				continue
			}

			name := path.Base(dest)
			name = util.RemoveID(name)
			newDest := "assets/" + name
			if existOld := assetsNewOld[newDest]; "" != existOld {
				if existOld == dest { // 已存在相同资源路径
					setAssetsLinkDest(node, dest, newDest)
				} else {
					// 存在同名但内容不同的资源文件，保留 ID
					assetsNewOld[dest] = dest
					assetsOldNew[dest] = dest
				}
				continue
			}

			setAssetsLinkDest(node, dest, newDest)
			assetsOldNew[dest] = newDest
			assetsNewOld[newDest] = dest
		}
	}
}

func getExportBlockRefLinkText(blockRef *ast.Node, blockRefTextLeft, blockRefTextRight string) (defID, linkText string) {
	defID, linkText, _ = treenode.GetBlockRef(blockRef)
	if "" == linkText {
		linkText = sql.GetRefText(defID)
	}
	linkText = util.UnescapeHTML(linkText) // 块引锚文本导出时 `&` 变为实体 `&amp;` https://github.com/siyuan-note/siyuan/issues/7659
	if Conf.Editor.BlockRefDynamicAnchorTextMaxLen < utf8.RuneCountInString(linkText) {
		linkText = gulu.Str.SubStr(linkText, Conf.Editor.BlockRefDynamicAnchorTextMaxLen) + "..."
	}
	linkText = blockRefTextLeft + linkText + blockRefTextRight
	return
}

func prepareExportTrees(docPaths []string) (defBlockIDs []string, trees map[string]*parse.Tree, relatedDocPaths []string) {
	trees = map[string]*parse.Tree{}
	treeCache := map[string]*parse.Tree{}
	defBlockIDs = []string{}
	for i, p := range docPaths {
		rootID := strings.TrimSuffix(path.Base(p), ".sy")
		if !ast.IsNodeIDPattern(rootID) {
			continue
		}

		tree, err := loadTreeWithCache(rootID, treeCache)
		if err != nil {
			continue
		}
		exportRefTrees(tree, &defBlockIDs, trees, treeCache)

		util.PushEndlessProgress(Conf.language(65) + " " + fmt.Sprintf(Conf.language(70), fmt.Sprintf("%d/%d %s", i+1, len(docPaths), tree.Root.IALAttr("title"))))
	}

	for _, tree := range trees {
		relatedDocPaths = append(relatedDocPaths, tree.Path)
	}
	relatedDocPaths = gulu.Str.RemoveDuplicatedElem(relatedDocPaths)
	return
}

func exportRefTrees(tree *parse.Tree, defBlockIDs *[]string, retTrees, treeCache map[string]*parse.Tree) {
	if nil != retTrees[tree.ID] {
		return
	}
	retTrees[tree.ID] = tree

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if treenode.IsBlockRef(n) {
			defID, _, _ := treenode.GetBlockRef(n)
			if "" == defID {
				return ast.WalkContinue
			}
			defBlock := treenode.GetBlockTree(defID)
			if nil == defBlock {
				return ast.WalkSkipChildren
			}

			var defTree *parse.Tree
			var err error
			if treeCache[defBlock.RootID] != nil {
				defTree = treeCache[defBlock.RootID]
			} else {
				defTree, err = loadTreeWithCache(defBlock.RootID, treeCache)
				if err != nil {
					return ast.WalkSkipChildren
				}
				treeCache[defBlock.RootID] = defTree
			}
			*defBlockIDs = append(*defBlockIDs, defID)

			if !Conf.Export.IncludeRelatedDocs {
				return ast.WalkSkipChildren
			}
			exportRefTrees(defTree, defBlockIDs, retTrees, treeCache)
		} else if treenode.IsBlockLink(n) {
			defID := strings.TrimPrefix(n.TextMarkAHref, "siyuan://blocks/")
			if "" == defID {
				return ast.WalkContinue
			}
			defBlock := treenode.GetBlockTree(defID)
			if nil == defBlock {
				return ast.WalkSkipChildren
			}

			var defTree *parse.Tree
			var err error
			if treeCache[defBlock.RootID] != nil {
				defTree = treeCache[defBlock.RootID]
			} else {
				defTree, err = loadTreeWithCache(defBlock.RootID, treeCache)
				if err != nil {
					return ast.WalkSkipChildren
				}
				treeCache[defBlock.RootID] = defTree
			}
			*defBlockIDs = append(*defBlockIDs, defID)

			if !Conf.Export.IncludeRelatedDocs {
				return ast.WalkSkipChildren
			}
			exportRefTrees(defTree, defBlockIDs, retTrees, treeCache)
		} else if ast.NodeAttributeView == n.Type {
			// 导出数据库所在文档时一并导出绑定块所在文档
			// Export the binding block docs when exporting the doc where the database is located https://github.com/siyuan-note/siyuan/issues/11486

			avID := n.AttributeViewID
			if "" == avID {
				return ast.WalkContinue
			}

			attrView, _ := av.ParseAttributeView(avID)
			if nil == attrView {
				return ast.WalkContinue
			}

			blockKeyValues := attrView.GetBlockKeyValues()
			if nil == blockKeyValues {
				return ast.WalkContinue
			}

			for _, val := range blockKeyValues.Values {
				if val.IsDetached {
					continue
				}

				defBlock := treenode.GetBlockTree(val.Block.ID)
				if nil == defBlock {
					continue
				}

				var defTree *parse.Tree
				var err error
				if treeCache[defBlock.RootID] != nil {
					defTree = treeCache[defBlock.RootID]
				} else {
					defTree, err = loadTreeWithCache(defBlock.RootID, treeCache)
					if err != nil {
						continue
					}
					treeCache[defBlock.RootID] = defTree
				}
				*defBlockIDs = append(*defBlockIDs, val.BlockID)

				if !Conf.Export.IncludeRelatedDocs {
					return ast.WalkSkipChildren
				}
				exportRefTrees(defTree, defBlockIDs, retTrees, treeCache)
			}
		}
		return ast.WalkContinue
	})

	*defBlockIDs = gulu.Str.RemoveDuplicatedElem(*defBlockIDs)
}

func loadTreeWithCache(id string, treeCache map[string]*parse.Tree) (tree *parse.Tree, err error) {
	if tree = treeCache[id]; nil != tree {
		return
	}
	tree, err = LoadTreeByBlockID(id)
	if nil == err && nil != tree {
		treeCache[id] = tree
	}
	return
}

func getAttrViewTable(attrView *av.AttributeView, view *av.View, query string) (ret *av.Table) {
	switch view.LayoutType {
	case av.LayoutTypeGallery:
		view.Table = av.NewLayoutTable()
		for _, field := range view.Gallery.CardFields {
			view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: field.ID}})
		}
	case av.LayoutTypeKanban:
		view.Table = av.NewLayoutTable()
		for _, field := range view.Kanban.Fields {
			view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: field.ID}})
		}
	}

	depth := 1
	ret = sql.RenderAttributeViewTable(attrView, view, query, &depth, map[string]*av.AttributeView{})
	return
}

// adjustHeadingLevel 聚焦导出（即非文档块）的情况下，将第一个标题层级提升为一级（如果开启了添加文档标题的话提升为二级）。
// Export preview mode supports focus use https://github.com/siyuan-note/siyuan/issues/15340
func adjustHeadingLevel(bt *treenode.BlockTree, tree *parse.Tree) {
	if "d" == bt.Type {
		return
	}

	level := 1
	var firstHeading *ast.Node
	if !Conf.Export.AddTitle {
		for n := tree.Root.FirstChild; nil != n; n = n.Next {
			if ast.NodeHeading == n.Type && !n.ParentIs(ast.NodeBlockquote) && !n.ParentIs(ast.NodeCallout) {
				firstHeading = n
				break
			}
		}
	} else {
		for n := tree.Root.FirstChild.Next; nil != n; n = n.Next {
			if ast.NodeHeading == n.Type && !n.ParentIs(ast.NodeBlockquote) && !n.ParentIs(ast.NodeCallout) {
				firstHeading = n
				break
			}
		}
		level = 2
	}
	if nil != firstHeading {
		hLevel := firstHeading.HeadingLevel
		diff := level - hLevel
		var children, childrenHeadings []*ast.Node
		children = append(children, firstHeading)
		children = append(children, treenode.HeadingChildren(firstHeading)...)
		for _, c := range children {
			ccH := c.ChildrenByType(ast.NodeHeading)
			childrenHeadings = append(childrenHeadings, ccH...)
		}
		for _, h := range childrenHeadings {
			h.HeadingLevel += diff
			if 6 < h.HeadingLevel {
				h.HeadingLevel = 6
			} else if 1 > h.HeadingLevel {
				h.HeadingLevel = 1
			}
		}
	}
}
