// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	crand "crypto/rand"
	"encoding/hex"
	"net/http"

	"github.com/88250/gulu"
)

// LocalProxyHeader 是内置 fixed-port 代理回源时携带的进程内标记头。
// 第三方反向代理无法得知该标记，带转发头的请求不能再据此获得本机信任。
const LocalProxyHeader = "X-Siyuan-Local-Proxy"

// LocalProxyToken 是仅存在于当前进程内的随机标记，由内置 fixed-port 代理注入。
var LocalProxyToken = newLocalProxyToken()

func newLocalProxyToken() string {
	buf := make([]byte, 32)
	if _, err := crand.Read(buf); nil == err {
		return hex.EncodeToString(buf)
	}
	return gulu.Rand.String(64)
}

// IsLocalProxyRequest 判断请求是否由内置 fixed-port 代理转发。
func IsLocalProxyRequest(request *http.Request) bool {
	return nil != request && LocalProxyToken == request.Header.Get(LocalProxyHeader)
}

// HasForwardedHeaders 判断请求是否携带反向代理转发头。
// 这些头可能由调用方伪造，反向代理未经改写时不能作为本机信任依据。
func HasForwardedHeaders(request *http.Request) bool {
	if nil == request {
		return false
	}
	return "" != request.Header.Get("X-Forwarded-For") ||
		"" != request.Header.Get("X-Forwarded-Host") ||
		"" != request.Header.Get("X-Forwarded-Proto") ||
		"" != request.Header.Get("X-Real-IP") ||
		"" != request.Header.Get("Forwarded")
}
