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
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/djherbis/times"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var statAsset = contractHandler(apicontract.StatAsset, func(c *gin.Context, request apicontract.AssetPathRequest) apicontract.Response[apicontract.AssetStatData] {

	path := request.Path
	var p string
	if strings.HasPrefix(path, "assets/") {
		var err error
		p, err = model.GetAssetAbsPathInBox(path, "")
		if err != nil {
			return apicontract.Failure[apicontract.AssetStatData](1, "")
		}

	} else if localPath := util.FileURLToLocalPath(path); localPath != "" {
		p = localPath
	} else {
		return apicontract.Failure[apicontract.AssetStatData](1, "")
	}

	if !util.IsAbsPathInWorkspace(p) {
		return apicontract.Failure[apicontract.AssetStatData](1, "")
	}

	info, err := os.Stat(p)
	if err != nil {
		if os.IsNotExist(err) {
			files, readErr := model.DeferredSyncAssets()
			if readErr != nil {
				return apicontract.Failure[apicontract.AssetStatData](1, readErr.Error())
			}
			for _, file := range files {
				if filepath.Clean(p) != filepath.Join(util.DataDir, filepath.FromSlash(strings.TrimPrefix(file.Path, "/"))) {
					continue
				}
				updated := time.UnixMilli(file.Updated).Format("2006-01-02 15:04:05")
				return apicontract.Success(apicontract.AssetStatData{Size: file.Size, HSize: humanize.IBytesCustomCeil(uint64(file.Size), 2), Created: file.Updated, HCreated: updated, Updated: file.Updated, HUpdated: updated, Downloaded: new(false)})
			}
		}
		return apicontract.Failure[apicontract.AssetStatData](1, "")
	}

	t, err := times.Stat(p)
	if err != nil {
		return apicontract.Failure[apicontract.AssetStatData](1, "")
	}

	updated := t.ModTime().UnixMilli()
	hUpdated := t.ModTime().Format("2006-01-02 15:04:05")
	created := updated
	hCreated := hUpdated
	// 存在创建时间时优先使用创建时间
	if t.HasBirthTime() {
		created = t.BirthTime().UnixMilli()
		hCreated = t.BirthTime().Format("2006-01-02 15:04:05")
	}

	return apicontract.Success(apicontract.AssetStatData{Size: info.Size(), HSize: humanize.IBytesCustomCeil(uint64(info.Size()), 2), Created: created, HCreated: hCreated, Updated: updated, HUpdated: hUpdated})
})

var fullReindexAssetContent = contractHandler(apicontract.FullReindexAssetContent, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {

	model.ReindexAssetContent()

	return apicontract.Success(apicontract.Null{})
})

var getImageOCRText = contractHandler(apicontract.GetImageOCRText, func(c *gin.Context, request apicontract.AssetOCRTextRequest) apicontract.Response[apicontract.AssetTextData] {

	if request.Path == nil {
		return apicontract.Success(apicontract.AssetTextData{Text: ""})
	}
	path := *request.Path

	// 加密笔记本的资源不参与全局 OCR（OCR 文本存在全局 data/assets/ocr-texts.json）
	if absPath, absErr := model.GetAssetAbsPathInBox(path, ""); absErr == nil && model.IsEncryptedAssetPath(absPath) {
		return apicontract.Success(apicontract.AssetTextData{Text: ""})

	}

	return apicontract.Success(apicontract.AssetTextData{Text: util.GetAssetText(path)})
})

var setImageOCRText = contractHandler(apicontract.SetImageOCRText, func(c *gin.Context, request apicontract.SetAssetOCRTextRequest) apicontract.Response[apicontract.Null] {

	path := request.Path
	text := request.Text

	// 加密笔记本的资源不参与全局 OCR
	if absPath, absErr := model.GetAssetAbsPathInBox(path, ""); absErr == nil && model.IsEncryptedAssetPath(absPath) {
		return apicontract.Success(apicontract.Null{})
	}
	util.SetAssetText(path, text)

	// 刷新 OCR 结果到数据库
	util.NodeOCRQueueLock.Lock()
	defer util.NodeOCRQueueLock.Unlock()
	for _, id := range util.NodeOCRQueue {
		sql.IndexNodeQueue(id)
	}
	util.NodeOCRQueue = nil

	return apicontract.Success(apicontract.Null{})
})

