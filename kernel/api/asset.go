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
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getImageOCRText(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	path := arg["path"].(string)
	force := false
	if forceArg := arg["force"]; nil != forceArg {
		force = forceArg.(bool)
	}

	ret.Data = map[string]interface{}{
		"text": util.GetAssetText(path, force),
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
	if !gulu.File.IsExist(readPath) {
		ret.Code = 1
		return
	}

	data, err := os.ReadFile(readPath)
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
	err := model.UploadAssets2Cloud(rootID)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		ret.Data = map[string]interface{}{"closeTimeout": 3000}
	} else {
		util.PushMsg(model.Conf.Language(41), 3000)
	}
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
