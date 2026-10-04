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

package plugin

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dop251/goja"
	"github.com/imroc/req/v3"
	"github.com/lxzan/gws"
	sse "github.com/r3labs/sse/v2"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/plugin/abort"
	"github.com/siyuan-note/siyuan/kernel/plugin/formdata"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// injectClient adds siyuan.server to the goja context.
func injectClient(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectClient: %v", r)
		}
	}()

	client := rt.NewObject()

	lo.Must0(client.Set("fetch", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var path string
		method := "GET"
		headers := map[string]string{}
		var bodyString *string
		var bodyBytes *[]byte
		var bodyContentType string     // 请求体自带的媒体类型（如 FormData 的 multipart boundary），调用方未显式设置 Content-Type 时使用
		timeout := fetchDefaultTimeout // 只约束到收到响应头为止，不覆盖读取响应体的过程，与浏览器 fetch 的 timeout/signal 分离语义一致
		var signal *abort.SignalState

		if goja.IsString(call.Argument(0)) {
			path = call.Argument(0).String()
		} else {
			argErr = fmt.Errorf("path required")
		}
		if argErr == nil && !strings.HasPrefix(path, "/") {
			argErr = fmt.Errorf("path must start with /")
		}
		if argErr == nil {
			if init := call.Argument(1); isJsValueNotNull(init) {
				if initObj := init.ToObject(rt); initObj != nil {
					if m := initObj.Get("method"); goja.IsString(m) {
						method = m.String()
					}

					if h := initObj.Get("headers"); isJsValueNotNull(h) {
						if exportErr := rt.ExportTo(h, &headers); exportErr != nil {
							argErr = fmt.Errorf("failed to export headers: %w", exportErr)
						}
					}

					if argErr == nil {
						if b := initObj.Get("body"); isJsValueNotNull(b) {
							if goja.IsString(b) {
								bodyString = new(b.String())
							} else if formData, ok := formdata.StateOf(b); ok {
								// 在调用时完成编码，之后对 FormData 的修改不影响本次请求（与 fetch 规范一致）。
								body, contentType := formData.EncodeMultipart()
								bodyBytes = &body
								bodyContentType = contentType
							} else {
								body := b.Export()
								if arrayBuffer, ok := body.(goja.ArrayBuffer); ok {
									// ArrayBuffer.Bytes() 指向 JS 引擎内存，异步发送前需复制，避免脚本后续修改与发送并发读写。
									bodyBytes = new(bytes.Clone(arrayBuffer.Bytes()))
								}
							}
						}
					}

					if argErr == nil {
						if t := initObj.Get("timeout"); isJsValueNotNull(t) {
							timeout, argErr = fetchTimeoutOf(t)
						}
					}

					if argErr == nil {
						if s := initObj.Get("signal"); isJsValueNotNull(s) {
							signal, argErr = abort.SignalOf(rt, s, "signal")
						}
					}
				}
			}
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
			if argErr != nil {
				err = argErr
				return
			}

			// 请求发出前 signal 已经中止：不发送请求，直接以 reason reject。
			if signal != nil && signal.Aborted() {
				if rejectErr := reject(signal.Reason()); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.fetch reject: %v", p.Name, rejectErr)
				}
				return
			}

			// 以插件上下文为父上下文，使插件停止时取消未完成的请求（包括之后读取响应体的过程）；signal 中止时
			// 额外取消。timeout 改由下面的计时器手动驱动，只在收到响应头之前触发一次取消，收到响应头后计时器
			// 被停掉，ctx 之后只受插件停止与 signal 中止约束，不再因为 timeout 打断正在读取的响应体。
			ctx, cancel := context.WithCancel(p.context)

			var timedOut atomic.Bool
			var timeoutTimer *time.Timer
			if timeout > 0 {
				timeoutTimer = time.AfterFunc(timeout, func() {
					timedOut.Store(true)
					cancel()
				})
			}

			// abortHookFired 记录取消是否来自 signal 中止，与超时、插件停止等其他取消来源区开；
			// 依赖 Store/Load 建立的 happens-before 关系，该标记为 true 之后再读取 signal.Reason() 是安全的
			// （triggerAbort 在调用 goHooks 前已写入 reason，且其后不再修改）。
			var abortHookFired atomic.Bool
			if signal != nil {
				signal.AddAbortHook(func() {
					abortHookFired.Store(true)
					cancel()
				})
			}

			rejectWith := func(reason goja.Value, err error) {
				p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
					if reason == nil {
						reason = rt.NewGoError(err)
					}
					if rejectErr := reject(reason); rejectErr != nil {
						logging.LogErrorf("[plugin:%s] siyuan.client.fetch reject: %v", p.Name, rejectErr)
					}
					return
				}, nil)
			}

			go func() {
				var err error
				var rejectReason goja.Value // 中止时改用它而不是 err（包装成 Error）进行 reject，reason 可以是任意值

				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.client.fetch: %v", r)
						rejectReason = nil
					}
					if err != nil || rejectReason != nil {
						cancel() // 请求失败或被中止，没有响应体需要保留，直接释放 ctx
						rejectWith(rejectReason, err)
					}
				}()

				targetURL := fmt.Sprintf("http://127.0.0.1:%s%s", util.ServerPort, path)
				// 禁用自动读取响应体：Send 只负责等到响应头，响应体留给 response.body/text() 等按需读取，
				// 从而让 fetch() 的 Promise 在收到响应头时就 resolve，不必等整个响应体传完。
				r := httpClient.R().SetContext(ctx).DisableAutoReadResponse()
				for k, v := range headers {
					r.SetHeader(k, v)
				}
				if bodyContentType != "" && r.Headers.Get("Content-Type") == "" {
					r.SetHeader("Content-Type", bodyContentType)
				}
				r.SetHeader(model.XAuthTokenKey, p.token)

				if bodyString != nil {
					r.SetBody(*bodyString)
				} else if bodyBytes != nil {
					r.SetBody(*bodyBytes)
				}

				resp, sendErr := r.Send(method, targetURL)
				if timeoutTimer != nil {
					timeoutTimer.Stop() // 响应头已经到达（或者发送已经失败），此后不再因为 timeout 取消 ctx
				}
				if sendErr != nil {
					if abortHookFired.Load() {
						rejectReason = signal.Reason()
						return
					}
					err = sendErr
					if timedOut.Load() {
						err = fmt.Errorf("request timed out after %s: %w", timeout, sendErr)
					}
					return
				}

				responseHeader := map[string]string{}
				for k, vs := range resp.Header {
					responseHeader[k] = strings.Join(vs, ", ")
				}

				body := &fetchResponseBody{resp: resp, cancel: cancel}
				runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					response := rt.NewObject()
					lo.Must0(response.Set("url", rt.ToValue(path)))
					lo.Must0(response.Set("ok", rt.ToValue(resp.StatusCode >= 200 && resp.StatusCode < 300)))
					lo.Must0(response.Set("status", rt.ToValue(resp.StatusCode)))
					lo.Must0(response.Set("statusText", rt.ToValue(resp.Status)))
					lo.Must0(response.Set("headers", rt.ToValue(responseHeader)))
					if setErr := setFetchResponseBodyMethods(p, rt, response, body); setErr != nil {
						err = setErr
						return
					}
					result = response
					return
				}, func(rt *goja.Runtime, result any, err error) {
					if lo.IsNil(err) {
						if resolveErr := resolve(result); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.fetch resolve: %v", p.Name, resolveErr)
						}
					} else {
						cancel()
						if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.fetch reject: %v", p.Name, rejectErr)
						}
					}
				})
				if runErr != nil {
					err = runErr
					return
				}
			}()

			return
		}, func(rt *goja.Runtime, _ any, err error) {
			if !lo.IsNil(err) {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.fetch reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.client.fetch worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.client.fetch reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(client.Set("socket", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var path string
		var protocols []string

		if goja.IsString(call.Argument(0)) {
			path = call.Argument(0).String()
		} else {
			argErr = fmt.Errorf("path required")
		}
		if argErr == nil && !strings.HasPrefix(path, "/") {
			argErr = fmt.Errorf("path must start with /")
		}
		if argErr == nil {
			if proto := call.Argument(1); isJsValueNotNull(proto) {
				if protoObj := proto.ToObject(rt); protoObj != nil && protoObj.ClassName() == "Array" {
					if arr, ok := proto.Export().([]any); ok {
						for _, v := range arr {
							protocols = append(protocols, fmt.Sprintf("%v", v))
						}
					}
				} else {
					protocols = []string{proto.String()}
				}
			}
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}

			var gwsConn atomic.Pointer[gws.Conn]
			var readyState atomic.Int64
			var bufferedAmount atomic.Int64

			readyState.Store(int64(WebSocketReadyStateConnecting))

			wsURL := fmt.Sprintf("ws://127.0.0.1:%s%s", util.ServerPort, path)
			wsHeader := http.Header{}
			wsHeader.Set(model.XAuthTokenKey, p.token)
			if len(protocols) > 0 {
				wsHeader.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
			}

			wsObj := rt.NewObject()

			invokeHook := func(_ *goja.Runtime, name string, args ...goja.Value) {
				hook := wsObj.Get(name)
				if fn, ok := goja.AssertFunction(hook); ok {
					if _, callErr := fn(wsObj, args...); callErr != nil {
						logging.LogErrorf("[plugin:%s] ws hook %q: %v", p.Name, name, callErr)
					}
				}
			}

			setProtocol := func(rt *goja.Runtime, protocol string) {
				wsObj.Set("protocol", rt.ToValue(protocol))
			}

			setReadyState := func(rt *goja.Runtime, state WebSocketState) {
				readyState.Store(int64(state))
				wsObj.Set("readyState", rt.ToValue(state))
			}

			updateBufferedAmount := func(rt *goja.Runtime, delta int) {
				bufferedAmount.Add(int64(delta))
				wsObj.Set("bufferedAmount", rt.ToValue(bufferedAmount.Load()))
			}

			h := &WsEventHandler{p: p}

			manager := &WsManager{
				BufferedAmount: &bufferedAmount,

				InvokeHook:    invokeHook,
				SetProtocol:   setProtocol,
				SetReadyState: setReadyState,
			}

			h.BindOnOpen(manager)
			h.BindOnClose(manager)
			h.BindOnPing(manager)
			h.BindOnPong(manager)
			h.BindOnMessage(manager)

			var openOnce sync.Once
			var openPromises []Promise

			addOpenPromise := func(resolve, reject func(reason interface{}) error) {
				// nil slice 也可以直接 append
				openPromises = append(openPromises, Promise{Resolve: resolve, Reject: reject})
			}

			resolveOpenPromises := func(rt *goja.Runtime) {
				if openPromises != nil {
					for _, promise := range openPromises {
						if resolveErr := promise.Resolve(nil); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.open resolve: %v", p.Name, resolveErr)
						}
					}
					openPromises = nil
				}
			}

			rejectOpenPromises := func(rt *goja.Runtime, err error) {
				if openPromises != nil {
					for _, promise := range openPromises {
						if rejectErr := promise.Reject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.open reject: %v", p.Name, rejectErr)
						}
					}
					openPromises = nil
				}
			}

			ctx, cancel := context.WithCancel(p.context)

			var closeOnce sync.Once
			doClose := func() {
				closeOnce.Do(func() {
					cancel()
				})
			}

			ws_open := rt.ToValue(func(openCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				openPromise, openResolve, openReject := rt.NewPromise()

				openRunErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
					state := WebSocketState(readyState.Load())
					switch state {
					case WebSocketReadyStateOpen:
						if resolveErr := openResolve(nil); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.open resolve: %v", p.Name, resolveErr)
						}
						return
					case WebSocketReadyStateClosing:
						err = fmt.Errorf("WebSocket is closing")
						return
					case WebSocketReadyStateClosed:
						err = fmt.Errorf("WebSocket is closed")
						return
					}

					addOpenPromise(openResolve, openReject)
					openOnce.Do(func() {
						go func() {
							conn, _, dialErr := gws.NewClient(h, &gws.ClientOption{
								Addr:          wsURL,
								RequestHeader: wsHeader,
							})
							if dialErr != nil {
								p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
									setReadyState(rt, WebSocketReadyStateClosed)

									event := rt.NewObject()
									event.Set("type", rt.ToValue("error"))
									event.Set("error", rt.NewGoError(dialErr))
									invokeHook(rt, "onerror", event)

									rejectOpenPromises(rt, dialErr)
									return
								}, nil)
								doClose()
								return
							}
							if ctx.Err() != nil {
								// close-before-open
								conn.NetConn().Close()
								p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
									setReadyState(rt, WebSocketReadyStateClosed)
									rejectOpenPromises(rt, ctx.Err())
									return
								}, nil)
								return
							}
							gwsConn.Store(conn)
							go func() {
								<-ctx.Done()
								conn.NetConn().Close()
							}()
							// Resolve the open promise before starting ReadLoop so the caller
							// can await open() and then rely on onopen for additional setup.
							p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
								resolveOpenPromises(rt)
								return
							}, nil)

							conn.ReadLoop()
							doClose()
						}()
					})
					return
				}, func(rt *goja.Runtime, _ any, err error) {
					if lo.IsNil(err) {
					} else {
						if rejectErr := openReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.open reject: %v", p.Name, rejectErr)
						}
					}
				})
				if openRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.socket.open worker run: %v", p.Name, openRunErr)
				}

				return rt.ToValue(openPromise)
			})

			ws_send := rt.ToValue(func(sendCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				sendPromise, sendResolve, sendReject := rt.NewPromise()

				var messageData []byte
				var opcode gws.Opcode
				if data := sendCall.Argument(0); isJsValueNotNull(data) {
					if arrayBuffer, ok := data.Export().(goja.ArrayBuffer); ok {
						opcode = gws.OpcodeBinary
						b := arrayBuffer.Bytes()
						messageData = make([]byte, len(b))
						copy(messageData, b) // ArrayBuffer.Bytes() points into JS engine memory; copy before async send
					} else {
						opcode = gws.OpcodeText
						messageData = []byte(data.String())
					}
				}

				sendRunErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
					state := WebSocketState(readyState.Load())
					if state == WebSocketReadyStateClosing || state == WebSocketReadyStateClosed {
						err = fmt.Errorf("WebSocket is not open (state: %d)", state)
						return
					}

					c := gwsConn.Load()
					if c == nil {
						err = fmt.Errorf("WebSocket not yet connected")
						return
					}

					updateBufferedAmount(rt, len(messageData))
					c.WriteAsync(opcode, messageData, func(writeErr error) {
						p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
							if writeErr == nil {
								updateBufferedAmount(rt, -len(messageData))
							} else {
								err = writeErr
							}
							return
						}, func(rt *goja.Runtime, result any, err error) {
							if lo.IsNil(err) {
								if resolveErr := sendResolve(result); resolveErr != nil {
									logging.LogErrorf("[plugin:%s] siyuan.client.socket.send resolve: %v", p.Name, resolveErr)
								}
							} else {
								if rejectErr := sendReject(rt.NewGoError(err)); rejectErr != nil {
									logging.LogErrorf("[plugin:%s] siyuan.client.socket.send reject: %v", p.Name, rejectErr)
								}
							}
						})
					})
					return
				}, func(rt *goja.Runtime, _ any, err error) {
					if !lo.IsNil(err) {
						if rejectErr := sendReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.send reject: %v", p.Name, rejectErr)
						}
					}
				})
				if sendRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.socket.send worker run: %v", p.Name, sendRunErr)
				}

				return rt.ToValue(sendPromise)
			})

			ws_ping := rt.ToValue(func(pingCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				pingPromise, pingResolve, pingReject := rt.NewPromise()

				var pingData string
				if isJsValueNotNull(pingCall.Argument(0)) {
					pingData = pingCall.Argument(0).String()
				}

				pingRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					if c := gwsConn.Load(); c != nil {
						err = c.WritePing([]byte(pingData))
					} else {
						err = fmt.Errorf("WebSocket not yet connected")
					}
					return
				}, func(rt *goja.Runtime, result any, err error) {
					if lo.IsNil(err) {
						if resolveErr := pingResolve(result); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.ping resolve: %v", p.Name, resolveErr)
						}
					} else {
						if rejectErr := pingReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.ping reject: %v", p.Name, rejectErr)
						}
					}
				})
				if pingRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.socket.ping worker run: %v", p.Name, pingRunErr)
				}

				return rt.ToValue(pingPromise)
			})

			ws_pong := rt.ToValue(func(pongCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				pongPromise, pongResolve, pongReject := rt.NewPromise()

				var pongData string
				if isJsValueNotNull(pongCall.Argument(0)) {
					pongData = pongCall.Argument(0).String()
				}

				pongRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					if c := gwsConn.Load(); c != nil {
						err = c.WritePong([]byte(pongData))
					} else {
						err = fmt.Errorf("WebSocket not yet connected")
					}
					return
				}, func(rt *goja.Runtime, result any, err error) {
					if lo.IsNil(err) {
						if resolveErr := pongResolve(result); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.pong resolve: %v", p.Name, resolveErr)
						}
					} else {
						if rejectErr := pongReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.pong reject: %v", p.Name, rejectErr)
						}
					}
				})
				if pongRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.socket.pong worker run: %v", p.Name, pongRunErr)
				}

				return rt.ToValue(pongPromise)
			})

			ws_close := rt.ToValue(func(closeCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				closePromise, closeResolve, closeReject := rt.NewPromise()

				code := uint16(1000)
				var reason []byte
				if isJsValueNotNull(closeCall.Argument(0)) {
					code = uint16(closeCall.Argument(0).ToInteger())
				}
				if isJsValueNotNull(closeCall.Argument(1)) {
					reason = []byte(closeCall.Argument(1).String())
				}

				closeRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					if c := gwsConn.Load(); c != nil {
						setReadyState(rt, WebSocketReadyStateClosing)
						err = c.WriteClose(code, reason)
					} else {
						setReadyState(rt, WebSocketReadyStateClosed)
					}
					doClose()
					return
				}, func(rt *goja.Runtime, result any, err error) {
					if lo.IsNil(err) {
						if resolveErr := closeResolve(result); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.close resolve: %v", p.Name, resolveErr)
						}
					} else {
						if rejectErr := closeReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.close reject: %v", p.Name, rejectErr)
						}
					}
				})
				if closeRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.socket.close worker run: %v", p.Name, closeRunErr)
				}

				return rt.ToValue(closePromise)
			})

			lo.Must0(wsObj.Set("binaryType", rt.ToValue("arraybuffer")))
			lo.Must0(wsObj.Set("bufferedAmount", rt.ToValue(bufferedAmount.Load())))
			lo.Must0(wsObj.Set("extensions", rt.ToValue("")))
			lo.Must0(wsObj.Set("protocol", rt.ToValue("")))
			lo.Must0(wsObj.Set("readyState", rt.ToValue(readyState.Load())))
			lo.Must0(wsObj.Set("url", rt.ToValue(wsURL)))

			lo.Must0(wsObj.Set("onopen", goja.Null()))
			lo.Must0(wsObj.Set("onmessage", goja.Null()))
			lo.Must0(wsObj.Set("onping", goja.Null()))
			lo.Must0(wsObj.Set("onpong", goja.Null()))
			lo.Must0(wsObj.Set("onclose", goja.Null()))
			lo.Must0(wsObj.Set("onerror", goja.Null()))

			lo.Must0(wsObj.Set("open", ws_open))
			lo.Must0(wsObj.Set("send", ws_send))
			lo.Must0(wsObj.Set("ping", ws_ping))
			lo.Must0(wsObj.Set("pong", ws_pong))
			lo.Must0(wsObj.Set("close", ws_close))

			lo.Must0(ObjectSeal(rt, wsObj))

			result = wsObj
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.socket resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.socket reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.client.socket worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.client.socket reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(client.Set("event", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var path string
		if goja.IsString(call.Argument(0)) {
			path = call.Argument(0).String()
		} else {
			argErr = fmt.Errorf("path required")
		}
		if argErr == nil && !strings.HasPrefix(path, "/") {
			argErr = fmt.Errorf("path must start with /")
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}

			var readyState atomic.Int64

			readyState.Store(int64(EventSourceConnecting))

			esURL := fmt.Sprintf("http://127.0.0.1:%s%s", util.ServerPort, path)

			ctx, cancel := context.WithCancel(p.context)

			var closeOnce sync.Once
			doClose := func() {
				closeOnce.Do(func() {
					cancel()
				})
			}

			esObj := rt.NewObject()

			setReadyState := func(state EventSourceState) {
				readyState.Store(int64(state))
				esObj.Set("readyState", rt.ToValue(state))
			}

			invokeEsHook := func(name string, args ...goja.Value) {
				hook := esObj.Get(name)
				if fn, ok := goja.AssertFunction(hook); ok {
					if _, callErr := fn(esObj, args...); callErr != nil {
						logging.LogErrorf("[plugin:%s] es hook %q: %v", p.Name, name, callErr)
					}
				}
			}

			es_close := rt.ToValue(func(goja.FunctionCall) goja.Value {
				setReadyState(EventSourceClosed)
				doClose()
				return goja.Undefined()
			})

			lo.Must0(esObj.Set("readyState", rt.ToValue(readyState.Load())))
			lo.Must0(esObj.Set("url", rt.ToValue(path)))

			lo.Must0(esObj.Set("onopen", goja.Null()))
			lo.Must0(esObj.Set("onmessage", goja.Null()))
			lo.Must0(esObj.Set("onclose", goja.Null()))
			lo.Must0(esObj.Set("onerror", goja.Null()))

			lo.Must0(esObj.Set("close", es_close))

			lo.Must0(ObjectSeal(rt, esObj))

			setReadyState(EventSourceConnecting)

			go func() {
				var err error
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.client.event: %v", r)
					}

					doClose()

					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if err != nil && !errors.Is(err, context.Canceled) {
							event := rt.NewObject()
							event.Set("type", rt.ToValue("error"))
							event.Set("error", rt.NewGoError(err))
							invokeEsHook("onerror", event)
						}
						if EventSourceState(readyState.Load()) != EventSourceClosed {
							setReadyState(EventSourceClosed)
						}
						return
					}, nil)
				}()

				sseClient := sse.NewClient(esURL)
				sseClient.Headers[model.XAuthTokenKey] = p.token

				sseClient.OnConnect(func(_ *sse.Client) {
					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						setReadyState(EventSourceOpen)
						event := rt.NewObject()
						event.Set("type", rt.ToValue("open"))
						invokeEsHook("onopen", event)
						return
					}, nil)
				})

				sseClient.OnDisconnect(func(_ *sse.Client) {
					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						setReadyState(EventSourceClosed)
						event := rt.NewObject()
						event.Set("type", rt.ToValue("close"))
						invokeEsHook("onclose", event)
						return
					}, nil)
				})

				err = sseClient.SubscribeRawWithContext(ctx, func(msg *sse.Event) {
					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						typ := "message"
						if len(msg.Event) > 0 {
							typ = string(msg.Event)
						}
						event := rt.NewObject()
						event.Set("type", rt.ToValue(typ))
						event.Set("data", rt.ToValue(string(msg.Data)))
						event.Set("lastEventId", rt.ToValue(string(msg.ID)))
						invokeEsHook("onmessage", event)
						return
					}, nil)
				})
			}()

			result = esObj
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.event resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.event reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.client.event worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.client.event reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, client))

	lo.Must0(siyuan.Set("client", client))
	return
}

