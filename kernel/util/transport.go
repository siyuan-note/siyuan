// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

import (
	"net/http"
	"strings"
	"sync"

	"github.com/siyuan-note/logging"
)

const (
	// ClientTLSHeader 由本机的固定端口反向代理写入，标记客户端到反代这一跳是否使用 TLS。
	// 反代以 HTTPS 回源内核，若不额外标记，内核会把明文客户端的连接误判为 TLS。
	ClientTLSHeader = "X-SiYuan-Client-TLS"

	// ClientTLSHeaderValue 为标记 TLS 的头部取值。
	ClientTLSHeaderValue = "1"

	// StrictTransportSecurityValue 为 HTTPS 响应附加的 HSTS 策略，有效期一年。
	StrictTransportSecurityValue = "max-age=31536000"
)

// tlsEnforced 记录当前进程是否已经在提供 HTTPS 服务。
// 内核、固定端口反代与发布服务共用同一份工作空间证书，任一环节准备好证书即可开启强制跳转。
var (
	tlsEnforcedMu sync.Mutex
	tlsEnforced   bool

	// tlsRequired 记录用户是否开启了「启用 HTTPS」。证书可用且该值为真时才强制跳转。
	tlsRequired bool
)

// MarkTLSEnforced 记录进程已经开始提供 HTTPS 服务。
func MarkTLSEnforced() {
	tlsEnforcedMu.Lock()
	defer tlsEnforcedMu.Unlock()
	tlsEnforced = true
}

// TLSEnforced 返回当前进程是否已经在提供 HTTPS 服务。
func TLSEnforced() bool {
	tlsEnforcedMu.Lock()
	defer tlsEnforcedMu.Unlock()
	return tlsEnforced
}

// SetTLSRequired 记录用户是否开启了「启用 HTTPS」。
func SetTLSRequired(required bool) {
	tlsEnforcedMu.Lock()
	defer tlsEnforcedMu.Unlock()
	tlsRequired = required
}

// TLSRequired 返回用户是否开启了「启用 HTTPS」。
func TLSRequired() bool {
	tlsEnforcedMu.Lock()
	defer tlsEnforcedMu.Unlock()
	return tlsRequired
}

// TLSRedirectHandler 包装明文 HTTP 处理器：用户开启「启用 HTTPS」且证书可用时，
// 把来自其他主机的明文请求重定向到 HTTPS，本机明文请求与 CORS 预检放行。
//
// 内核通过 cmux 在同一端口同时承载 HTTP 与 HTTPS，固定端口反代与发布服务也是双栈，
// 仅在监听层无法阻止明文访问，因此三条入口都要经过这里。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-hpj5-f7cj-vvwr
func TLSRedirectHandler(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if ShouldRedirectToTLS(request) && TLSRequired() && TLSEnforced() {
			host := request.Host
			if "" == host || !IsValidRedirectHost(host) {
				logging.LogWarnf("reject plaintext request with invalid host [host=%s, remote=%s]",
					host, GetRemoteAddr(request))
				writer.WriteHeader(http.StatusBadRequest)
				return
			}

			// 跳转目标取决于 Host，声明 Vary 避免中间缓存串用响应
			writer.Header().Set("Vary", "Host")
			writer.Header().Set("Location", "https://"+host+request.URL.RequestURI())
			writer.WriteHeader(http.StatusTemporaryRedirect)
			return
		}

		if IsTLSRequest(request) {
			writer.Header().Set("Strict-Transport-Security", StrictTransportSecurityValue)
		}

		handler.ServeHTTP(writer, request)
	})
}

// IsSecureRequest 判断请求是否可以安全地承载会话凭据：
// 客户端连接使用 TLS，或来自本机（本机明文与内核自身 HTTPS 回源等价，且桌面端与浏览器扩展依赖本机明文）。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-hpj5-f7cj-vvwr
func IsSecureRequest(request *http.Request) bool {
	if IsTLSRequest(request) {
		return true
	}
	return IsLocalHost(request.RemoteAddr)
}

// ShouldRedirectToTLS 判断当前请求是否需要被重定向到 HTTPS。
//
// 仅在用户开启「启用 HTTPS」且证书可用时生效；本机明文请求放行，否则桌面端、
// 固定端口反代与浏览器扩展无法连接。CORS 预检不携带凭据且浏览器不跟随跳转，故同样放行。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-hpj5-f7cj-vvwr
func ShouldRedirectToTLS(request *http.Request) bool {
	if nil == request {
		return false
	}
	if IsTLSRequest(request) || IsLocalHost(request.RemoteAddr) {
		return false
	}
	if http.MethodOptions == request.Method {
		return false
	}
	// HTTPS 端口上不接受绝对形式或带协议相对前缀的请求目标，避免拼出站外跳转地址
	return !strings.HasPrefix(request.RequestURI, "//") && !strings.Contains(request.RequestURI, "://")
}
