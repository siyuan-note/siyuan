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
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/djherbis/times"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func statAsset(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)
	var p string
	if strings.HasPrefix(path, "assets/") {
		var err error
		p, err = model.GetAssetAbsPathInBox(path, "")
		if err != nil {
			ret.Code = 1
			return
		}

	} else if localPath := util.FileURLToLocalPath(path); localPath != "" {
		p = localPath
	} else {
		ret.Code = 1
		return
	}

	if !util.IsAbsPathInWorkspace(p) {
		ret.Code = 1
		return
	}

	info, err := os.Stat(p)
	if err != nil {
		ret.Code = 1
		return
	}

	t, err := times.Stat(p)
	if err != nil {
		ret.Code = 1
		return
	}

	updated := t.ModTime().UnixMilli()
	hUpdated := t.ModTime().Format("2006-01-02 15:04:05")
	created := updated
	hCreated := hUpdated
	// Check birthtime before use
	if t.HasBirthTime() {
		created = t.BirthTime().UnixMilli()
		hCreated = t.BirthTime().Format("2006-01-02 15:04:05")
	}

	ret.Data = map[string]any{
		"size":     info.Size(),
		"hSize":    humanize.IBytesCustomCeil(uint64(info.Size()), 2),
		"created":  created,
		"hCreated": hCreated,
		"updated":  updated,
		"hUpdated": hUpdated,
	}
}

func fullReindexAssetContent(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.ReindexAssetContent()
}

func getImageOCRText(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var path string
	if nil == arg["path"] {
		ret.Data = map[string]any{
			"text": "",
		}
		return
	}

	path = arg["path"].(string)

	// 加密笔记本的资源不参与全局 OCR（OCR 文本存在全局 data/assets/ocr-texts.json）
	if absPath, absErr := model.GetAssetAbsPathInBox(path, ""); absErr == nil && model.IsEncryptedAssetPath(absPath) {
		ret.Data = map[string]any{
			"text": "",
		}
		return
	}

	ret.Data = map[string]any{
		"text": util.GetAssetText(path),
	}
}

func setImageOCRText(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)
	text := arg["text"].(string)

	// 加密笔记本的资源不参与全局 OCR
	if absPath, absErr := model.GetAssetAbsPathInBox(path, ""); absErr == nil && model.IsEncryptedAssetPath(absPath) {
		return
	}
	util.SetAssetText(path, text)

	// 刷新 OCR 结果到数据库
	util.NodeOCRQueueLock.Lock()
	defer util.NodeOCRQueueLock.Unlock()
	for _, id := range util.NodeOCRQueue {
		sql.IndexNodeQueue(id)
	}
	util.NodeOCRQueue = nil
}

func ocr(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)

	// 加密笔记本的资源不参与全局 OCR
	if absPath, absErr := model.GetAssetAbsPathInBox(path, ""); absErr == nil && model.IsEncryptedAssetPath(absPath) {
		ret.Code = -1
		ret.Msg = "OCR is not supported for assets in encrypted notebooks"
		ret.Data = map[string]any{"closeTimeout": 3000}
		return
	}

	ocrJSON, err := util.OcrAsset(path)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 7000}
		return
	}

	ret.Data = map[string]any{
		"text":    util.GetOcrJsonText(ocrJSON),
		"ocrJSON": ocrJSON,
	}
}

func renameAsset(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	oldPath := arg["oldPath"].(string)
	newName := arg["newName"].(string)
	newPath, err := model.RenameAsset(oldPath, newName)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}
	ret.Data = map[string]any{
		"newPath": newPath,
	}
}

func getDocImageAssets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	assets, err := model.DocImageAssets(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckBlockIdAccessableByPublishAccess(c, publishAccess, id) {
			ret.Code = -1
			ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
			return
		}
	}
	ret.Data = assets
}

func getDocAssets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	retainQueryStr := true
	if nil != arg["retainQueryStr"] {
		retainQueryStr = arg["retainQueryStr"].(bool)
	}

	assets, err := model.DocAssets(id, retainQueryStr)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		if !model.CheckBlockIdAccessableByPublishAccess(c, publishAccess, id) {
			ret.Code = -1
			ret.Msg = fmt.Sprintf(model.Conf.Language(15), id)
			return
		}
	}
	ret.Data = assets
}

func setFileAnnotation(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	p := arg["path"].(string)
	p = strings.ReplaceAll(p, "%23", "#")
	data := arg["data"].(string)
	writePath, err := resolveFileAnnotationAbsPath(p)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if "{}" == data {
		if err = filelock.Remove(writePath); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	} else {
		// 加密笔记本的 .sya 写盘前必须加密；加密笔记本未解锁时拒绝写入（fail-closed，避免明文落盘）
		writeData := []byte(data)
		if boxID := model.ExtractBoxIDFromAssetsPath(writePath); boxID != "" && model.IsEncryptedBox(boxID) {
			model.HoldBoxReadLock(boxID)
			defer model.ReleaseBoxReadLock(boxID)
			dek, dekErr := model.GetDEKIfUnlocked(boxID)
			if dekErr != nil {
				ret.Code = -1
				ret.Msg = dekErr.Error()
				return
			}
			enc, encErr := model.EncryptAsset(boxID, filepath.Base(writePath), dek, writeData)
			if encErr != nil {
				ret.Code = -1
				ret.Msg = encErr.Error()
				return
			}
			writeData = enc
		}
		if err = filelock.WriteFile(writePath, writeData); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return
		}
	}

	model.IncSync()
}

