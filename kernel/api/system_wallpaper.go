// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var uploadLockScreenWallpaper = contractHandler(apicontract.SystemUploadLockScreenWallpaper, func(c *gin.Context, request apicontract.SystemWallpaperUploadRequest) apicontract.Response[apicontract.Null] {
	if request.File == nil || request.File.Size > util.LockScreenWallpaperMaxBytes {
		return apicontract.Failure[apicontract.Null](-1, model.Conf.Language(438))
	}
	file, err := request.File.Open()
	if err != nil {
		return wallpaperWriteFailure(err)
	}
	defer file.Close()
	data, err := util.PrepareLockScreenWallpaper(file)
	if err == nil {
		err = util.SaveLockScreenWallpaper(util.ConfDir, data)
	}
	if err != nil {
		return wallpaperWriteFailure(err)
	}
	return apicontract.Success(apicontract.Null{})
}, func(c *gin.Context) *apicontract.Response[apicontract.Null] {
	// 在解析表单前限制包括 multipart 边界在内的整个请求体。
	const maxBody = util.LockScreenWallpaperMaxBytes + (64 << 10)
	if c.Request.ContentLength > maxBody {
		response := apicontract.Failure[apicontract.Null](-1, model.Conf.Language(438))
		return &response
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBody)
	return nil
})

var removeLockScreenWallpaper = contractHandler(apicontract.SystemRemoveLockScreenWallpaper, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	if err := util.RemoveLockScreenWallpaper(util.ConfDir); err != nil {
		return wallpaperWriteFailure(err)
	}
	return apicontract.Success(apicontract.Null{})
})

var getLockScreenWallpaper = contractHandler(apicontract.SystemGetLockScreenWallpaper, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.BinaryContent] {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	if !model.Conf.LoadAppearance().LockScreenWallpaper {
		return apicontract.EmptyHTTPResponse[apicontract.BinaryContent](http.StatusNotFound)
	}
	data, err := util.ReadLockScreenWallpaper(util.ConfDir)
	if err != nil {
		return apicontract.EmptyHTTPResponse[apicontract.BinaryContent](http.StatusNotFound)
	}
	return apicontract.SuccessBinary("image/jpeg", data)
})

func wallpaperWriteFailure(err error) apicontract.Response[apicontract.Null] {
	if errors.Is(err, util.ErrInvalidLockScreenWallpaper) {
		return apicontract.Failure[apicontract.Null](-1, model.Conf.Language(438))
	}
	logging.LogErrorf("write lock screen wallpaper failed: %s", err)
	return apicontract.Failure[apicontract.Null](-1, model.Conf.Language(439))
}
