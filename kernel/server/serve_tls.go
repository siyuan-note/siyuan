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

package server

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// tlsEnforceMiddleware 在用户开启「启用 HTTPS」后真正强制加密传输。
//
// 内核通过 cmux 在同一端口上同时承载 HTTP 与 HTTPS，仅凭开关无法阻止明文请求，
// 因此这里在应用层把明文请求重定向到 HTTPS，避免登录流程与会话 Cookie 在网络上明文暴露。
// 本机明文请求（桌面端、固定端口反代、浏览器扩展）与 CORS 预检放行，否则本机客户端无法连接。
//
// 注册在会话中间件之前：跳转先于会话保存发生，明文响应就不会带出会话 Cookie；
// 本机明文连接上写出的 Cookie 由 secureSessionCookies 兜底补齐 Secure 属性。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-hpj5-f7cj-vvwr
func tlsEnforceMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if util.ShouldRedirectToTLS(c.Request) && util.TLSRequired() && util.TLSEnforced() {
			host := c.Request.Host
			if "" == host || !util.IsValidRedirectHost(host) {
				// Host 异常时不能据此拼出跳转地址，直接拒绝明文请求
				c.AbortWithStatus(http.StatusBadRequest)
				return
			}

			// 跳转目标取决于 Host，声明 Vary 避免中间缓存串用响应
			c.Header("Vary", "Host")
			c.Redirect(http.StatusTemporaryRedirect, "https://"+host+c.Request.URL.RequestURI())
			// 必须显式终止链：否则会话中间件仍会在明文响应上保存会话 Cookie
			c.Abort()
			return
		}

		if util.IsTLSRequest(c.Request) {
			c.Header("Strict-Transport-Security", util.StrictTransportSecurityValue)
		}

		if util.IsSecureRequest(c.Request) {
			c.Next()
			return
		}

		// 明文连接（只可能是本机客户端）上不能下发可被回传的会话 Cookie，
		// 因此在该响应写出前统一补齐会话 Cookie 的 Secure 属性。
		c.Next()
		secureSessionCookies(c)
	}
}

// secureSessionCookies 为响应中所有未标记的 Cookie 补齐 Secure 属性。
//
// 会话 Cookie 由会话中间件在响应阶段保存，其 Secure 属性来自会话选项，
// 无法在保存前按请求改写，因此在响应写出前统一处理，避免明文连接下发未标记的会话 Cookie。
func secureSessionCookies(c *gin.Context) {
	headers := c.Writer.Header()
	cookies := headers.Values("Set-Cookie")
	if 0 == len(cookies) {
		return
	}

	headers.Del("Set-Cookie")
	for _, cookie := range cookies {
		parsed, err := http.ParseSetCookie(cookie)
		if nil != err || !parsed.Secure {
			// 解析失败时按最保守的方式处理，直接补上 Secure
			cookie += "; Secure"
		}
		headers.Add("Set-Cookie", cookie)
	}
}

// notifyTLSCertUnavailable 提示用户「启用 HTTPS」因证书不可用而未能生效，避免用户误以为流量已加密。
// 内核日志已记录原始错误，这里只提示结论。
func notifyTLSCertUnavailable() {
	if util.AttachUI {
		util.WaitForUILoaded()
		time.Sleep(3 * time.Second)
	}

	util.PushErrMsg("HTTPS is enabled but the TLS certificate is unavailable, "+
		"network requests from other hosts are rejected. Restart the kernel to retry certificate generation", 15000)
}
