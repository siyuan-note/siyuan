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
		p, err = model.GetAssetAbsPath(path)
		if nil != err {
			ret.Code = 1
			return
		}

	} else if strings.HasPrefix(path, "file://") {
		p = strings.TrimPrefix(path, "file://")
	} else {
		ret.Code = 1
		return
	}

	info, err := os.Stat(p)
	if nil != err {
		ret.Code = 1
		return
	}

	t, err := times.Stat(p)
	if nil != err {
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

	ret.Data = map[string]interface{}{
		"size":     info.Size(),
		"hSize":    humanize.BytesCustomCeil(uint64(info.Size()), 2),
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

	path := arg["path"].(string)

	ret.Data = map[string]interface{}{
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
	util.SetAssetText(path, text)
}

func ocr(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)

	ocrJSON := util.OcrAsset(path)
	ret.Data = map[string]interface{}{
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
	err := model.RenameAsset(oldPath, newName)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
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
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
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
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err := filelock.WriteFile(writePath, []byte(data)); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
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
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
	if !filelock.IsExist(readPath) {
		ret.Code = 1
		return
	}

	data, err := filelock.ReadFile(readPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]interface{}{
		"data": string(data),
	}
}

func resolveFileAnnotationAbsPath(assetRelPath string) (ret string, err error) {
	filePath := strings.TrimSuffix(assetRelPath, ".sya")
	absPath, err := model.GetAssetAbsPath(filePath)
	if nil != err {
		return
	}
	dir := filepath.Dir(absPath)
	base := filepath.Base(assetRelPath)
	ret = filepath.Join(dir, base)
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
	ret.Data = map[string]interface{}{
		"path": asset,
	}
}

func removeUnusedAssets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	paths := model.RemoveUnusedAssets()
	ret.Data = map[string]interface{}{
		"paths": paths,
	}
}

func getUnusedAssets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	unusedAssets := model.UnusedAssets()
	ret.Data = map[string]interface{}{
		"unusedAssets": unusedAssets,
	}
}

func getMissingAssets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	missingAssets := model.MissingAssets()
	ret.Data = map[string]interface{}{
		"missingAssets": missingAssets,
	}
}

func resolveAssetPath(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)
	p, err := model.GetAssetAbsPath(path)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 3000}
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

	rootID := arg["id"].(string)
	count, err := model.UploadAssets2Cloud(rootID)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 3000}
		return
	}

	util.PushMsg(fmt.Sprintf(model.Conf.Language(41), count), 3000)
}

func insertLocalAssets(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	assetPathsArg := arg["assetPaths"].([]interface{})
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
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]interface{}{
		"succMap": succMap,
	}
}
