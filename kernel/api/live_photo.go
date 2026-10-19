// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/livephoto"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func checkLivePhotoAsset(c *gin.Context, absPath string) error {
	if util.IsSensitivePath(absPath) || (!model.IsAdminRoleContext(c) &&
		!model.CheckAbsPathAccessableByPublishAccess(c, absPath, model.GetPublishAccess())) {
		return errors.New("Live Photo asset access denied")
	}
	return holdEncryptedBoxRequest(c, model.ExtractBoxIDFromAssetsPath(absPath))
}

func checkLivePhotoSession(c *gin.Context, id string) error {
	absPath, err := model.LivePhotoPreviews.Origin(id)
	if err != nil {
		return err
	}
	return checkLivePhotoAsset(c, absPath)
}

var startLivePhotoPreview = contractHandler(apicontract.StartLivePhotoPreview, func(c *gin.Context, request apicontract.StartLivePhotoPreviewRequest) apicontract.Response[apicontract.LivePhotoPreviewSession] {
	assetPath, rawQuery, hasQuery := strings.Cut(request.Path, "?")
	assetPath, err := url.PathUnescape(assetPath)
	if err != nil || strings.Contains(assetPath, "?") {
		return apicontract.Failure[apicontract.LivePhotoPreviewSession](-1, "invalid Live Photo asset path")
	}
	if _, err = url.ParseQuery(rawQuery); err != nil {
		return apicontract.Failure[apicontract.LivePhotoPreviewSession](-1, "invalid Live Photo asset query")
	}
	// 路径只按 URL 解码一次，查询参数交给资源解析器，权限校验和读取使用同一个地址。
	request.Path = assetPath
	if hasQuery {
		request.Path += "?" + rawQuery
	}
	absPath, err := model.ResolveLivePhotoAssetPath(request.Path)
	if err != nil {
		return apicontract.Failure[apicontract.LivePhotoPreviewSession](-1, "Live Photo asset not found")
	}
	if err = checkLivePhotoAsset(c, absPath); err != nil {
		return apicontract.Failure[apicontract.LivePhotoPreviewSession](-1, err.Error())
	}
	session, err := model.StartLivePhotoPreview(request.Path, request.ClientEncode && model.IsAdminRoleContext(c))
	if err != nil {
		return apicontract.Failure[apicontract.LivePhotoPreviewSession](-1, err.Error())
	}
	if err = c.Request.Context().Err(); err != nil {
		model.LivePhotoPreviews.Cancel(session.ID)
		return apicontract.Failure[apicontract.LivePhotoPreviewSession](-1, "Live Photo preview cancelled")
	}
	frames := make([]apicontract.LivePhotoFrameTime, len(session.Frames))
	for i, frame := range session.Frames {
		frames[i] = apicontract.LivePhotoFrameTime{Timestamp: frame.Timestamp, Duration: frame.Duration}
	}
	return apicontract.Success(apicontract.LivePhotoPreviewSession{ID: session.ID, Encode: session.Encode,
		Width: session.Width, Height: session.Height, Frames: frames,
		Color: apicontract.LivePhotoColor{Primaries: session.Color.Primaries, Transfer: session.Color.Transfer, Matrix: session.Color.Matrix, FullRange: session.Color.FullRange}})
})

