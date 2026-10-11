// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

func retiredStaticResourcesMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 升级后磁盘上可能仍有旧地图产物，禁止通过通用静态路由及文件系统路径别名访问。
		parts := strings.Split(strings.ReplaceAll(c.Request.URL.Path, "\\", "/"), "/")
		for i, part := range parts {
			part = strings.TrimRight(part, " ")
			if part != "." && part != ".." {
				part = strings.TrimRight(part, ". ")
			}
			parts[i] = part
		}
		requestPath := strings.ToLower(path.Clean(strings.Join(parts, "/")))
		if requestPath == "/stage/map" || strings.HasPrefix(requestPath, "/stage/map/") ||
			requestPath == "/stage/build/map" || strings.HasPrefix(requestPath, "/stage/build/map/") {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		c.Next()
	}
}
