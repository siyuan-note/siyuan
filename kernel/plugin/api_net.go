// SiYuan - Refactor your thinking
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

package plugin

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
)

// netWhitelist 存储每个插件已显式授权的可拨号对端 host(小写 host:port),用于 siyuan.net.ws 绕过
// 内核 SSRF 防护。白名单由插件自行通过 siyuan.net.setTrustedPeers 声明,内核仅校验不主动写入。
var netWhitelist sync.Map // map[*KernelPlugin]map[string]struct

// injectNet 向 goja 上下文注入 siyuan.net 命名空间,提供受限的出站 WebSocket 拨号能力。
// 仅允许拨向本插件通过 setTrustedPeers 显式授权的对端,从而在 LAN 同步等场景下绕过内核 SSRF 防护,
// 同时避免无差别开放出站网络。拨号底层复用 gws.NewClient(标准 net.Dial,不走 SSRFSafeDialer)。
func injectNet(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectNet: %v", r)
		}
	}()

	go func() {
		<-p.context.Done()
		netWhitelist.Delete(p)
	}()

	netObj := rt.NewObject()

	// siyuan.net.setTrustedPeers(hosts) — 覆盖写本插件可拨号的对端 host 白名单。hosts 为字符串数组,
	// 元素可为 "host:port" 或完整 URL;无端口的 host 会被规范化补默认端口(ws=80,wss=443)。
	lo.Must0(netObj.Set("setTrustedPeers", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		set := map[string]struct{}{}
		if arr := call.Argument(0); isJsArray(rt, arr) {
			if exported, ok := arr.Export().([]interface{}); ok {
				for _, v := range exported {
					if h := normalizePeerHost(fmt.Sprintf("%v", v)); h != "" {
						set[h] = struct{}{}
					}
				}
			}
		}
		netWhitelist.Store(p, set)
		return goja.Undefined()
	})))

	// siyuan.net.ws(url, opts) — 建立到任意已授权对端的 WebSocket,返回对象形态与 siyuan.client.socket 一致。
	// opts.headers 为握手头(可放对端 API Token),opts.protocols 为子协议。拨号前强制校验 url 的 host 命中白名单。
	lo.Must0(netObj.Set("ws", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var wsURL string
		headers := map[string]string{}
		var protocols []string

		if goja.IsString(call.Argument(0)) {
			wsURL = strings.TrimSpace(call.Argument(0).String())
		} else {
			argErr = fmt.Errorf("url required")
		}
		if argErr == nil {
			if u, parseErr := url.Parse(wsURL); parseErr != nil || u.Host == "" || (u.Scheme != "ws" && u.Scheme != "wss") {
				argErr = fmt.Errorf("url must be ws/wss")
			} else if !isPeerTrusted(p, u) {
				argErr = fmt.Errorf("target host %q is not in trusted peers: call siyuan.net.setTrustedPeers first", u.Host)
			}
		}
		if argErr == nil {
			if opts := call.Argument(1); isJsValueNotNull(opts) {
				if optsObj := opts.ToObject(rt); optsObj != nil {
					if h := optsObj.Get("headers"); isJsValueNotNull(h) {
						if exportErr := rt.ExportTo(h, &headers); exportErr != nil {
							argErr = fmt.Errorf("failed to export headers: %w", exportErr)
						}
					}
					if argErr == nil {
						if pr := optsObj.Get("protocols"); isJsValueNotNull(pr) {
							if prObj := pr.ToObject(rt); prObj != nil && prObj.ClassName() == "Array" {
								if arr, ok := pr.Export().([]interface{}); ok {
									for _, v := range arr {
										protocols = append(protocols, fmt.Sprintf("%v", v))
									}
								}
							} else {
								protocols = []string{pr.String()}
							}
						}
					}
				}
			}
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}
			wsHeader := http.Header{}
			for k, v := range headers {
				wsHeader.Set(k, v)
			}
			if len(protocols) > 0 {
				wsHeader.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
			}
			return buildWebSocketObject(p, rt, wsURL, wsHeader, protocols)
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.net.ws resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.net.ws reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.net.ws worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.net.ws reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, netObj))

	lo.Must0(siyuan.Set("net", netObj))
	return
}

// normalizePeerHost 从 "host:port" 或完整 URL 字符串提取小写的 host:port,无端口时按 scheme 补默认端口。
// 无法解析时返回空字符串。
func normalizePeerHost(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		if ip := net.ParseIP(s); ip != nil {
			return net.JoinHostPort(strings.ToLower(ip.String()), "80")
		}
	}
	// 无 scheme 时补 ws:// 以便 url.Parse 正确分离 host
	if !strings.Contains(s, "://") {
		s = "ws://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return ""
	}
	return normalizeWebSocketURLHost(u)
}

// isPeerTrusted 校验目标 URL 的 host(含端口)是否在该插件的白名单内。
// 无端口的 host 按 scheme 补默认端口(ws=80,wss=443),与 normalizePeerHost 保持一致。
func isPeerTrusted(p *KernelPlugin, u *url.URL) bool {
	if u == nil {
		return false
	}
	raw, ok := netWhitelist.Load(p)
	if !ok {
		return false
	}
	set, ok := raw.(map[string]struct{})
	if !ok {
		return false
	}
	host := normalizeWebSocketURLHost(u)
	if host == "" {
		return false
	}
	_, ok = set[host]
	return ok
}

func normalizeWebSocketURLHost(u *url.URL) string {
	if u == nil || u.Host == "" {
		return ""
	}

	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	if host == "" {
		return ""
	}

	port := u.Port()
	if port == "" {
		switch strings.ToLower(u.Scheme) {
		case "wss", "https":
			port = "443"
		default:
			port = "80"
		}
	}

	return net.JoinHostPort(host, port)
}
