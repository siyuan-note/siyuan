// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 地图静态资源没有用户数据；允许不携带 Cookie 的 opaque-origin 子框架读取。
// 精确白名单独立于通用 stage 路由，防止沙箱策略被路径别名绕过。
var mapHostFiles = map[string]string{
	"/stage/map/index.html":                      "stage/map/index.html",
	"/stage/map/wrapper.html":                    "stage/map/wrapper.html",
	"/stage/map/host.css":                        "stage/map/host.css",
	"/stage/build/map/host.js":                   "stage/build/map/host.js",
	"/stage/build/map/wrapper.js":                "stage/build/map/wrapper.js",
	"/stage/build/map/maplibre-gl.js":            "stage/build/map/maplibre-gl.js",
	"/stage/build/map/maplibre-gl.css":           "stage/build/map/maplibre-gl.css",
	"/stage/build/map/maplibre-gl-csp-worker.js": "stage/build/map/maplibre-gl-csp-worker.js",
	"/stage/build/map/maplibre-LICENSE.txt":      "stage/build/map/maplibre-LICENSE.txt",
}

func mapWrapperPolicy(host, provider string) (string, bool) {
	if _, valid := mapHostPolicy(host, provider); !valid {
		return "", false
	}
	// 外层只运行固定本地代码；其 frame-src 持续约束内层框架自己的导航。
	return "default-src 'none'; sandbox allow-scripts allow-same-origin; script-src " +
		host + "/stage/build/map/wrapper.js; style-src 'unsafe-inline' " + host + "/stage/map/host.css; connect-src 'none'; " +
		"frame-src " + host + "/stage/map/index.html; worker-src 'none'; object-src 'none'; " +
		"base-uri 'none'; form-action 'none'; frame-ancestors 'self'", true
}

func mapHostPolicy(host, provider string) (string, bool) {
	// CSP 的本地来源仅允许固定资源路径，不授权整个同源内核 API。
	u, err := url.Parse("http://" + host)
	if err != nil || u.Host != host || u.Hostname() == "" || u.User != nil ||
		strings.ContainsAny(host, " \t\r\n;'\"\\/?#") {
		return "", false
	}
	local := host + "/stage/build/map/"
	scripts := local + "host.js"
	connect, images, fonts, styles, workers := "'none'", "data: blob:", "'none'", "'unsafe-inline' "+host+"/stage/map/host.css", "'none'"
	switch provider {
	case "openfreemap":
		scripts += " " + local + "maplibre-gl.js"
		connect = "https://tiles.openfreemap.org " + local + "maplibre-gl-csp-worker.js"
		images += " https://tiles.openfreemap.org"
		styles += " " + local + "maplibre-gl.css"
		workers = "blob:"
	case "amap":
		scripts += " https://webapi.amap.com https://restapi.amap.com"
		workers = "blob:"
		connect = "https://webapi.amap.com https://restapi.amap.com https://vdata.amap.com"
		images += " https://webapi.amap.com https://a.amap.com https://*.is.autonavi.com"
	case "tencent":
		scripts += " https://map.qq.com"
		connect = "https://map.qq.com https://apis.map.qq.com https://*.map.qq.com"
		images += " https://map.qq.com https://*.map.qq.com"
	case "baidu":
		scripts += " https://api.map.baidu.com"
		connect = "https://api.map.baidu.com https://*.map.bdimg.com https://*.bdimg.com"
		images += " https://api.map.baidu.com https://*.map.bdimg.com https://*.bdimg.com https://*.map.baidu.com"
	default:
		return "", false
	}
	return "default-src 'none'; sandbox allow-scripts; script-src " + scripts +
		"; connect-src " + connect + "; img-src " + images + "; style-src " + styles +
		"; font-src " + fonts + "; worker-src " + workers +
		"; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'", true
}

func mapHostMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestPath := c.Request.URL.Path
		// 通用静态文件服务会清理路径；必须先识别别名再拒绝，不能让别名绕过 CSP。
		cleanPath := path.Clean(strings.ReplaceAll(requestPath, "\\", "/"))
		isMapPath := func(value string) bool {
			// 默认不区分大小写的文件系统，以及 Windows 末尾点/空格，也不能形成别名。
			parts := strings.Split(strings.ReplaceAll(value, "\\", "/"), "/")
			for i, part := range parts {
				part = strings.TrimRight(part, " ")
				if part != "." && part != ".." {
					part = strings.TrimRight(part, ". ")
				}
				parts[i] = part
			}
			value = strings.ToLower(path.Clean(strings.Join(parts, "/")))
			return value == "/stage/map" || value == "/stage/build/map" ||
				strings.HasPrefix(value, "/stage/map/") || strings.HasPrefix(value, "/stage/build/map/")
		}
		if !isMapPath(requestPath) && !isMapPath(cleanPath) {
			c.Next()
			return
		}
		c.Abort()
		file, ok := mapHostFiles[requestPath]
		if !ok || requestPath != cleanPath || c.Request.URL.RawPath != "" || (c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) {
			c.Status(http.StatusNotFound)
			return
		}
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Credentials", "")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=(), usb=(), serial=(), bluetooth=()")
		if requestPath == "/stage/map/index.html" || requestPath == "/stage/map/wrapper.html" {
			// BYPASS 模式跳过 opaque-origin 鉴权，子框架自身导航后的请求无法安全隔离。
			if util.SiYuanAccessAuthCodeBypass {
				c.Status(http.StatusForbidden)
				return
			}
			policy, valid := mapHostPolicy(c.Request.Host, c.Query("provider"))
			if requestPath == "/stage/map/wrapper.html" {
				policy, valid = mapWrapperPolicy(c.Request.Host, c.Query("provider"))
			}
			if !valid {
				c.Status(http.StatusBadRequest)
				return
			}
			c.Header("Content-Security-Policy", policy)
		}
		resource, err := os.Open(filepath.Join(util.WorkingDir, filepath.FromSlash(file)))
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		defer resource.Close()
		info, err := resource.Stat()
		if err != nil || !info.Mode().IsRegular() {
			c.Status(http.StatusNotFound)
			return
		}
		// ServeFile 会将 index.html 重定向到目录；宿主必须保持精确的受保护 URL。
		http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), resource)
	}
}
