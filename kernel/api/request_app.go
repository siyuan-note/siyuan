// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import "github.com/gin-gonic/gin"

const siyuanAppIDHeader = "X-SiYuan-App-ID"

// resolveRequestAppID 优先使用请求头，兼容已经解析的请求体 app；空标识保留旧调用的广播语义。
// 应用标识只用于通知路由，不参与认证或访问控制。
func resolveRequestAppID(c *gin.Context, bodyApp string) string {
	if headerApp := c.GetHeader(siyuanAppIDHeader); headerApp != "" {
		return headerApp
	}
	return bodyApp
}