var getLivePhotoFrame = contractHandler(apicontract.GetLivePhotoFrame, func(c *gin.Context, request apicontract.LivePhotoFrameRequest) apicontract.Response[apicontract.BinaryContent] {
	if err := checkLivePhotoSession(c, request.ID); err != nil {
		return apicontract.Failure[apicontract.BinaryContent](-1, err.Error())
	}
	data, err := model.LivePhotoPreviews.Frame(c.Request.Context(), request.ID, request.Index)
	if err != nil {
		return apicontract.Failure[apicontract.BinaryContent](-1, err.Error())
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	return apicontract.WithAfterWrite(apicontract.SuccessBinary("application/octet-stream", data), func() { clear(data) })
})

var getLivePhotoPreview = contractHandler(apicontract.GetLivePhotoPreview, func(c *gin.Context, request apicontract.LivePhotoPreviewRequest) apicontract.Response[apicontract.BinaryContent] {
	if err := checkLivePhotoSession(c, request.ID); err != nil {
		return apicontract.Failure[apicontract.BinaryContent](-1, err.Error())
	}
	data, err := model.LivePhotoPreviews.Result(c.Request.Context(), request.ID)
	if err != nil {
		return apicontract.Failure[apicontract.BinaryContent](-1, err.Error())
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	return apicontract.WithAfterWrite(apicontract.SuccessBinary("video/mp4", data), func() { clear(data) })
})

var finishLivePhotoPreview = contractHandler(apicontract.FinishLivePhotoPreview, func(c *gin.Context, request apicontract.FinishLivePhotoPreviewRequest) apicontract.Response[apicontract.Null] {
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	if err := checkLivePhotoSession(c, request.ID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	if request.File == nil || request.File.Size > livephoto.MaxInputBytes {
		return apicontract.Failure[apicontract.Null](-1, "invalid Live Photo preview upload")
	}
	file, err := request.File.Open()
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, "invalid Live Photo preview upload")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, livephoto.MaxInputBytes+1))
	if err != nil || len(data) > livephoto.MaxInputBytes {
		clear(data)
		return apicontract.Failure[apicontract.Null](-1, "Live Photo preview exceeds size limit")
	}
	if err = model.LivePhotoPreviews.Submit(c.Request.Context(), request.ID, data); err != nil {
		clear(data)
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	preview, err := model.LivePhotoPreviews.Result(c.Request.Context(), request.ID)
	clear(preview)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
}, func(c *gin.Context) *apicontract.Response[apicontract.Null] {
	// 转换结果可能包含加密笔记本内容，解析时禁止 multipart 将文件溢出到系统临时目录。
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, livephoto.MaxInputBytes+1024*1024)
	if err := c.Request.ParseMultipartForm(livephoto.MaxInputBytes + 1024*1024); err != nil {
		if c.Request.MultipartForm != nil {
			c.Request.MultipartForm.RemoveAll()
		}
		response := apicontract.Failure[apicontract.Null](-1, "invalid Live Photo preview upload")
		return &response
	}
	return nil
})

var cancelLivePhotoPreview = contractHandler(apicontract.CancelLivePhotoPreview, func(c *gin.Context, request apicontract.LivePhotoPreviewRequest) apicontract.Response[apicontract.Null] {
	if _, err := model.LivePhotoPreviews.Origin(request.ID); err != nil {
		return apicontract.Success(apicontract.Null{})
	}
	if err := checkLivePhotoSession(c, request.ID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	model.LivePhotoPreviews.Cancel(request.ID)
	return apicontract.Success(apicontract.Null{})
})

var getDocPreviewImages = contractHandler(apicontract.GetDocPreviewImages, func(c *gin.Context, request apicontract.AssetDocumentRequest) apicontract.Response[[]apicontract.DocumentPreviewImage] {
	if err := holdEncryptedBlockRequests(c, "", []string{request.ID}, false); err != nil {
		return apicontract.Failure[[]apicontract.DocumentPreviewImage](-1, err.Error())
	}
	if model.IsReadOnlyRoleContext(c) && !model.CheckBlockIdAccessableByPublishAccess(c, model.GetPublishAccess(), request.ID) {
		return apicontract.Failure[[]apicontract.DocumentPreviewImage](-1, "document access denied")
	}
	images, err := model.DocPreviewImages(request.ID)
	if err != nil {
		return apicontract.Failure[[]apicontract.DocumentPreviewImage](-1, "document unavailable")
	}
	ret := make([]apicontract.DocumentPreviewImage, len(images))
	for i, image := range images {
		ret[i] = apicontract.DocumentPreviewImage{Src: image.Src, Video: image.Video, Notebook: image.Notebook}
	}
	return apicontract.Success(ret)
})