var ocr = contractHandler(apicontract.AssetOCR, func(c *gin.Context, request apicontract.AssetPathRequest) apicontract.Response[apicontract.AssetOCRData] {

	path := request.Path

	// 加密笔记本的资源不参与全局 OCR
	absPath, err := model.GetAssetAbsPathInBox(path, "")
	if err != nil {
		return apicontract.Failure[apicontract.AssetOCRData](-1, err.Error())
	}
	if model.IsEncryptedAssetPath(absPath) {
		return apicontract.FailureWithTimeout[apicontract.AssetOCRData](-1, model.Conf.Language(380), 3000)
	}
	if err = model.EnsureAssetLocal(absPath); err != nil {
		return apicontract.Failure[apicontract.AssetOCRData](-1, err.Error())
	}

	ocrJSON, err := util.OcrAsset(path)
	if nil != err {
		return apicontract.FailureWithTimeout[apicontract.AssetOCRData](-1, err.Error(), 7000)
	}

	return apicontract.Success(apicontract.AssetOCRData{Text: util.GetOcrJsonText(ocrJSON), OCRJSON: ocrJSON})
})

var renameAsset = contractHandler(apicontract.RenameAsset, func(c *gin.Context, request apicontract.RenameAssetRequest) apicontract.Response[apicontract.AssetRenameData] {

	oldPath := request.OldPath
	newName := request.NewName
	newPath, err := model.RenameAsset(oldPath, newName)
	if err != nil {
		return apicontract.FailureWithTimeout[apicontract.AssetRenameData](-1, err.Error(), 5000)
	}
	return apicontract.Success(apicontract.AssetRenameData{NewPath: newPath})
})

var getDocImageAssets = contractHandler(apicontract.GetDocImageAssets, func(c *gin.Context, request apicontract.AssetDocumentRequest) apicontract.Response[[]string] {

	id := request.ID
	assets, err := model.DocImageAssets(id)
	if err != nil {
		return apicontract.Failure[[]string](-1, err.Error())
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckBlockIdAccessableByPublishAccess(c, publishAccess, id) {
			return apicontract.Failure[[]string](-1, fmt.Sprintf(model.Conf.Language(15), id))
		}
	}
	return apicontract.Success(assets)
})

var getDocAssets = contractHandler(apicontract.GetDocAssets, func(c *gin.Context, request apicontract.AssetDocumentAssetsRequest) apicontract.Response[[]string] {

	id := request.ID
	retainQueryStr := true
	if request.RetainQueryStr != nil {
		retainQueryStr = *request.RetainQueryStr
	}

	assets, err := model.DocAssets(id, retainQueryStr)
	if err != nil {
		return apicontract.Failure[[]string](-1, err.Error())
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckBlockIdAccessableByPublishAccess(c, publishAccess, id) {
			return apicontract.Failure[[]string](-1, fmt.Sprintf(model.Conf.Language(15), id))
		}
	}
	return apicontract.Success(assets)
})

// fileAnno 是 PDF 文件标注 .sya 的校验结构，setFileAnnotation 通过它约束客户端提交的数据结构，避免任意字符串落盘
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-fqpw-c3pj-w8g9
type fileAnno struct {
	Pages []struct {
		Index     int         `json:"index"`
		Positions [][]float64 `json:"positions"`
	} `json:"pages"`
	Color   string   `json:"color"`
	Type    string   `json:"type"`
	Content string   `json:"content"`
	Mode    string   `json:"mode"`
	IDs     []string `json:"ids"`
}

