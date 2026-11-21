// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http"
	"runtime/debug"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func recoverAPI(c *gin.Context) {
	if !strings.HasPrefix(c.FullPath(), "/api/") {
		return
	}
	encoding := c.Writer.Header().Get("Content-Encoding")
	defer func() {
		failure := recover()
		if failure == nil {
			return
		}
		if failure == http.ErrAbortHandler {
			panic(failure)
		}
		logging.LogErrorf("PANIC RECOVERED: %v\n%s", failure, debug.Stack())
		if c.Writer.Written() {
			c.Abort()
			return
		}

		// 恢复在压缩层关闭写入器及请求释放笔记本租约前完成。
		c.Header("Content-Encoding", encoding)
		for _, header := range []string{"Content-Disposition", "Content-Length", "Content-Range", "ETag", "Last-Modified"} {
			c.Header(header, "")
		}
		c.Header("Content-Type", "application/json; charset=utf-8")
		message := "An unexpected error occurred while processing the request. Check the system log"
		if model.Conf != nil {
			if localized := model.Conf.Language(473); localized != "" {
				message = localized
			}
		}
		c.AbortWithStatusJSON(http.StatusInternalServerError, apicontract.Failure[apicontract.Null](-1, message))
	}()
	c.Next()
}
