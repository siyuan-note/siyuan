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

		var argErr error
		var path string
		method := "GET"
		headers := map[string]string{}
		var bodyString *string
		var bodyBytes *[]byte

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
								bodyString = lo.ToPtr(b.String())
							} else {
								body := b.Export()
								if arrayBuffer, ok := body.(goja.ArrayBuffer); ok {
									src := arrayBuffer.Bytes()
									bodyBytes = lo.ToPtr(src)
								}
							}
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

			go func() {
				var err error
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

				if bodyString != nil {
					r.SetBody(*bodyString)
				} else if bodyBytes != nil {
					r.SetBody(*bodyBytes)
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

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}

			wsURL := fmt.Sprintf("ws://127.0.0.1:%s%s", util.ServerPort, path)
			wsHeader := http.Header{}
			wsHeader.Set(model.XAuthTokenKey, p.token)
			if len(protocols) > 0 {
				wsHeader.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
			}

			return buildWebSocketObject(p, rt, wsURL, wsHeader, protocols)
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