// fetchTimeoutOf 将 siyuan.client.fetch 的 init.timeout（毫秒）转换为请求时限，返回 0 表示不限时。
func fetchTimeoutOf(value goja.Value) (timeout time.Duration, err error) {
	// 只接受数值类型：不转换字符串，也不调用对象的 valueOf 等脚本代码。
	milliseconds := math.NaN()
	if goja.IsNumber(value) {
		milliseconds = value.ToFloat()
	}
	if math.IsNaN(milliseconds) || math.IsInf(milliseconds, 0) || milliseconds < 0 {
		err = fmt.Errorf("timeout must be a non-negative finite number")
		return
	}

	// 不足 1 纳秒的正数向上取整，避免变成表示不限时的 0；超出 time.Duration 范围时取最大值。
	nanoseconds := math.Ceil(milliseconds * float64(time.Millisecond))
	if nanoseconds >= math.MaxInt64 {
		timeout = math.MaxInt64
		return
	}
	timeout = time.Duration(nanoseconds)
	return
}

// fetchStreamChunkSize 是 siyuan.client.fetch 流式读取响应体时每次向底层连接请求的字节数。
const fetchStreamChunkSize = 32 * 1024

// fetchResponseBody 管理一次 fetch 响应体的消费：response.body 的 ReadableStream 与 text()/json()/buffer()/
// arrayBuffer()/bytes()/blob() 共享同一个只能读一次的底层字节源（resp.Body），哪个先开始读就"认领"它，
// 其余路径都会得到"响应体已经被读取"的错误——与真实 fetch 的 bodyUsed 语义一致，而不是像本沙箱其它数据对象
// 那样允许反复调用：响应体现在是真正流式到达、边读边释放的，不会先整体缓存一份供多次读取。claimed 只在
// 事件循环线程上读写，不需要加锁。
type fetchResponseBody struct {
	resp    *req.Response
	cancel  context.CancelFunc
	claimed bool
}