var setFileAnnotation = contractHandler(apicontract.SetFileAnnotation, func(c *gin.Context, request apicontract.SetAssetAnnotationRequest) apicontract.Response[apicontract.Null] {

	p := request.Path
	p = strings.ReplaceAll(p, "%23", "#")
	data := request.Data
	writePath, _, err := resolveFileAnnotationAbsPath(p)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	boxID := model.ExtractBoxIDFromAssetsPath(writePath)
	if err = holdEncryptedBoxRequest(c, boxID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if "{}" == data {
		if err = filelock.Remove(writePath); err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
	} else {
		var annos map[string]fileAnno
		if err = json.Unmarshal([]byte(data), &annos); err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		if annos == nil {
			return apicontract.Failure[apicontract.Null](-1, "invalid annotation")
		}
		normalized, err := json.Marshal(annos)
		if err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		// 加密笔记本的 .sya 写盘前必须加密；加密笔记本未解锁时拒绝写入（fail-closed，避免明文落盘）
		writeData := normalized
		if boxID != "" && model.IsEncryptedBox(boxID) {
			dek, dekErr := model.GetDEKIfUnlocked(boxID)
			if dekErr != nil {
				return apicontract.Failure[apicontract.Null](-1, dekErr.Error())
			}
			diskName := filepath.Base(writePath)
			enc, encErr := model.EncryptAsset(boxID, diskName, diskName, dek, writeData)
			if encErr != nil {
				return apicontract.Failure[apicontract.Null](-1, encErr.Error())
			}
			writeData = enc
		}
		if err = filelock.WriteFile(writePath, writeData); err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
	}

	model.IncSync()

	return apicontract.Success(apicontract.Null{})
})

var getFileAnnotation = contractHandler(apicontract.GetFileAnnotation, func(c *gin.Context, request apicontract.AssetPathRequest) apicontract.Response[apicontract.AssetAnnotationData] {

	p := request.Path
	p = strings.ReplaceAll(p, "%23", "#")
	readPath, assetAbsPath, err := resolveFileAnnotationAbsPath(p)
	if err != nil {
		return apicontract.FailureWithTimeout[apicontract.AssetAnnotationData](-1, err.Error(), 5000)
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckAbsPathAccessableByPublishAccess(c, assetAbsPath, publishAccess) {
			return apicontract.Failure[apicontract.AssetAnnotationData](http.StatusForbidden, http.StatusText(http.StatusForbidden))
		}
	}
	if !filelock.IsExist(readPath) {
		return apicontract.Failure[apicontract.AssetAnnotationData](1, "")
	}
	boxID := model.ExtractBoxIDFromAssetsPath(readPath)
	if err = holdEncryptedBoxRequest(c, boxID); err != nil {
		return apicontract.Failure[apicontract.AssetAnnotationData](-1, err.Error())
	}

	data, err := filelock.ReadFile(readPath)
	if err != nil {
		return apicontract.Failure[apicontract.AssetAnnotationData](-1, err.Error())
	}
	// 加密笔记本的 .sya 读盘后必须解密；未解锁时拒绝返回（fail-closed，避免返回密文或误判）
	if boxID != "" && model.IsEncryptedBox(boxID) {
		dek, dekErr := model.GetDEKIfUnlocked(boxID)
		if dekErr != nil {
			return apicontract.Failure[apicontract.AssetAnnotationData](-1, dekErr.Error())
		}
		plain, decErr := model.DecryptAsset(boxID, filepath.Base(readPath), dek, data)
		if decErr != nil {
			return apicontract.Failure[apicontract.AssetAnnotationData](-1, decErr.Error())
		}
		data = plain
	}
	return apicontract.Success(apicontract.AssetAnnotationData{Data: string(data)})
})

func resolveFileAnnotationAbsPath(assetRelPath string) (annotationAbsPath, assetAbsPath string, err error) {
	// .sya 在 URL 末尾，例如 assets/a.pdf?box=<id>.sya
	// TrimSuffix 去掉 .sya 得到 assets/a.pdf?box=<id>，保留 query 供 box-aware 解析
	filePath := strings.TrimSuffix(assetRelPath, ".sya")
	assetAbsPath, err = model.GetAssetAbsPathInBox(filePath, "")
	if err != nil {
		return
	}
	annotationAbsPath = assetAbsPath + ".sya"
	return
}

var removeUnusedAsset = contractHandler(apicontract.RemoveUnusedAsset, func(c *gin.Context, request apicontract.AssetPathRequest) apicontract.Response[apicontract.AssetPathData] {

	p := request.Path
	asset, err := model.RemoveUnusedAsset(p)
	if err != nil {
		return apicontract.Failure[apicontract.AssetPathData](-1, err.Error())
	}
	return apicontract.Success(apicontract.AssetPathData{Path: asset})
})

var removeUnusedAssets = contractHandler(apicontract.RemoveUnusedAssets, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.AssetPathsData] {

	paths, err := model.RemoveUnusedAssets()
	if err != nil {
		return apicontract.Failure[apicontract.AssetPathsData](-1, err.Error())
	}
	return apicontract.Success(apicontract.AssetPathsData{Paths: paths})
})

