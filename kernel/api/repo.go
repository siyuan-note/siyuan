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
	"mime"
	"net/http"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getRepoFile(c *gin.Context) {
	// Add internal kernel API `/api/repo/getRepoFile` https://github.com/siyuan-note/siyuan/issues/10101

	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	data, p, err := model.GetRepoFile(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	contentType := mime.TypeByExtension(filepath.Ext(p))
	if "" == contentType {
		if m := mimetype.Detect(data); nil != m {
			contentType = m.String()
		}
	}
	if "" == contentType {
		contentType = "application/octet-stream"
	}
	c.Data(http.StatusOK, contentType, data)
}

func openRepoSnapshotDoc(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	content, isProtyleDoc, updated, err := model.OpenRepoSnapshotDoc(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"content":      content,
		"isProtyleDoc": isProtyleDoc,
		"updated":      updated,
	}
}

func diffRepoSnapshots(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	left := arg["left"].(string)
	right := arg["right"].(string)
	diff, err := model.DiffRepoSnapshots(left, right)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"addsLeft":     diff.AddsLeft,
		"updatesLeft":  diff.UpdatesLeft,
		"updatesRight": diff.UpdatesRight,
		"removesRight": diff.RemovesRight,
		"left":         diff.LeftIndex,
		"right":        diff.RightIndex,
	}
}

func getCloudSpace(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	sync, backup, hSize, hAssetSize, hTotalSize, exchangeSize, hTrafficUploadSize, hTrafficDownloadSize, htrafficAPIGet, hTrafficAPIPut, err := model.GetCloudSpace()
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		util.PushErrMsg(err.Error(), 3000)
		return
	}

	ret.Data = map[string]interface{}{
		"sync":                 sync,
		"backup":               backup,
		"hAssetSize":           hAssetSize,
		"hSize":                hSize,
		"hTotalSize":           hTotalSize,
		"hExchangeSize":        exchangeSize,
		"hTrafficUploadSize":   hTrafficUploadSize,
		"hTrafficDownloadSize": hTrafficDownloadSize,
		"hTrafficAPIGet":       htrafficAPIGet,
		"hTrafficAPIPut":       hTrafficAPIPut,
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
	model.CheckoutRepo(id)
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
	if err := model.DownloadCloudSnapshot(tag, id); err != nil {
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
	if err := model.UploadCloudSnapshot(tag, id); err != nil {
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
	if err != nil {
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

func getCloudRepoSnapshots(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	page := int(arg["page"].(float64))

	snapshots, pageCount, totalCount, err := model.GetCloudRepoSnapshots(page)
	if err != nil {
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
	if err != nil {
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
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func getRepoTagSnapshots(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	snapshots, err := model.GetTagSnapshots()
	if err != nil {
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
	if err != nil {
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
	if err := model.IndexRepo(memo); err != nil {
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
	if err := model.TagSnapshot(id, name); err != nil {
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
	retKey, err := model.ImportRepoKey(base64Key)
	if err != nil {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(137), err)
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	ret.Data = map[string]interface{}{
		"key": retKey,
	}
}

func initRepoKeyFromPassphrase(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	pass := arg["pass"].(string)
	if err := model.InitRepoKeyFromPassphrase(pass); err != nil {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(137), err)
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	ret.Data = map[string]interface{}{
		"key": model.Conf.Repo.Key,
	}
}

func initRepoKey(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if err := model.InitRepoKey(); err != nil {
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

	if err := model.ResetRepo(); err != nil {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(146), err.Error())
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func purgeRepo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if err := model.PurgeRepo(); err != nil {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(201), err.Error())
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}

func purgeCloudRepo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if err := model.PurgeCloud(); err != nil {
		ret.Code = -1
		ret.Msg = fmt.Sprintf(model.Conf.Language(201), err.Error())
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}
}