// claim 第一次调用时把 claimed 置真并返回 true；此后调用返回 false。
func (b *fetchResponseBody) claim() bool {
	if b.claimed {
		return false
	}
	b.claimed = true
	return true
}

// finish 关闭底层连接并释放请求的 ctx；body 读完、出错或被取消后都应该调用一次。
func (b *fetchResponseBody) finish() {
	b.resp.Body.Close()
	b.cancel()
}

// setFetchResponseBodyMethods 给 fetch 的响应对象设置 body 属性与 text()/json()/buffer()/arrayBuffer()/
// bytes()/blob() 方法。body 是一个按需、分块读取 resp.Body 的 ReadableStream<Uint8Array>；六个数据方法里
// 最先被调用的一个会把响应体整体读入内存后再转换成对应形式，和 body 的流式读取互斥，谁先开始读谁赢。
func setFetchResponseBodyMethods(p *KernelPlugin, rt *goja.Runtime, response *goja.Object, body *fetchResponseBody) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("setFetchResponseBodyMethods: %v", r)
		}
	}()

	lo.Must0(response.Set("body", newFetchResponseBodyStream(p, rt, body)))

	contentType := body.resp.Header.Get("Content-Type")
	for _, name := range []string{"text", "json", "buffer", "arrayBuffer", "bytes", "blob"} {
		methodName := name
		lo.Must0(response.Set(methodName, rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
			promise, resolve, reject := rt.NewPromise()
			if !body.claim() {
				if rejectErr := reject(rt.NewTypeError("body stream already read")); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.fetch %s() reject: %v", p.Name, methodName, rejectErr)
				}
				return rt.ToValue(promise)
			}

			go func() {
				data, readErr := io.ReadAll(body.resp.Body)
				body.finish()

				p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
					if readErr != nil {
						if rejectErr := reject(rt.NewGoError(fmt.Errorf("failed to read response body: %w", readErr))); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.fetch %s() reject: %v", p.Name, methodName, rejectErr)
						}
						return
					}

					// 复用既有数据对象的六个方法实现，避免在这里重复一遍 text/json/buffer/arrayBuffer/bytes/blob
					// 各自的转换逻辑；data 已经是这次响应体专属的切片，不会被其它调用方共享或改写。
					inner, innerErr := NewDataObject(p, rt, data, contentType)
					if innerErr != nil {
						if rejectErr := reject(rt.NewGoError(innerErr)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.fetch %s() reject: %v", p.Name, methodName, rejectErr)
						}
						return
					}
					innerMethod, ok := goja.AssertFunction(inner.Get(methodName))
					if !ok {
						if rejectErr := reject(rt.NewTypeError("internal error: %s is not callable", methodName)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.fetch %s() reject: %v", p.Name, methodName, rejectErr)
						}
						return
					}
					innerResult, callErr := innerMethod(inner)
					if callErr != nil {
						if rejectErr := reject(rt.NewGoError(callErr)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.fetch %s() reject: %v", p.Name, methodName, rejectErr)
						}
						return
					}
					forwardPromise(rt, innerResult, resolve, reject)
					return
				}, nil)
			}()

			return rt.ToValue(promise)
		})))
	}
	return
}