var getUnusedAssets = contractHandler(apicontract.GetUnusedAssets, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[[]*apicontract.AssetUnusedItem] {

	unusedAssets, err := model.UnusedAssets(true)
	if err != nil {
		return apicontract.Failure[[]*apicontract.AssetUnusedItem](-1, err.Error())
	}
	total := len(unusedAssets)

	// 最多返回 512 个未引用资源。
	const maxUnusedAssets = 512
	if total > maxUnusedAssets {
		unusedAssets = unusedAssets[:maxUnusedAssets]
		util.PushMsg(fmt.Sprintf(model.Conf.Language(251), total, maxUnusedAssets), 5000)
	}

	return apicontract.Success(assetUnusedItems(unusedAssets))
})

var getMissingAssets = contractHandler(apicontract.GetMissingAssets, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[[]*apicontract.AssetUnusedItem] {

	missingAssets := model.MissingAssets()
	return apicontract.Success(assetUnusedItems(missingAssets))
})

var resolveAssetPath = contractHandler(apicontract.ResolveAssetPath, func(c *gin.Context, request apicontract.AssetPathRequest) apicontract.Response[string] {

	path := request.Path
	p, err := model.GetAssetAbsPathInBox(path, "")
	if err != nil {
		return apicontract.FailureWithTimeout[string](-1, err.Error(), 3000)
	}
	if model.IsEncryptedAssetPath(p) {
		if err = holdEncryptedBoxRequest(c, model.ExtractBoxIDFromAssetsPath(p)); err != nil {
			return apicontract.FailureWithTimeout[string](-1, err.Error(), 3000)
		}
		p, err = model.PrepareEncryptedAssetForExternalOpen(path)
		if err != nil {
			return apicontract.FailureWithTimeout[string](-1, err.Error(), 3000)
		}
		return apicontract.Success(p)
	}
	if err = model.EnsureAssetPrefixLocal(p); err != nil {
		return apicontract.FailureWithTimeout[string](-1, err.Error(), 7000)
	}
	return apicontract.Success(p)
})

var uploadCloud = contractHandler(apicontract.AssetUploadCloud, func(c *gin.Context, request apicontract.AssetCloudUploadRequest) apicontract.Response[apicontract.Null] {

	ignorePushMsg := request.IgnorePushMsg
	id := request.ID

	count, err := model.UploadAssets2Cloud(id, ignorePushMsg)
	if err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 3000)
	}

	util.PushMsg(fmt.Sprintf(model.Conf.Language(41), count), 3000)

	return apicontract.Success(apicontract.Null{})
})

var uploadCloudByAssetsPaths = contractHandler(apicontract.AssetUploadCloudByAssetsPaths, func(c *gin.Context, request apicontract.AssetPathsCloudUploadRequest) apicontract.Response[apicontract.Null] {

	assets := append([]string(nil), request.Paths...)
	ignorePushMsg := request.IgnorePushMsg

	count, err := model.UploadAssets2CloudByAssetsPaths(assets, ignorePushMsg)
	if err != nil {
		return apicontract.FailureWithTimeout[apicontract.Null](-1, err.Error(), 3000)
	}

	if !ignorePushMsg {
		util.PushMsg(fmt.Sprintf(model.Conf.Language(41), count), 3000)
	}

	return apicontract.Success(apicontract.Null{})
})

