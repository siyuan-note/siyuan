// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/tiffpreview"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var tiffReaderAdmission = struct {
	sync.Mutex
	total     int
	perReader map[string]int
}{perReader: make(map[string]int)}

func acquireTIFFPreviewSlot(c *gin.Context) func() {
	if model.GetGinContextRole(c) != model.RoleReader {
		if acquireImagePreviewSlot(c) {
			return sync.OnceFunc(releaseImagePreviewSlot)
		}
		return nil
	}
	value, _ := c.Get(model.ClaimsContextKey)
	claims, _ := value.(jwt.MapClaims)
	reader, _ := claims.GetSubject()

	tiffReaderAdmission.Lock()
	if tiffReaderAdmission.total >= 8 || tiffReaderAdmission.perReader[reader] >= 2 {
		tiffReaderAdmission.Unlock()
		c.Status(http.StatusServiceUnavailable)
		return nil
	}
	tiffReaderAdmission.total++
	tiffReaderAdmission.perReader[reader]++
	tiffReaderAdmission.Unlock()

	releaseReader := func() {
		tiffReaderAdmission.Lock()
		defer tiffReaderAdmission.Unlock()
		tiffReaderAdmission.total--
		if tiffReaderAdmission.perReader[reader]--; tiffReaderAdmission.perReader[reader] == 0 {
			delete(tiffReaderAdmission.perReader, reader)
		}
	}
	if !acquireImagePreviewSlot(c) {
		releaseReader()
		return nil
	}
	return sync.OnceFunc(func() {
		releaseImagePreviewSlot()
		releaseReader()
	})
}

func shouldTranscodeTIFF(c *gin.Context, path string) bool {
	return tiffpreview.IsPath(path) && !strings.EqualFold(c.Query("download"), "true")
}

// serveTIFFPreview 在资源鉴权后读取首帧，加密笔记本持有操作租约和读锁直至输出结束。
func serveTIFFPreview(c *gin.Context, path string, release func()) {
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
	serveTIFFBytes(c, path, boxID, dek, release)
}

// serveTIFFBytes 读取 TIFF 原件，按请求输出预览或原件；调用方持有加密笔记本的租约和读锁。
func serveTIFFBytes(c *gin.Context, path, boxID string, dek []byte, releasePreview func()) {
	encrypted := boxID != ""
	limit := int64(tiffpreview.MaxInputBytes)
	if encrypted {
		limit += 2 * 1024 * 1024
	}
	var source []byte
	var err error
	if releasePreview != nil {
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
	if releasePreview != nil {
		writeTIFFPreview(c, source, encrypted, releasePreview)
		return
	}
	secureAssetContentHeaders(c, path, path)
	c.Data(http.StatusOK, "image/tiff", source)
}

func writeTIFFPreview(c *gin.Context, source []byte, encrypted bool, release func()) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 12*time.Second)
	defer cancel()
	result, err := tiffpreview.GetOrCreate(ctx, source,
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
		file, err := os.Open(result.Path)
		if err != nil {
			tiffPreviewError(c, err)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			tiffPreviewError(c, err)
			return
		}
		release()
		http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), file)
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
	} else if errors.Is(err, context.DeadlineExceeded) {
		status = http.StatusGatewayTimeout
	} else if os.IsNotExist(err) {
		status = http.StatusNotFound
	}
	c.Status(status)
}