func getFileAnnotation(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	p := arg["path"].(string)
	p = strings.ReplaceAll(p, "%23", "#")
	readPath, err := resolveFileAnnotationAbsPath(p)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 5000}
		return
	}
	if !filelock.IsExist(readPath) {
		ret.Code = 1
		return
	}

	data, err := filelock.ReadFile(readPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	// 加密笔记本的 .sya 读盘后必须解密；未解锁时拒绝返回（fail-closed，避免返回密文或误判）
	if boxID := model.ExtractBoxIDFromAssetsPath(readPath); boxID != "" && model.IsEncryptedBox(boxID) {
		model.HoldBoxReadLock(boxID)
		defer model.ReleaseBoxReadLock(boxID)
		dek, dekErr := model.GetDEKIfUnlocked(boxID)
		if dekErr != nil {
			ret.Code = -1
			ret.Msg = dekErr.Error()
			return
		}
		plain, decErr := model.DecryptAsset(boxID, filepath.Base(readPath), dek, data)
		if decErr != nil {
			ret.Code = -1
			ret.Msg = decErr.Error()
			return
		}
		data = plain
	}
	ret.Data = map[string]any{
		"data": string(data),
	}
}

func resolveFileAnnotationAbsPath(assetRelPath string) (ret string, err error) {
	// .sya 在 URL 末尾，例如 assets/a.pdf?box=<id>.sya
	// TrimSuffix 去掉 .sya 得到 assets/a.pdf?box=<id>，保留 query 供 box-aware 解析
	filePath := strings.TrimSuffix(assetRelPath, ".sya")
	absPath, err := model.GetAssetAbsPathInBox(filePath, "")
	if err != nil {
		return
	}
	ret = absPath + ".sya"
	return
}

func removeUnusedAsset(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	p := arg["path"].(string)
	asset := model.RemoveUnusedAsset(p)
	ret.Data = map[string]any{
		"path": asset,
	}
}

func removeUnusedAssets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	paths := model.RemoveUnusedAssets()
	ret.Data = map[string]any{
		"paths": paths,
	}
}

func getUnusedAssets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	unusedAssets := model.UnusedAssets(true)
	total := len(unusedAssets)

	// List only 512 unreferenced assets https://github.com/siyuan-note/siyuan/issues/13075
	const maxUnusedAssets = 512
	if total > maxUnusedAssets {
		unusedAssets = unusedAssets[:maxUnusedAssets]
		util.PushMsg(fmt.Sprintf(model.Conf.Language(251), total, maxUnusedAssets), 5000)
	}

	ret.Data = unusedAssets
}

func getMissingAssets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	missingAssets := model.MissingAssets()
	ret.Data = missingAssets
}

func resolveAssetPath(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)
	p, err := model.GetAssetAbsPathInBox(path, "")
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 3000}
		return
	}
	if model.IsEncryptedAssetPath(p) {
		ret.Code = -1
		ret.Msg = model.Conf.Language(314)
		ret.Data = map[string]any{"closeTimeout": 3000}
		return
	}
	ret.Data = p
	return
}

func uploadCloud(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	ignorePushMsg := false
	if nil != arg["ignorePushMsg"] {
		ignorePushMsg = arg["ignorePushMsg"].(bool)
	}

	id := arg["id"].(string)
	count, err := model.UploadAssets2Cloud(id, ignorePushMsg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 3000}
		return
	}

	util.PushMsg(fmt.Sprintf(model.Conf.Language(41), count), 3000)
}

func uploadCloudByAssetsPaths(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	if nil == arg["paths"] {
		ret.Code = -1
		ret.Msg = "[paths] is required"
		return
	}

	pathsArg := arg["paths"].([]any)
	var assets []string
	for _, pathArg := range pathsArg {
		assets = append(assets, pathArg.(string))
	}

	ignorePushMsg := false
	if nil != arg["ignorePushMsg"] {
		ignorePushMsg = arg["ignorePushMsg"].(bool)
	}

	count, err := model.UploadAssets2CloudByAssetsPaths(assets, ignorePushMsg)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]any{"closeTimeout": 3000}
		return
	}

	if !ignorePushMsg {
		util.PushMsg(fmt.Sprintf(model.Conf.Language(41), count), 3000)
	}
}

func insertLocalAssets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	assetPathsArg := arg["assetPaths"].([]any)
	var assetPaths []string
	for _, pathArg := range assetPathsArg {
		assetPaths = append(assetPaths, pathArg.(string))
	}
	isUpload := true
	isUploadArg := arg["isUpload"]
	if nil != isUploadArg {
		isUpload = isUploadArg.(bool)
	}
	id := arg["id"].(string)
	succMap, err := model.InsertLocalAssets(id, assetPaths, isUpload)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]any{
		"succMap": succMap,
	}
}

func insertCover(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	name := arg["name"].(string)
	// 防止路径穿越：只允许文件名，不能含分隔符或 ..
	name = filepath.Base(name)
	if "" == name || "." == name || ".." == name {
		ret.Code = -1
		ret.Msg = "invalid name"
		return
	}

	srcPath := filepath.Join(util.AppearancePath, "covers", name)
	if gulu.File.IsDir(srcPath) {
		ret.Code = -1
		ret.Msg = "invalid cover"
		return
	}
	if _, statErr := os.Stat(srcPath); nil != statErr {
		ret.Code = -1
		ret.Msg = "cover not found"
		return
	}

	id := arg["id"].(string)
	succMap, err := model.InsertLocalAssets(id, []string{srcPath}, true)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"succMap": succMap,
	}
}
