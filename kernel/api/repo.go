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
	"fmt"
	"net/http"

	"github.com/88250/gulu"
	"github.com/dustin/go-humanize"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getCloudSpace(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	sync, backup, size, assetSize, totalSize, err := model.GetCloudSpace()
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
		"hSize":                size,
		"hTotalSize":           totalSize,
		"hTrafficUploadSize":   hTrafficUploadSize,
		"hTrafficDownloadSize": hTrafficDownloadSize,
	}
}

func checkoutRepo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if err := model.CheckoutRepo(id); nil != err {
		ret.Code = -1
		ret.Msg = model.Conf.Language(141)
		return
	}
}

func downloadCloudSnapshot(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	tag := arg["tag"].(string)
	if err := model.DownloadCloudSnapshot(tag, id); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func uploadCloudSnapshot(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	tag := arg["tag"].(string)
	if err := model.UploadCloudSnapshot(tag, id); nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func getRepoSnapshots(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	page := arg["page"].(float64)
	snapshots, pageCount, totalCount, err := model.GetRepoSnapshots(int(page))
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]interface{}{
		"snapshots":  snapshots,
		"pageCount":  pageCount,
		"totalCount": totalCount,
	}
}

func getCloudRepoTagSnapshots(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	snapshots, err := model.GetCloudRepoTagSnapshots()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"snapshots": snapshots,
	}
}

func removeCloudRepoTagSnapshot(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	tag := arg["tag"].(string)
	err := model.RemoveCloudRepoTag(tag)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func getRepoTagSnapshots(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	snapshots, err := model.GetTagSnapshots()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"snapshots": snapshots,
	}
}

func removeRepoTagSnapshot(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	tag := arg["tag"].(string)
	err := model.RemoveTagSnapshot(tag)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func createSnapshot(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	memo := arg["memo"].(string)
	if err := model.IndexRepo(memo); nil != err {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(140), err)
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func tagSnapshot(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	name := arg["name"].(string)
	if err := model.TagSnapshot(id, name); nil != err {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(140), err)
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func importRepoKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	base64Key := arg["key"].(string)
	if err := model.ImportRepoKey(base64Key); nil != err {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(137), err)
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func initRepoKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if err := model.InitRepoKey(); nil != err {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(137), err)
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	ret.Data = map[string]interface{}{
		"key": model.Conf.Repo.Key,
	}
}

func resetRepo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if err := model.ResetRepo(); nil != err {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(146), err.Error())
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}
