// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/tiffpreview"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func shouldTranscodeTIFF(c *gin.Context, path string) bool {
	return tiffpreview.IsPath(path) && !strings.EqualFold(c.Query("download"), "true")
}

// serveTIFFPreview 在资源鉴权后读取首帧，加密笔记本持有操作租约和读锁直至输出结束。
func serveTIFFPreview(c *gin.Context, path string) {
	boxID := util.BoxIDFromDataPath(path)
	encrypted := boxID != "" && model.IsEncryptedBox(boxID)
	var dek []byte
	if encrypted {
		setEncryptedAssetCacheHeaders(c)
		if err := model.AcquireEncryptedBoxOperation(boxID); err != nil {
			c.Status(http.StatusForbidden)
			return
		}
		defer model.ReleaseEncryptedBoxOperation(boxID)
		model.HoldBoxReadLock(boxID)
		defer model.ReleaseBoxReadLock(boxID)
		var err error
		dek, err = model.GetDEKIfUnlocked(boxID)
		if err != nil {
			c.Status(http.StatusForbidden)
			return
		}
		defer clear(dek)
	}
	if !encrypted {
		boxID = ""
	}
	serveTIFFBytes(c, path, boxID, dek, true)
}

// serveTIFFBytes 读取 TIFF 原件，按请求输出预览或原件；调用方持有加密笔记本的租约和读锁。
func serveTIFFBytes(c *gin.Context, path, boxID string, dek []byte, preview bool) {
	encrypted := boxID != ""
	limit := int64(tiffpreview.MaxInputBytes)
	if encrypted {
		limit += 2 * 1024 * 1024
	}
	var source []byte
	var err error
	if preview {
		source, err = tiffpreview.ReadFileLimited(path, limit)
	} else {
		source, err = os.ReadFile(path)
	}
	if err != nil {
		tiffPreviewError(c, err)
		return
	}
	if encrypted {
		decrypted, decErr := model.DecryptAsset(boxID, filepath.Base(path), dek, source)
		clear(source)
		if decErr != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		source = decrypted
		defer clear(source)
	}
	if preview {
		writeTIFFPreview(c, source, encrypted)
		return
	}
	secureAssetContentHeaders(c, path, path)
	c.Data(http.StatusOK, "image/tiff", source)
}

// servePlainTIFFPreview 处理普通历史文件或快照预览。
func servePlainTIFFPreview(c *gin.Context, path string) {
	serveTIFFBytes(c, path, "", nil, true)
}

func writeTIFFPreview(c *gin.Context, source []byte, encrypted bool) {
	result, err := tiffpreview.GetOrCreate(c.Request.Context(), source,
		filepath.Join(util.TempDir, "assets-cache", "tiff"), c.Query("style") == "thumb", encrypted)
	if err != nil {
		tiffPreviewError(c, err)
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Type", "image/png")
	if encrypted {
		setEncryptedAssetCacheHeaders(c)
		defer clear(result.Data)
	} else {
		c.Header("ETag", result.ETag)
		if c.GetHeader("If-None-Match") == result.ETag {
			c.Status(http.StatusNotModified)
			return
		}
	}
	if result.Path != "" {
		http.ServeFile(c.Writer, c.Request, result.Path)
		return
	}
	c.Data(http.StatusOK, "image/png", result.Data)
}

func tiffPreviewError(c *gin.Context, err error) {
	if errors.Is(err, c.Request.Context().Err()) {
		return
	}
	status := http.StatusUnprocessableEntity
	if errors.Is(err, tiffpreview.ErrInputTooLarge) || errors.Is(err, tiffpreview.ErrImageTooLarge) {
		status = http.StatusRequestEntityTooLarge
	} else if os.IsNotExist(err) {
		status = http.StatusNotFound
	}
	c.Status(status)
}