// newFetchResponseBodyStream 构造 response.body：按 fetchStreamChunkSize 分块、按需从 resp.Body 读取的
// ReadableStream<Uint8Array>。第一次拉取数据时才会去抢 body 的"认领权"，抢输了（某个数据方法先拿到）就把
// controller 错误化；拉到 EOF 时关闭底层连接并 close() controller；读取出错时同样关闭连接并 error()。
// cancel() 时直接关闭底层连接，不再继续读取。highWaterMark 必须是 0：非 0 时 desiredSize>0 会让流一构造出来
// 就主动 pull 一次，不等任何 reader 读取就先把响应体读掉，和 text()/blob() 等方法抢着认领 body；0 时只有
// reader 真正调用 read() 之后才会触发第一次 pull。
func newFetchResponseBodyStream(p *KernelPlugin, rt *goja.Runtime, body *fetchResponseBody) *goja.Object {
	started := false
	finished := false // 已经读到过 EOF/出错/被取消：这几种情况都不该再发起下一次网络读取或再 close()/error() 一次
	return p.streamsHost.NewReadableStream(nil, func(controller goja.Value) goja.Value {
		if finished {
			return nil
		}
		if !started {
			if !body.claim() {
				finished = true
				callControllerMethod(rt, controller, "error", rt.NewTypeError("body stream already read"))
				return nil
			}
			started = true
		}

		// pull 算法要返回一个在这一块真正读完前都不落定的 Promise：readableController 用它的落定状态判断
		// "这次拉取有没有结束"，如果提前返回已经落定的值（nil 会被当成 undefined，立即算结束），背压机制会
		// 认为可以立刻再拉一次，导致还没读完上一块就对同一个 resp.Body 并发发起下一次 Read，彼此踩踏。
		promise, resolve, _ := rt.NewPromise()
		go func() {
			buf := make([]byte, fetchStreamChunkSize)
			n, readErr := body.resp.Body.Read(buf)
			p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
				defer func() {
					if resolveErr := resolve(goja.Undefined()); resolveErr != nil {
						logging.LogErrorf("[plugin:%s] siyuan.client.fetch response.body pull resolve: %v", p.Name, resolveErr)
					}
				}()
				if finished {
					return
				}
				if n > 0 {
					callControllerMethod(rt, controller, "enqueue", uint8ArrayOf(p, rt, buf[:n]))
				}
				switch {
				case readErr == io.EOF:
					finished = true
					body.finish()
					callControllerMethod(rt, controller, "close")
				case readErr != nil:
					finished = true
					body.finish()
					callControllerMethod(rt, controller, "error", rt.NewGoError(readErr))
				}
				return
			}, nil)
		}()
		return rt.ToValue(promise)
	}, func(reason goja.Value) goja.Value {
		finished = true
		body.finish()
		return nil
	}, 0, nil)
}

