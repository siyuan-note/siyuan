// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func serveCustomEmojiFile(c *gin.Context, target string) {
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
	switch strings.ToLower(filepath.Ext(target)) {
	case ".svg":
		const maxEmojiSVGBytes = 10 * 1024 * 1024
		file, err := os.Open(target)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, maxEmojiSVGBytes+1))
		if err != nil {
			c.Status(http.StatusUnprocessableEntity)
			return
		}
		if len(data) > maxEmojiSVGBytes {
			c.Status(http.StatusRequestEntityTooLarge)
			return
		}
		sanitized, err := util.SanitizeSVG(string(data))
		if err != nil {
			c.Status(http.StatusUnprocessableEntity)
			return
		}
		c.Header("Content-Type", "image/svg+xml")
		http.ServeContent(c.Writer, c.Request, filepath.Base(target), time.Time{}, strings.NewReader(sanitized))
		return
	default:
		if mediaType := assetInlineMediaType(target); strings.HasPrefix(mediaType, "image/") {
			c.Header("Content-Type", mediaType)
		} else {
			c.Header("Content-Type", "application/octet-stream")
			c.Header("Content-Disposition", formatContentDispositionAttachment(filepath.Base(target)))
		}
	}
	http.ServeFile(c.Writer, c.Request, target)
}
