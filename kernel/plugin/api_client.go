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
	"github.com/gorilla/websocket"
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
			if len(call.Arguments) > 0 && goja.IsString(call.Argument(0)) {
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
			if len(call.Arguments) > 1 {
				init := call.Argument(1)
				if init != nil && !goja.IsUndefined(init) && !goja.IsNull(init) {
					if initObj := init.ToObject(rt); initObj != nil {
						if m := initObj.Get("method"); m != nil && goja.IsString(m) {
							method = m.String()
						}

						if h := initObj.Get("headers"); h != nil && !goja.IsUndefined(h) && !goja.IsNull(h) {
							if hObj := h.ToObject(rt); hObj != nil {
								if hMap, ok := h.Export().(map[string]string); ok {
									for k, v := range hMap {
										headers[k] = v
									}
								}
							}
						}

						if b := initObj.Get("body"); b != nil && !goja.IsUndefined(b) && !goja.IsNull(b) {

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
			if len(call.Arguments) > 0 && goja.IsString(call.Argument(0)) {
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
			if len(call.Arguments) > 1 {
				proto := call.Argument(1)
				if !goja.IsNull(proto) && !goja.IsUndefined(proto) {
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
			}

			var conn atomic.Pointer[websocket.Conn]
			var readyState atomic.Int64
			var bufferedAmount atomic.Int64
			messagesCh := make(chan WebSocketMessage, 256)
			connReadyCh := make(chan *websocket.Conn, 1)
			senderDoneCh := make(chan struct{})

			wsURL := fmt.Sprintf("ws://127.0.0.1:%s%s", util.ServerPort, path)
			wsHeader := http.Header{}
			wsHeader.Set(model.XAuthTokenKey, p.token)
			if len(protocols) > 0 {
				wsHeader.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
			}

			wsObj := rt.NewObject()

			lo.Must0(wsObj.Set("binaryType", rt.ToValue("arraybuffer")))
			lo.Must0(wsObj.Set("bufferedAmount", rt.ToValue(0)))
			lo.Must0(wsObj.Set("extensions", rt.ToValue("")))
			lo.Must0(wsObj.Set("protocol", rt.ToValue("")))
			lo.Must0(wsObj.Set("readyState", rt.ToValue(int64(WebSocketReadyStateConnecting))))
			lo.Must0(wsObj.Set("url", rt.ToValue("wsURL")))

			lo.Must0(wsObj.Set("onopen", goja.Null()))
			lo.Must0(wsObj.Set("onping", goja.Null()))
			lo.Must0(wsObj.Set("onpong", goja.Null()))
			lo.Must0(wsObj.Set("onerror", goja.Null()))
			lo.Must0(wsObj.Set("onmessage", goja.Null()))
			lo.Must0(wsObj.Set("onclose", goja.Null()))

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

			setReadyState(rt, WebSocketReadyStateConnecting)

			lo.Must0(wsObj.Set("send", rt.ToValue(func(sendCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				sendPromise, sendResolve, sendReject := rt.NewPromise()

				sendRunErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
					var messageData []byte
					var messageType int
					if len(sendCall.Arguments) >= 1 {
						data := sendCall.Argument(0)
						if arrayBuffer, ok := data.Export().(goja.ArrayBuffer); ok {
							messageType = websocket.BinaryMessage
							messageData = arrayBuffer.Bytes()
						} else {
							messageType = websocket.TextMessage
							messageData = []byte(data.String())
						}
					}

					state := WebSocketState(readyState.Load())
					if state == WebSocketReadyStateClosing || state == WebSocketReadyStateClosed {
						err = fmt.Errorf("WebSocket is not open (state: %d)", state)
						return
					}

					updateBufferedAmount(rt, len(messageData))

					done := make(chan FunctionResult[int], 1)

					select {
					case messagesCh <- WebSocketMessage{
						t:    messageType,
						d:    messageData,
						done: done,
					}:
						go func() {
							select {
							case result := <-done:
								p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
									if result.Error == nil {
										updateBufferedAmount(rt, -result.Value)
									} else {
										err = result.Error
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
							case <-senderDoneCh:
							}
						}()
					default:
						updateBufferedAmount(rt, -len(messageData))
						err = fmt.Errorf("WebSocket send buffer full")
					}
					return
				}, func(rt *goja.Runtime, _ any, err error) {
					if lo.IsNil(err) {
					} else {
						if rejectErr := sendReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.client.socket.send reject: %v", p.Name, rejectErr)
						}
					}
				})
				if sendRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.client.socket.send worker run: %v", p.Name, sendRunErr)
				}

				return rt.ToValue(sendPromise)
			})))

			lo.Must0(wsObj.Set("ping", rt.ToValue(func(pingCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				pingPromise, pingResolve, pingReject := rt.NewPromise()

				pingRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					var pingData string
					if len(pingCall.Arguments) > 0 && !goja.IsUndefined(pingCall.Argument(0)) {
						pingData = pingCall.Argument(0).String()
					}
					if c := conn.Load(); c != nil {
						_, err = p.writeWebSocketMessage(c, websocket.PingMessage, []byte(pingData))
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
			})))

			lo.Must0(wsObj.Set("pong", rt.ToValue(func(pongCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				pongPromise, pongResolve, pongReject := rt.NewPromise()

				pongRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					var pongData string
					if len(pongCall.Arguments) > 0 && !goja.IsUndefined(pongCall.Argument(0)) {
						pongData = pongCall.Argument(0).String()
					}
					if c := conn.Load(); c != nil {
						_, err = p.writeWebSocketMessage(c, websocket.PongMessage, []byte(pongData))
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
			})))

			lo.Must0(wsObj.Set("close", rt.ToValue(func(closeCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
				closePromise, closeResolve, closeReject := rt.NewPromise()

				closeRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					code := websocket.CloseNormalClosure
					var reason string
					if len(closeCall.Arguments) > 0 && !goja.IsUndefined(closeCall.Argument(0)) {
						code = int(closeCall.Argument(0).ToInteger())
					}
					if len(closeCall.Arguments) > 1 && !goja.IsUndefined(closeCall.Argument(1)) {
						reason = closeCall.Argument(1).String()
					}
					if c := conn.Load(); c != nil {
						_, err = p.writeWebSocketMessage(c, websocket.CloseMessage, websocket.FormatCloseMessage(code, reason))
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
			})))

			// Start a goroutine to send messages from the channel to the WebSocket connection
			go func() {
				var c *websocket.Conn
				select {
				case c = <-connReadyCh:
				case <-senderDoneCh:
					return
				}
				for {
					select {
					case m := <-messagesCh:
						amount, writeErr := p.writeWebSocketMessage(c, m.t, m.d)
						m.done <- FunctionResult[int]{Value: amount, Error: writeErr}
					case <-senderDoneCh:
						return
					}
				}
			}()

			go func() (err error) {
				defer func() {
					close(senderDoneCh)
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.client.socket: %v", r)
					}

					if err != nil {
						p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
							event := rt.NewObject()
							event.Set("type", rt.ToValue("error"))
							event.Set("error", rt.NewGoError(err))
							invokeWsHook("onerror", event)
							return
						}, nil)
					}
				}()

				dialer := websocket.Dialer{}
				c, _, dialErr := dialer.Dial(wsURL, wsHeader)
				if dialErr != nil {
					err = dialErr
					return
				}

				defer func() {
					p.UntrackSocket(c)
					c.Close()
				}()
				p.TrackSocket(c, false)

				c.SetPingHandler(func(data string) error {
					_, runError := p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
						event := rt.NewObject()
						event.Set("type", rt.ToValue("ping"))
						event.Set("data", rt.ToValue(data))
						invokeWsHook("onping", event)
						return
					})
					return runError
				})
				c.SetPongHandler(func(data string) error {
					_, runError := p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
						event := rt.NewObject()
						event.Set("type", rt.ToValue("pong"))
						event.Set("data", rt.ToValue(data))
						invokeWsHook("onpong", event)
						return
					})
					return runError
				})
				c.SetCloseHandler(func(code int, reason string) error {
					_, runError := p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
						setReadyState(rt, WebSocketReadyStateClosing)
						event := rt.NewObject()
						event.Set("type", rt.ToValue("close"))
						event.Set("code", rt.ToValue(int64(code)))
						event.Set("reason", rt.ToValue(reason))
						invokeWsHook("onclose", event)
						return
					})
					return runError
				})

				connReadyCh <- c

				_, runErr := p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
					conn.Store(c)
					wsObj.Set("protocol", c.Subprotocol())
					setReadyState(rt, WebSocketReadyStateOpen)

					// Emit the open event
					event := rt.NewObject()
					event.Set("type", rt.ToValue("open"))
					invokeWsHook("onopen", event)
					return
				})
				if runErr != nil {
					err = runErr
					return
				}

				for {
					messageType, data, readErr := c.ReadMessage()
					if readErr != nil {
						if websocket.IsUnexpectedCloseError(readErr, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
							err = readErr
						}
						return
					}
					switch messageType {
					case websocket.TextMessage:
						runErr := p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
							event := rt.NewObject()
							event.Set("type", rt.ToValue("text"))
							event.Set("data", rt.ToValue(string(data)))
							invokeWsHook("onmessage", event)
							return
						}, nil)
						if runErr != nil {
							err = runErr
							return
						}
					case websocket.BinaryMessage:
						runErr := p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
							event := rt.NewObject()
							event.Set("type", rt.ToValue("binary"))
							event.Set("data", rt.ToValue(rt.NewArrayBuffer(data)))
							invokeWsHook("onmessage", event)
							return
						}, nil)
						if runErr != nil {
							err = runErr
							return
						}
					}
				}
			}()

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
			if len(call.Arguments) > 0 && goja.IsString(call.Argument(0)) {
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
			esURL := fmt.Sprintf("http://127.0.0.1:%s%s", util.ServerPort, path)

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

			setReadyState(EventSourceConnecting)
			lo.Must0(esObj.Set("url", rt.ToValue(path)))
			lo.Must0(esObj.Set("onopen", goja.Null()))
			lo.Must0(esObj.Set("onmessage", goja.Null()))
			lo.Must0(esObj.Set("onclose", goja.Null()))
			lo.Must0(esObj.Set("onerror", goja.Null()))

			ctx, cancel := context.WithCancel(context.Background())
			sseID := p.TrackSSE(cancel)

			var closeOnce sync.Once
			close := func() {
				closeOnce.Do(func() {
					cancel()
					p.UntrackSSE(sseID)
				})
			}

			lo.Must0(esObj.Set("close", rt.ToValue(func(goja.FunctionCall) goja.Value {
				setReadyState(EventSourceClosed)
				close()
				return goja.Undefined()
			})))

			go func() (err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.client.event: %v", r)
					}

					close()

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