// uint8ArrayOf 把 data 包装为 Uint8Array：data 已经是不会再被其它调用方共享或改写的独立切片，直接作为
// ArrayBuffer 的底层存储，不需要再复制一次。
func uint8ArrayOf(p *KernelPlugin, rt *goja.Runtime, data []byte) goja.Value {
	value, err := p.formDataHost.NewUint8Array(rt, data)
	if err != nil {
		panic(err)
	}
	return value
}

// callControllerMethod 调用 ReadableStream controller 上的方法（enqueue/close/error），用于 Go 驱动的
// pull/cancel 算法把结果交回 controller；方法不存在或调用失败只记录日志，不中断调用方。
func callControllerMethod(rt *goja.Runtime, controller goja.Value, method string, args ...goja.Value) {
	obj := controller.ToObject(rt)
	fn, ok := goja.AssertFunction(obj.Get(method))
	if !ok {
		logging.LogErrorf("controller.%s is not a function", method)
		return
	}
	if _, err := fn(obj, args...); err != nil {
		logging.LogErrorf("controller.%s(): %v", method, err)
	}
}

// forwardPromise 把 value（预期是一个 Promise）的落定结果转发给 resolve/reject；value 不是 Promise 时直接
// 用它的值调用 resolve。
func forwardPromise(rt *goja.Runtime, value goja.Value, resolve, reject func(any) error) {
	promise, ok := value.Export().(*goja.Promise)
	if !ok {
		if err := resolve(value); err != nil {
			logging.LogErrorf("forwardPromise resolve: %v", err)
		}
		return
	}

	object := rt.ToValue(promise).ToObject(rt)
	then, ok := goja.AssertFunction(object.Get("then"))
	if !ok {
		if err := resolve(value); err != nil {
			logging.LogErrorf("forwardPromise resolve: %v", err)
		}
		return
	}
	if _, err := then(object,
		rt.ToValue(func(call goja.FunctionCall) goja.Value {
			if err := resolve(call.Argument(0)); err != nil {
				logging.LogErrorf("forwardPromise resolve: %v", err)
			}
			return goja.Undefined()
		}),
		rt.ToValue(func(call goja.FunctionCall) goja.Value {
			if err := reject(call.Argument(0)); err != nil {
				logging.LogErrorf("forwardPromise reject: %v", err)
			}
			return goja.Undefined()
		}),
	); err != nil {
		panic(err)
	}
}