var insertLocalAssets = contractHandler(apicontract.InsertLocalAssets, func(c *gin.Context, request apicontract.InsertLocalAssetsRequest) apicontract.Response[apicontract.AssetUploadData] {

	assetPaths := append([]string(nil), request.AssetPaths...)
	isUpload := true
	if request.IsUpload != nil {
		isUpload = *request.IsUpload
	}
	id := request.ID
	fromHTMLPaste := request.FromHTMLPaste

	var succMap map[string]string
	var succFiles []model.AssetUploadSuccess
	var failedFiles []model.AssetUploadFailure
	var err error
	if fromHTMLPaste {
		succMap, succFiles, failedFiles, err = model.InsertHTMLLocalAssets(id, assetPaths)
	} else {
		succMap, succFiles, failedFiles, err = model.InsertLocalAssets(id, assetPaths, isUpload)
	}
	if err != nil {
		return apicontract.Failure[apicontract.AssetUploadData](-1, err.Error())
	}
	errFiles := make([]string, 0, len(failedFiles))
	for _, failedFile := range failedFiles {
		errFiles = append(errFiles, failedFile.Name)
	}
	data := assetUploadData(errFiles, failedFiles, succFiles, succMap)
	if len(failedFiles) > 0 {
		return apicontract.InsertLocalAssets.FailureWithData(-1, failedFiles[0].Error, data)
	}
	return apicontract.Success(data)
})

var insertCover = contractHandler(apicontract.InsertCover, func(c *gin.Context, request apicontract.InsertCoverRequest) apicontract.Response[apicontract.AssetInsertCoverData] {

	name := request.Name
	// 防止路径穿越：只允许文件名，不能含分隔符或 ..
	name = filepath.Base(name)
	if "" == name || "." == name || ".." == name {
		return apicontract.Failure[apicontract.AssetInsertCoverData](-1, "invalid name")
	}

	srcPath := filepath.Join(util.AppearancePath, "covers", name)
	if gulu.File.IsDir(srcPath) {
		return apicontract.Failure[apicontract.AssetInsertCoverData](-1, "invalid cover")
	}
	if _, statErr := os.Stat(srcPath); nil != statErr {
		return apicontract.Failure[apicontract.AssetInsertCoverData](-1, "cover not found")
	}

	id := request.ID
	succMap, succFiles, failedFiles, err := model.InsertLocalAssets(id, []string{srcPath}, true)
	if nil != err {
		return apicontract.Failure[apicontract.AssetInsertCoverData](-1, err.Error())
	}
	if 0 < len(failedFiles) {
		return apicontract.Failure[apicontract.AssetInsertCoverData](-1, failedFiles[0].Error)
	}

	return apicontract.Success(apicontract.AssetInsertCoverData{SuccFiles: assetUploadSuccesses(succFiles), SuccMap: succMap})
})

var uploadAsset = contractHandler(apicontract.UploadAsset, func(c *gin.Context, request apicontract.UploadAssetRequest) apicontract.Response[apicontract.AssetUploadData] {
	result, message, err := model.UploadAssets(model.AssetUploadRequest{ID: request.ID, AssetsDirPath: request.AssetsDirPath, Files: request.Files})
	if err != nil {
		return apicontract.Failure[apicontract.AssetUploadData](-1, err.Error())
	}
	return apicontract.SuccessWithMessage(assetUploadData(result.ErrFiles, result.FailedFiles, result.SuccFiles, result.SuccMap), message)
})

func assetUploadSuccesses(values []model.AssetUploadSuccess) []apicontract.AssetUploadSuccess {
	if values == nil {
		return nil
	}
	ret := make([]apicontract.AssetUploadSuccess, len(values))
	for i, value := range values {
		ret[i] = apicontract.AssetUploadSuccess(value)
	}
	return ret
}
func assetUploadData(errFiles []string, failures []model.AssetUploadFailure, successes []model.AssetUploadSuccess, successMap map[string]string) apicontract.AssetUploadData {
	ret := apicontract.AssetUploadData{ErrFiles: errFiles, SuccFiles: assetUploadSuccesses(successes), SuccMap: successMap}
	if failures != nil {
		ret.FailedFiles = make([]apicontract.AssetUploadFailure, len(failures))
		for i, value := range failures {
			ret.FailedFiles[i] = apicontract.AssetUploadFailure(value)
		}
	}
	return ret
}
func assetUnusedItems(values []*model.UnusedItem) []*apicontract.AssetUnusedItem {
	if values == nil {
		return nil
	}
	ret := make([]*apicontract.AssetUnusedItem, len(values))
	for i, value := range values {
		if value != nil {
			ret[i] = &apicontract.AssetUnusedItem{Item: value.Item, Name: value.Name, Path: value.Path, BlockIDs: value.BlockIDs}
		}
	}
	return ret
}
