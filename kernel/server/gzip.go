// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

// Agent SSE 需要底层写截止时间和 FlushError，gzip writer 未透传这两个能力。
func gzipMiddleware() gin.HandlerFunc {
	return gzip.Gzip(gzip.DefaultCompression,
		gzip.WithExcludedExtensions([]string{".png", ".gif", ".jpeg", ".jpg", ".webp", ".avif", ".pdf", ".mp3", ".wav", ".ogg", ".mov", ".weba", ".mkv", ".mp4", ".webm", ".flac", ".gz"}),
		gzip.WithExcludedPathsRegexs([]string{`(?i)\.hei[cf]$`, `^/api/ai/agent/chat$`}))
}
