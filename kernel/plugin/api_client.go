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
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/dop251/goja"
	"github.com/lxzan/gws"
	sse "github.com/r3labs/sse/v2"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
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

		runErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
			var path string
			if goja.IsString(call.Argument(0)) {
				path = call.Argument(0).String()
			} else {
				err = fmt.Errorf("path required")
				return
			}

			if !strings.HasPrefix(path, "/") {
				err = fmt.Errorf("path must start with /")
				return
			}

			method := "GET"
			headers := map[string]string{}
			var bodyString string
			var bodyBytes []byte

			if init := call.Argument(1); isJsValueNotNull(init) {
				if initObj := init.ToObject(rt); initObj != nil {
					if m := initObj.Get("method"); goja.IsString(m) {
						method = m.String()
					}

					if h := initObj.Get("headers"); isJsValueNotNull(h) {
						if hObj := h.ToObject(rt); hObj != nil {
							if hMap, ok := h.Export().(map[string]string); ok {
								for k, v := range hMap {
									headers[k] = v
								}
							}
						}
					}

					if b := initObj.Get("body"); isJsValueNotNull(b) {

						if goja.IsString(b) {
							bodyString = b.String()
						} else {
							body := b.Export()
							if arrayBuffer, ok := body.(goja.ArrayBuffer); ok {
								bodyBytes = arrayBuffer.Bytes()
							}
						}
					}
				}
			}

			go func() (err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.client.fetch: %v", r)
					}

					if err != nil {
						p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
							if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.client.fetch reject: %v", p.Name, rejectErr)
							}
							return
						}, nil)
					}
				}()

				targetURL := fmt.Sprintf("http://127.0.0.1:%s%s", util.ServerPort, path)
				r := httpClient.R()
				for k, v := range headers {
					r.SetHeader(k, v)
				}
				r.SetHeader(model.XAuthTokenKey, p.token)

				if bodyString != "" {
					r.SetBody(bodyString)
				} else if len(bodyBytes) > 0 {
					r.SetBody(bodyBytes)
				}

				resp, sendErr := r.Send(method, targetURL)
				if sendErr != nil {
					err = sendErr
					return
				}

				defer resp.Body.Close()
				body, readErr := io.ReadAll(resp.Body)
				if readErr != nil {
					err = fmt.Errorf("failed to read response body: %w", readErr)
					return
				}

				responseHeader := map[string]string{}
				for k, vs := range resp.Header {
					responseHeader[k] = strings.Join(vs, ", ")
				}

				runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					response := rt.NewObject()
					lo.Must0(response.Set("url", rt.ToValue(path)))
					lo.Must0(response.Set("ok", rt.ToValue(resp.StatusCode >= 200 && resp.StatusCode < 300)))
					lo.Must0(response.Set("status", rt.ToValue(resp.StatusCode)))
					lo.Must0(response.Set("statusText", rt.ToValue(resp.Status)))
					lo.Must0(response.Set("headers", rt.ToValue(responseHeader)))
					lo.Must0(ObjectSetDataMethods(p, rt, response, body))
					result = response
					return
				}, func(rt *goja.Runtime, result any, err error) {
					if lo.IsNil(err) {
						if resolveErr := resolve(result); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.fetch resolve: %v", p.Name, resolveErr)
						}
					} else {
						if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.fetch reject: %v", p.Name, rejectErr)
						}
					}
				})
				if runErr != nil {
					err = runErr
					return
				}

				return
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
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(client.Set("socket", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			var path string
			if goja.IsString(call.Argument(0)) {
				path = call.Argument(0).String()
			} else {
				err = fmt.Errorf("path required")
				return
			}

			if !strings.HasPrefix(path, "/") {
				err = fmt.Errorf("path must start with /")
				return
			}

			var protocols []string
			if proto := call.Argument(1); isJsValueNotNull(proto) {
				if protoObj := proto.ToObject(rt); protoObj != nil && protoObj.ClassName() == "Array" {
					if arr, ok := proto.Export().([]interface{}); ok {
						for _, v := range arr {
							protocols = append(protocols, fmt.Sprintf("%v", v))
						}
					}
				} else {
					protocols = []string{proto.String()}
				}
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

			invokeWsHook := func(name string, args ...goja.Value) {
				hook := wsObj.Get(name)
				if fn, ok := goja.AssertFunction(hook); ok {
					if _, callErr := fn(wsObj, args...); callErr != nil {
						logging.LogErrorf("[plugin:%s] ws hook %q: %v", p.Name, name, callErr)
					}
				}
			}

			setReadyState := func(rt *goja.Runtime, state WebSocketState) {
				readyState.Store(int64(state))
				wsObj.Set("readyState", rt.ToValue(state))
			}

			updateBufferedAmount := func(rt *goja.Runtime, delta int) {
				bufferedAmount.Add(int64(delta))
				wsObj.Set("bufferedAmount", rt.ToValue(bufferedAmount.Load()))
			}

			h := &gwsEventHandler{}

			h.onOpen = func(conn *gws.Conn) {
				p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
					wsObj.Set("protocol", conn.SubProtocol())
					setReadyState(rt, WebSocketReadyStateOpen)
					event := rt.NewObject()
					event.Set("type", rt.ToValue("open"))
					invokeWsHook("onopen", event)
					return
				}, nil)
			}

			h.onClose = func(conn *gws.Conn, closeErr error) {
				gwsConn.Store(nil)
				p.UntrackGwsSocket(conn)
				p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
					var ce *gws.CloseError
					if closeErr != nil && !errors.As(closeErr, &ce) {
						event := rt.NewObject()
						event.Set("type", rt.ToValue("error"))
						event.Set("error", rt.NewGoError(closeErr))
						invokeWsHook("onerror", event)
					}
					if ce != nil {
						setReadyState(rt, WebSocketReadyStateClosing)
						closeEvent := rt.NewObject()
						closeEvent.Set("type", rt.ToValue("close"))
						closeEvent.Set("code", rt.ToValue(int64(ce.Code)))
						closeEvent.Set("reason", rt.ToValue(string(ce.Reason)))
						closeEvent.Set("wasClean", rt.ToValue(ce.Code == 1000 || ce.Code == 1001))
						invokeWsHook("onclose", closeEvent)
					}
					setReadyState(rt, WebSocketReadyStateClosed)
					return
				}, nil)
			}

			h.onPing = func(conn *gws.Conn, payload []byte) {
				p.worker.RunSync(func(rt *goja.Runtime) (_ any, _ error) {
					event := rt.NewObject()
					event.Set("type", rt.ToValue("ping"))
					event.Set("data", rt.ToValue(string(payload)))
					invokeWsHook("onping", event)
					return
				})
			}

			h.onPong = func(conn *gws.Conn, payload []byte) {
				p.worker.RunSync(func(rt *goja.Runtime) (_ any, _ error) {
					event := rt.NewObject()
					event.Set("type", rt.ToValue("pong"))
					event.Set("data", rt.ToValue(string(payload)))
					invokeWsHook("onpong", event)
					return
				})
			}

			h.onMessage = func(conn *gws.Conn, message *gws.Message) {
				defer message.Close()
				opcode := message.Opcode
				data := make([]byte, message.Data.Len())
				copy(data, message.Bytes())
				p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
					event := rt.NewObject()
					switch opcode {
					case gws.OpcodeText:
						event.Set("type", rt.ToValue("text"))
						event.Set("data", rt.ToValue(string(data)))
					case gws.OpcodeBinary:
						event.Set("type", rt.ToValue("binary"))
						event.Set("data", rt.ToValue(rt.NewArrayBuffer(data)))
					default:
						return
					}
					invokeWsHook("onmessage", event)
					return
				}, nil)
			}

			ws_send := rt.ToValue(func(sendCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				sendPromise, sendResolve, sendReject := rt.NewPromise()

				sendRunErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
					var messageData []byte
					var opcode gws.Opcode
					if data := sendCall.Argument(0); isJsValueNotNull(data) {
						if arrayBuffer, ok := data.Export().(goja.ArrayBuffer); ok {
							opcode = gws.OpcodeBinary
							b := arrayBuffer.Bytes()
							messageData = make([]byte, len(b))
							copy(messageData, b)
						} else {
							opcode = gws.OpcodeText
							messageData = []byte(data.String())
						}
					}

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

				pingRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					var pingData string
					if isJsValueNotNull(pingCall.Argument(0)) {
						pingData = pingCall.Argument(0).String()
					}
					if c := gwsConn.Load(); c != nil {
						err = c.WritePing([]byte(pingData))
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

				pongRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					var pongData string
					if isJsValueNotNull(pongCall.Argument(0)) {
						pongData = pongCall.Argument(0).String()
					}
					if c := gwsConn.Load(); c != nil {
						err = c.WritePong([]byte(pongData))
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

				closeRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					code := uint16(1000)
					var reason []byte
					if isJsValueNotNull(closeCall.Argument(0)) {
						code = uint16(closeCall.Argument(0).ToInteger())
					}
					if isJsValueNotNull(closeCall.Argument(1)) {
						reason = []byte(closeCall.Argument(1).String())
					}
					if c := gwsConn.Load(); c != nil {
						setReadyState(rt, WebSocketReadyStateClosing)
						err = c.WriteClose(code, reason)
					}
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

			var openOnce sync.Once

			ws_open := rt.ToValue(func(openCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				openPromise, openResolve, openReject := rt.NewPromise()

				openRunErr := p.worker.Run(func(rt *goja.Runtime) (taskResult any, err error) {
					var ranFirst bool
					openOnce.Do(func() {
						ranFirst = true
						go func() {
							conn, _, dialErr := gws.NewClient(h, &gws.ClientOption{
								Addr:          wsURL,
								RequestHeader: wsHeader,
							})
							if dialErr != nil {
								p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
									event := rt.NewObject()
									event.Set("type", rt.ToValue("error"))
									event.Set("error", rt.NewGoError(dialErr))
									invokeWsHook("onerror", event)
									return
								}, nil)
								p.worker.Run(func(rt *goja.Runtime) (_ any, dialErr2 error) {
									dialErr2 = dialErr
									return
								}, func(rt *goja.Runtime, _ any, dialErr2 error) {
									if rejectErr := openReject(rt.NewGoError(dialErr2)); rejectErr != nil {
										logging.LogErrorf("[plugin:%s] siyuan.client.socket.open reject: %v", p.Name, rejectErr)
									}
								})
								return
							}
							gwsConn.Store(conn)
							p.TrackGwsSocket(conn, false)
							// Resolve the open promise before starting ReadLoop so the caller
							// can await open() and then rely on onopen for additional setup.
							p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) { return },
								func(rt *goja.Runtime, _ any, _ error) {
									if resolveErr := openResolve(nil); resolveErr != nil {
										logging.LogErrorf("[plugin:%s] siyuan.client.socket.open resolve: %v", p.Name, resolveErr)
									}
								})
							conn.ReadLoop()
						}()
					})
					if !ranFirst {
						// Subsequent calls: signal callback to resolve immediately.
						taskResult = true
					}
					return
				}, func(rt *goja.Runtime, taskResult any, err error) {
					if !lo.IsNil(err) {
						if rejectErr := openReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.open reject: %v", p.Name, rejectErr)
						}
						return
					}
					if resolveNow, _ := taskResult.(bool); resolveNow {
						if resolveErr := openResolve(nil); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.open resolve: %v", p.Name, resolveErr)
						}
					}
				})
				if openRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.socket.open worker run: %v", p.Name, openRunErr)
				}

				return rt.ToValue(openPromise)
			})

			lo.Must0(wsObj.Set("binaryType", rt.ToValue("arraybuffer")))
			lo.Must0(wsObj.Set("bufferedAmount", rt.ToValue(bufferedAmount.Load())))
			lo.Must0(wsObj.Set("extensions", rt.ToValue("")))
			lo.Must0(wsObj.Set("protocol", rt.ToValue("")))
			lo.Must0(wsObj.Set("readyState", rt.ToValue(readyState.Load())))
			lo.Must0(wsObj.Set("url", rt.ToValue(wsURL)))

			lo.Must0(wsObj.Set("onopen", goja.Null()))
			lo.Must0(wsObj.Set("onping", goja.Null()))
			lo.Must0(wsObj.Set("onpong", goja.Null()))
			lo.Must0(wsObj.Set("onerror", goja.Null()))
			lo.Must0(wsObj.Set("onmessage", goja.Null()))
			lo.Must0(wsObj.Set("onclose", goja.Null()))

			lo.Must0(wsObj.Set("send", ws_send))
			lo.Must0(wsObj.Set("ping", ws_ping))
			lo.Must0(wsObj.Set("pong", ws_pong))
			lo.Must0(wsObj.Set("close", ws_close))
			lo.Must0(wsObj.Set("open", ws_open))

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
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(client.Set("event", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			var path string
			if goja.IsString(call.Argument(0)) {
				path = call.Argument(0).String()
			} else {
				err = fmt.Errorf("path required")
				return
			}

			if !strings.HasPrefix(path, "/") {
				err = fmt.Errorf("path must start with /")
				return
			}

			var readyState atomic.Int64

			readyState.Store(int64(EventSourceConnecting))

			esURL := fmt.Sprintf("http://127.0.0.1:%s%s", util.ServerPort, path)

			ctx, cancel := context.WithCancel(context.Background())

			sseID := p.TrackSSE(cancel)
			var closeOnce sync.Once
			doClose := func() {
				closeOnce.Do(func() {
					cancel()
					p.UntrackSSE(sseID)
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

			go func() (err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.client.event: %v", r)
					}

					doClose()

					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if EventSourceState(readyState.Load()) != EventSourceClosed {
							if err != nil && !errors.Is(err, context.Canceled) {
								event := rt.NewObject()
								event.Set("type", rt.ToValue("error"))
								event.Set("error", rt.NewGoError(err))
								invokeEsHook("onerror", event)
							}
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
				return
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
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, client))

	lo.Must0(siyuan.Set("client", client))
	return
}
