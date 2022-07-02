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

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func removeCloudBackup(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	err := model.RemoveCloudBackup()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func downloadCloudBackup(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	err := model.DownloadBackup()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func uploadLocalBackup(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	err := model.UploadBackup()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func recoverLocalBackup(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	err := model.RecoverLocalBackup()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func createLocalBackup(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	err := model.CreateLocalBackup()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func getLocalBackup(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	backup, err := model.GetLocalBackup()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"backup": backup,
	}
}

func getCloudSpace(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	sync, backup, size, assetSize, repoSize, totalSize, err := model.GetCloudSpace()
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		util.PushErrMsg(err.Error(), 3000)
		return
	}

	hTrafficUploadSize := humanize.Bytes(uint64(model.Conf.User.UserTrafficUpload))
	hTrafficDownloadSize := humanize.Bytes(uint64(model.Conf.User.UserTrafficDownload))

	ret.Data = map[string]interface{}{
		"sync":                 sync,
		"backup":               backup,
		"hAssetSize":           assetSize,
		"hRepoSize":            repoSize,
		"hSize":                size,
		"hTotalSize":           totalSize,
		"hTrafficUploadSize":   hTrafficUploadSize,
		"hTrafficDownloadSize": hTrafficDownloadSize,
	}
}
