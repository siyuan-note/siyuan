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
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"

	"github.com/dop251/goja"
	"github.com/lxzan/gws"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
)

// buildWebSocketObject 构造一个语义与浏览器 WebSocket 一致的 JS 对象,使 siyuan.net.ws
// 返回的对象形态与 siyuan.client.socket 保持一致。wsURL 为完整的 ws/wss 地址,wsHeader 为握手头(由调用方决定是否注入鉴权),
// protocols 为子协议列表。返回的对象含 open/send/ping/pong/close 方法与 onopen/onmessage/onping/
// onpong/onclose/onerror 回调,readyState/bufferedAmount 等属性,以及生命周期绑定到 KernelPlugin.context。
func buildWebSocketObject(p *KernelPlugin, rt *goja.Runtime, wsURL string, wsHeader http.Header, protocols []string) (*goja.Object, error) {
	var gwsConn atomic.Pointer[gws.Conn]
	var readyState atomic.Int64
	var bufferedAmount atomic.Int64

	readyState.Store(int64(WebSocketReadyStateConnecting))

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

	ctx, cancel := context.WithCancel(p.context)
	var closeOnce sync.Once
	doClose := func() {
		closeOnce.Do(func() {
			cancel()
		})
	}

	ws_open := rt.ToValue(func(openCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
		openPromise, openResolve, openReject := rt.NewPromise()

		openRunErr := p.worker.Run(func(rt *goja.Runtime) (opening any, err error) {
			opening = false
			openOnce.Do(func() {
				opening = true
				go func() {
					conn, _, dialErr := gws.NewClient(h, &gws.ClientOption{
						Addr:          wsURL,
						RequestHeader: wsHeader,
					})
					if dialErr != nil {
						p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
							setReadyState(rt, WebSocketReadyStateClosed)

							event := rt.NewObject()
							event.Set("type", rt.ToValue("error"))
							event.Set("error", rt.NewGoError(dialErr))
							invokeHook(rt, "onerror", event)

							closeEvent := rt.NewObject()
							closeEvent.Set("type", rt.ToValue("close"))
							closeEvent.Set("code", rt.ToValue(1006))
							closeEvent.Set("reason", rt.ToValue(dialErr.Error()))
							closeEvent.Set("wasClean", rt.ToValue(false))
							invokeHook(rt, "onclose", closeEvent)

							err = dialErr
							return
						}, func(rt *goja.Runtime, _ any, err error) {
							if rejectErr := openReject(rt.NewGoError(err)); rejectErr != nil {
								logging.LogErrorf("[plugin:%s] ws.open reject: %v", p.Name, rejectErr)
							}
						})
						doClose()
						return
					}
					gwsConn.Store(conn)
					go func() {
						<-ctx.Done()
						conn.NetConn().Close()
					}()
					// 先 resolve open promise,再进入 ReadLoop,保证调用方可 await open() 后再依赖 onopen
					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if resolveErr := openResolve(nil); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] ws.open resolve: %v", p.Name, resolveErr)
						}
						return
					}, nil)
					conn.ReadLoop()
					doClose()
				}()
			})
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if opening, ok := result.(bool); !ok || !opening {
					if resolveErr := openResolve(nil); resolveErr != nil {
						logging.LogErrorf("[plugin:%s] ws.open resolve: %v", p.Name, resolveErr)
					}
				}
			} else {
				if rejectErr := openReject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] ws.open reject: %v", p.Name, rejectErr)
				}
			}
		})
		if openRunErr != nil {
			logging.LogErrorf("[plugin:%s] ws.open worker run: %v", p.Name, openRunErr)
			if rejectErr := openReject(rt.NewGoError(openRunErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] ws.open reject: %v", p.Name, rejectErr)
			}
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
				copy(messageData, b) // ArrayBuffer.Bytes() 指向 JS 引擎内存,异步发送前必须拷贝
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
					updateBufferedAmount(rt, -len(messageData))
					if writeErr != nil {
						err = writeErr
					}
					return
				}, func(rt *goja.Runtime, result any, err error) {
					if lo.IsNil(err) {
						if resolveErr := sendResolve(result); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] ws.send resolve: %v", p.Name, resolveErr)
						}
					} else {
						if rejectErr := sendReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] ws.send reject: %v", p.Name, rejectErr)
						}
					}
				})
			})
			return
		}, func(rt *goja.Runtime, _ any, err error) {
			if !lo.IsNil(err) {
				if rejectErr := sendReject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] ws.send reject: %v", p.Name, rejectErr)
				}
			}
		})
		if sendRunErr != nil {
			logging.LogErrorf("[plugin:%s] ws.send worker run: %v", p.Name, sendRunErr)
			if rejectErr := sendReject(rt.NewGoError(sendRunErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] ws.send reject: %v", p.Name, rejectErr)
			}
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
					logging.LogErrorf("[plugin:%s] ws.ping resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := pingReject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] ws.ping reject: %v", p.Name, rejectErr)
				}
			}
		})
		if pingRunErr != nil {
			logging.LogErrorf("[plugin:%s] ws.ping worker run: %v", p.Name, pingRunErr)
			if rejectErr := pingReject(rt.NewGoError(pingRunErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] ws.ping reject: %v", p.Name, rejectErr)
			}
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
					logging.LogErrorf("[plugin:%s] ws.pong resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := pongReject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] ws.pong reject: %v", p.Name, rejectErr)
				}
			}
		})
		if pongRunErr != nil {
			logging.LogErrorf("[plugin:%s] ws.pong worker run: %v", p.Name, pongRunErr)
			if rejectErr := pongReject(rt.NewGoError(pongRunErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] ws.pong reject: %v", p.Name, rejectErr)
			}
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
			}
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := closeResolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] ws.close resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := closeReject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] ws.close reject: %v", p.Name, rejectErr)
				}
			}
		})
		if closeRunErr != nil {
			logging.LogErrorf("[plugin:%s] ws.close worker run: %v", p.Name, closeRunErr)
			if rejectErr := closeReject(rt.NewGoError(closeRunErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] ws.close reject: %v", p.Name, rejectErr)
			}
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

	return wsObj, nil
}
