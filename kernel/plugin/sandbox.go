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
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/buffer"
	"github.com/dop251/goja_nodejs/console"
	"github.com/dop251/goja_nodejs/require"
	"github.com/dop251/goja_nodejs/url"
	"github.com/gorilla/websocket"
	"github.com/imroc/req/v3"
	"github.com/samber/lo"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type WebSocketState int64

const (
	WebSocketReadyStateConnecting WebSocketState = iota
	WebSocketReadyStateOpen
	WebSocketReadyStateClosing
	WebSocketReadyStateClosed
)

var (
	client *req.Client = req.C()
)

type Printer struct {
	name string // plugin name for log prefix
}

func (p *Printer) print(s string, logf func(format string, v ...interface{})) {
	rows := strings.Split(s, "\n")
	for _, row := range rows {
		logf("[plugin:%s] %s", p.name, row)
	}
}

func (p *Printer) Log(s string) {
	p.print(s, logging.LogInfof)
}

func (p *Printer) Warn(s string) {
	p.print(s, logging.LogWarnf)
}

func (p *Printer) Error(s string) {
	p.print(s, logging.LogErrorf)
}

// EnableExtendModules registers extended modules (e.g. url, buffer) to the plugin's goja runtime.
func EnableExtendModules(p *KernelPlugin, rt *goja.Runtime) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("failed to enable extend modules: %v", r)
		}
	}()

	registry := require.NewRegistry()

	registry.Enable(rt)
	registry.RegisterNativeModule(
		console.ModuleName,
		console.RequireWithPrinter(&Printer{name: p.Name}),
	)

	url.Enable(rt)
	buffer.Enable(rt)
	console.Enable(rt)
	return
}

// EnableSiyuanModule injects all siyuan.* APIs into the plugin's goja global context.
func EnableSiyuanModule(p *KernelPlugin, rt *goja.Runtime) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("failed to inject global context: %v", r)
		}
	}()

	siyuan := rt.NewObject()

	lo.Must0(injectPlugin(p, rt, siyuan))
	lo.Must0(injectEvent(p, rt, siyuan))
	lo.Must0(injectLogger(p, rt, siyuan))
	lo.Must0(injectStorage(p, rt, siyuan))
	lo.Must0(injectRpc(p, rt, siyuan))
	lo.Must0(injectFetch(p, rt, siyuan))
	lo.Must0(injectSocket(p, rt, siyuan))

	lo.Must0(ObjectFreeze(rt, siyuan))

	lo.Must0(rt.GlobalObject().Set("siyuan", siyuan))
	return
}

// injectPlugin adds siyuan.plugin to the goja context.
func injectPlugin(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectPlugin: %v", r)
		}
	}()

	lifecycle := rt.NewObject()
	lo.Must0(lifecycle.Set("onload", goja.Null()))
	lo.Must0(lifecycle.Set("onloaded", goja.Null()))
	lo.Must0(lifecycle.Set("onrunning", goja.Null()))
	lo.Must0(lifecycle.Set("onunload", goja.Null()))
	lo.Must0(ObjectSeal(rt, lifecycle))

	plugin := rt.NewObject()
	lo.Must0(plugin.Set("name", p.Name))
	lo.Must0(plugin.Set("version", p.Version))
	lo.Must0(plugin.Set("displayName", p.DisplayName))
	lo.Must0(plugin.Set("platform", bazaar.GetCurrentBackend()))
	lo.Must0(plugin.Set("i18n", p.I18n))
	lo.Must0(plugin.Set("lifecycle", lifecycle))
	lo.Must0(ObjectFreeze(rt, plugin))

	lo.Must0(siyuan.Set("plugin", plugin))
	return
}

// injectLogger adds siyuan.logger to the goja context.
func injectLogger(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectLogger: %v", r)
		}
	}()

	logger := rt.NewObject()

	lo.Must0(logger.Set("trace", rt.ToValue(loggerWrapper(p, logging.LogTracef))))
	lo.Must0(logger.Set("debug", rt.ToValue(loggerWrapper(p, logging.LogDebugf))))
	lo.Must0(logger.Set("info", rt.ToValue(loggerWrapper(p, logging.LogInfof))))
	lo.Must0(logger.Set("warn", rt.ToValue(loggerWrapper(p, logging.LogWarnf))))
	lo.Must0(logger.Set("error", rt.ToValue(loggerWrapper(p, logging.LogErrorf))))

	lo.Must0(ObjectFreeze(rt, logger))

	lo.Must0(siyuan.Set("logger", logger))
	return
}

// injectEvent adds siyuan.event to the goja context.
func injectEvent(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectLogger: %v", r)
		}
	}()

	event := rt.NewObject()

	lo.Must0(event.Set("handler", goja.Null()))

	lo.Must0(event.Set("emit", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if len(call.Arguments) < 2 {
				err = fmt.Errorf("topic and event required")
				return
			}

			topic := call.Argument(0).String()
			if topic == "" {
				err = fmt.Errorf("topic required")
				return
			}

			eventGo := call.Argument(1).Export()
			eventJson, marshalErr := json.Marshal(eventGo)
			if marshalErr != nil {
				err = marshalErr
				return
			}

			p.bus.Publish(topic, eventJson)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.event.emit resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.event.emit reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.event.emit worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectSeal(rt, event))

	lo.Must0(siyuan.Set("event", event))
	return
}

// injectStorage adds siyuan.storage.* methods for scoped file CRUD.
func injectStorage(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectStorage: %v", r)
		}
	}()

	baseDir := filepath.Join(util.DataDir, "storage", "petal", p.Name)

	resolvePath := func(relPath string) (abs string, err error) {
		abs = filepath.Join(baseDir, filepath.Clean(relPath))
		if !(abs == baseDir || strings.HasPrefix(abs, baseDir+string(filepath.Separator))) {
			err = fmt.Errorf("siyuan.storage: path traversal not allowed")
		}
		return
	}

	storage := rt.NewObject()

	// siyuan.storage.get(path) -> Promise<{text, json, arrayBuffer}>
	lo.Must0(storage.Set("get", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			var path string
			if len(call.Arguments) >= 1 && goja.IsString(call.Argument(0)) {
				path = call.Argument(0).String()
			} else {
				err = fmt.Errorf("path required")
				return
			}

			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				err = resolveErr
				return
			}

			data, readErr := filelock.ReadFile(abs)
			if readErr != nil {
				err = readErr
				return
			}

			content := rt.NewObject()
			if setErr := ObjectSetDataMethods(p, rt, content, data); setErr != nil {
				err = setErr
				return
			}

			result = content
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.get resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.get reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.storage.get worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.put(path, content) -> Promise<void>
	lo.Must0(storage.Set("put", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if len(call.Arguments) < 2 {
				err = fmt.Errorf("path and content required")
				return
			}
			path := call.Argument(0).String()
			content := call.Argument(1).String()
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				err = resolveErr
				return
			}
			if mkdirErr := os.MkdirAll(filepath.Dir(abs), 0755); mkdirErr != nil {
				err = fmt.Errorf("failed to make directory: %w", mkdirErr)
				return
			}
			if writeErr := filelock.WriteFile(abs, []byte(content)); writeErr != nil {
				err = fmt.Errorf("failed to write file: %w", writeErr)
				return
			}
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.put resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.put reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.storage.put worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.remove(path) -> Promise<void>
	lo.Must0(storage.Set("remove", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if len(call.Arguments) < 1 {
				err = fmt.Errorf("path required")
				return
			}
			path := call.Argument(0).String()
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				err = resolveErr
				return
			}
			if abs == baseDir {
				err = fmt.Errorf("cannot remove storage root")
				return
			}
			if removeErr := os.RemoveAll(abs); removeErr != nil {
				err = fmt.Errorf("failed to remove: %w", removeErr)
				return
			}
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.remove resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.remove reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.storage.remove worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.list(path) -> Promise<Entry[]>
	lo.Must0(storage.Set("list", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if len(call.Arguments) < 1 {
				err = fmt.Errorf("path required")
				return
			}
			path := call.Argument(0).String()
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				err = resolveErr
				return
			}

			entries, readErr := os.ReadDir(abs)
			if readErr != nil {
				err = fmt.Errorf("failed to read directory: %w", readErr)
				return
			}

			results := make([]R, 0, len(entries))
			for _, entry := range entries {
				info, infoErr := entry.Info()
				if infoErr != nil {
					continue
				}
				results = append(results, R{
					"name":      entry.Name(),
					"isDir":     info.IsDir(),
					"isSymlink": util.IsSymlink(entry),
					"updated":   info.ModTime().Unix(),
				})
			}

			result = results
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.list resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.list reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.storage.list worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, storage))

	lo.Must0(siyuan.Set("storage", storage))
	return
}

// injectFetch adds siyuan.fetch method that tunnels HTTP requests to the kernel's REST API.
func injectFetch(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectFetch: %v", r)
		}
	}()

	lo.Must0(siyuan.Set("fetch", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
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

			targetURL := fmt.Sprintf("http://127.0.0.1:%s%s", util.ServerPort, path)
			r := client.R()
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
				err = fmt.Errorf("failed to send request: %w", sendErr)
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
					logging.LogErrorf("[plugin:%s] siyuan.fetch resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.fetch reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.fetch worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))
	return
}

// injectSocket adds siyuan.socket method with browser-compatible WebSocket API.
func injectSocket(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectSocket: %v", r)
		}
	}()

	lo.Must0(siyuan.Set("socket", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
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

			type socket struct {
				wsObj         *goja.Object
				wsURL         string
				wsHeader      http.Header
				writeMessage  func(*websocket.Conn, int, []byte) error
				setReadyState func(WebSocketState)
				invokeWsHook  func(string, ...goja.Value)
			}
			type message struct {
				t int
				d []byte
			}

			var conn atomic.Pointer[websocket.Conn]
			var readyState atomic.Int64
			var messagesMu sync.Mutex
			var messages []message
			var wsWriteMu sync.Mutex

			wsURL := fmt.Sprintf("ws://127.0.0.1:%s%s", util.ServerPort, path)
			wsHeader := http.Header{}
			wsHeader.Set(model.XAuthTokenKey, p.token)
			if len(protocols) > 0 {
				wsHeader.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
			}

			wsObj := rt.NewObject()

			writeMessage := func(c *websocket.Conn, messageType int, data []byte) error {
				wsWriteMu.Lock()
				defer wsWriteMu.Unlock()
				return c.WriteMessage(messageType, data)
			}

			setReadyState := func(state WebSocketState) {
				readyState.Store(int64(state))
				wsObj.Set("readyState", rt.ToValue(state))
			}

			invokeWsHook := func(name string, args ...goja.Value) {
				hook := wsObj.Get(name)
				if fn, ok := goja.AssertFunction(hook); ok {
					if _, callErr := fn(wsObj, args...); callErr != nil {
						logging.LogErrorf("[plugin:%s] ws hook %q: %v", p.Name, name, callErr)
					}
				}
			}

			setReadyState(WebSocketReadyStateConnecting)
			lo.Must0(wsObj.Set("onopen", goja.Null()))
			lo.Must0(wsObj.Set("onping", goja.Null()))
			lo.Must0(wsObj.Set("onpong", goja.Null()))
			lo.Must0(wsObj.Set("onerror", goja.Null()))
			lo.Must0(wsObj.Set("onmessage", goja.Null()))
			lo.Must0(wsObj.Set("onclose", goja.Null()))

			lo.Must0(wsObj.Set("send", rt.ToValue(func(sendCall goja.FunctionCall) goja.Value {
				sendPromise, sendResolve, sendReject := rt.NewPromise()

				sendRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
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
					switch state {
					case WebSocketReadyStateOpen:
						c := conn.Load()
						if c != nil {
							err = writeMessage(c, messageType, messageData)
						}
					case WebSocketReadyStateConnecting:
						messagesMu.Lock()
						messages = append(messages, message{
							t: messageType,
							d: messageData,
						})
						messagesMu.Unlock()
					}
					return
				}, func(rt *goja.Runtime, result any, err error) {
					if lo.IsNil(err) {
						if resolveErr := sendResolve(result); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.socket.send resolve: %v", p.Name, resolveErr)
						}
					} else {
						if rejectErr := sendReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.socket.send reject: %v", p.Name, rejectErr)
						}
					}
				})
				if sendRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.socket.send worker run: %v", p.Name, sendRunErr)
				}

				return rt.ToValue(sendPromise)
			})))

			lo.Must0(wsObj.Set("ping", rt.ToValue(func(pingCall goja.FunctionCall) goja.Value {
				pingPromise, pingResolve, pingReject := rt.NewPromise()

				pingRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					var pingData string
					if len(pingCall.Arguments) > 0 && !goja.IsUndefined(pingCall.Argument(0)) {
						pingData = pingCall.Argument(0).String()
					}
					c := conn.Load()
					if c != nil {
						err = writeMessage(c, websocket.PingMessage, []byte(pingData))
					}
					return
				}, func(rt *goja.Runtime, result any, err error) {
					if lo.IsNil(err) {
						if resolveErr := pingResolve(result); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.socket.ping resolve: %v", p.Name, resolveErr)
						}
					} else {
						if rejectErr := pingReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.socket.ping reject: %v", p.Name, rejectErr)
						}
					}
				})
				if pingRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.socket.ping worker run: %v", p.Name, pingRunErr)
				}

				return rt.ToValue(pingPromise)
			})))

			lo.Must0(wsObj.Set("pong", rt.ToValue(func(pongCall goja.FunctionCall) goja.Value {
				pongPromise, pongResolve, pongReject := rt.NewPromise()

				pongRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
					var pongData string
					if len(pongCall.Arguments) > 0 && !goja.IsUndefined(pongCall.Argument(0)) {
						pongData = pongCall.Argument(0).String()
					}
					c := conn.Load()
					if c != nil {
						err = writeMessage(c, websocket.PongMessage, []byte(pongData))
					}
					return
				}, func(rt *goja.Runtime, result any, err error) {
					if lo.IsNil(err) {
						if resolveErr := pongResolve(result); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.socket.pong resolve: %v", p.Name, resolveErr)
						}
					} else {
						if rejectErr := pongReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.socket.pong reject: %v", p.Name, rejectErr)
						}
					}
				})
				if pongRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.socket.pong worker run: %v", p.Name, pongRunErr)
				}

				return rt.ToValue(pongPromise)
			})))

			lo.Must0(wsObj.Set("close", rt.ToValue(func(closeCall goja.FunctionCall) goja.Value {
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
					c := conn.Load()
					if c != nil {
						err = writeMessage(c, websocket.CloseMessage, websocket.FormatCloseMessage(code, reason))
					}
					return
				}, func(rt *goja.Runtime, result any, err error) {
					if lo.IsNil(err) {
						if resolveErr := closeResolve(result); resolveErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.socket.close resolve: %v", p.Name, resolveErr)
						}
					} else {
						if rejectErr := closeReject(rt.NewGoError(err)); rejectErr != nil {
							logging.LogErrorf("[plugin:%s] siyuan.socket.close reject: %v", p.Name, rejectErr)
						}
					}
				})
				if closeRunErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.socket.close worker run: %v", p.Name, closeRunErr)
				}

				return rt.ToValue(closePromise)
			})))

			s := &socket{
				wsObj:         wsObj,
				wsURL:         wsURL,
				wsHeader:      wsHeader,
				writeMessage:  writeMessage,
				setReadyState: setReadyState,
				invokeWsHook:  invokeWsHook,
			}

			go func() {
				defer func() {
					if r := recover(); r != nil {
						logging.LogErrorf("[plugin:%s] panic during siyuan.socket: %v", p.Name, r)
					}
				}()

				dialer := websocket.Dialer{}
				c, _, dialErr := dialer.Dial(s.wsURL, s.wsHeader)
				if dialErr != nil {
					p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
						event := rt.NewObject()
						event.Set("type", rt.ToValue("error"))
						event.Set("error", rt.NewGoError(dialErr))
						s.invokeWsHook("onerror", event)
						return
					})
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
						s.invokeWsHook("onping", event)
						return
					})
					return runError
				})
				c.SetPongHandler(func(data string) error {
					_, runError := p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
						event := rt.NewObject()
						event.Set("type", rt.ToValue("pong"))
						event.Set("data", rt.ToValue(data))
						s.invokeWsHook("onpong", event)
						return
					})
					return runError
				})
				c.SetCloseHandler(func(code int, reason string) error {
					_, runError := p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
						s.setReadyState(WebSocketReadyStateClosing)
						event := rt.NewObject()
						event.Set("type", rt.ToValue("close"))
						event.Set("code", rt.ToValue(int64(code)))
						event.Set("reason", rt.ToValue(reason))
						s.invokeWsHook("onclose", event)
						return
					})
					return runError
				})

				p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
					// Store the connection for later use in send/ping/pong/close
					conn.Store(c)

					// Transition to open state
					s.setReadyState(WebSocketReadyStateOpen)

					// Flush messages sent before the connection is established
					messagesMu.Lock()
					for _, m := range messages {
						s.writeMessage(c, m.t, m.d)
					}
					messages = nil
					messagesMu.Unlock()

					// Emit the open event
					event := rt.NewObject()
					event.Set("type", rt.ToValue("open"))
					s.invokeWsHook("onopen", event)
					return
				})

				for {
					messageType, data, readErr := c.ReadMessage()
					if readErr != nil {
						if websocket.IsUnexpectedCloseError(readErr, websocket.CloseNormalClosure) {
							_, _ = p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
								event := rt.NewObject()
								event.Set("type", rt.ToValue("error"))
								event.Set("error", rt.NewGoError(readErr))
								s.invokeWsHook("onerror", event)
								return
							})
						}
						break
					}
					switch messageType {
					case websocket.TextMessage:
						_, _ = p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
							event := rt.NewObject()
							event.Set("type", rt.ToValue("message"))
							event.Set("data", rt.ToValue(string(data)))
							s.invokeWsHook("onmessage", event)
							return
						})
					case websocket.BinaryMessage:
						_, _ = p.worker.RunSync(func(rt *goja.Runtime) (result any, err error) {
							event := rt.NewObject()
							event.Set("type", rt.ToValue("message"))
							event.Set("data", rt.ToValue(rt.NewArrayBuffer(data)))
							s.invokeWsHook("onmessage", event)
							return
						})
					}
				}
			}()

			result = wsObj
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.socket resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.socket reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.socket worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))
	return
}

// injectRpc adds siyuan.rpc method for RPC method registration.
func injectRpc(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectRpc: %v", r)
		}
	}()

	rpc := rt.NewObject()

	lo.Must0(rpc.Set("bind", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			var name string
			var method goja.Callable
			var descriptions []string

			if len(call.Arguments) < 2 {
				err = fmt.Errorf("method name and function required")
				return
			}
			nameArg := call.Argument(0)
			methodArg := call.Argument(1)
			descArgs := call.Arguments[2:]

			if goja.IsString(nameArg) {
				name = nameArg.String()
			} else {
				err = fmt.Errorf("first argument must be method name string")
				return
			}

			if methodJs, ok := goja.AssertFunction(methodArg); ok {
				method = methodJs
			} else {
				err = fmt.Errorf("second argument must be a function")
			}

			descriptions = make([]string, len(descArgs))
			for i, a := range descArgs {
				descriptions[i] = a.String()
			}

			err = p.bindRpcMethod(name, method, descriptions...)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.subscribe resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.subscribe reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.rpc.subscribe worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(rpc.Set("unbind", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			var name string
			if len(call.Arguments) < 1 {
				err = fmt.Errorf("method name required")
				return
			}

			nameArg := call.Argument(0)
			if goja.IsString(nameArg) {
				name = nameArg.String()
			} else {
				err = fmt.Errorf("first argument must be method name string")
				return
			}

			err = p.unbindRpcMethod(name)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.unsubscribe resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.unsubscribe reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.rpc.unsubscribe worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(rpc.Set("broadcast", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if len(call.Arguments) < 1 {
				err = fmt.Errorf("method required")
				return
			}

			var method string
			if m := call.Argument(0); goja.IsString(m) {
				method = m.String()
			}

			var params any
			if len(call.Arguments) > 1 {
				params = call.Argument(1).Export()
			}

			p.BroadcastNotification(method, params)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.broadcast resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.broadcast reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.rpc.broadcast worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, rpc))

	lo.Must0(siyuan.Set("rpc", rpc))
	return
}

// ObjectFreeze calls Object.freeze() on the given goja object.
func ObjectFreeze(rt *goja.Runtime, obj *goja.Object) error {
	Object := rt.GlobalObject().Get("Object").ToObject(rt)
	if Object == nil {
		return fmt.Errorf("globalThis.Object is not an object")
	}

	freeze, ok := goja.AssertFunction(Object.Get("freeze"))
	if !ok {
		return fmt.Errorf("globalThis.Object.freeze is not a function")
	}

	_, err := freeze(Object, obj)
	return err
}

// ObjectSeal calls Object.seal() on the given goja object.
func ObjectSeal(rt *goja.Runtime, obj *goja.Object) error {
	Object := rt.GlobalObject().Get("Object").ToObject(rt)
	if Object == nil {
		return fmt.Errorf("globalThis.Object is not an object")
	}

	seal, ok := goja.AssertFunction(Object.Get("seal"))
	if !ok {
		return fmt.Errorf("globalThis.Object.seal is not a function")
	}

	_, err := seal(Object, obj)
	return err
}

// ObjectSetDataMethods attaches text(), json(), and arrayBuffer() methods to a JS object,
// each returning a Promise that resolves with the corresponding representation of data.
func ObjectSetDataMethods(p *KernelPlugin, rt *goja.Runtime, object *goja.Object, data []byte) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("ObjectSetDataMethods: %v", r)
		}
	}()

	lo.Must0(object.Set("text", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			result = string(data)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] data.text() resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] data.text() reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] text worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))
	lo.Must0(object.Set("json", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			result, err = goValueToJsValueSafely(rt, json.RawMessage(data))
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] data.json() resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] data.json() reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] json worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))
	lo.Must0(object.Set("arrayBuffer", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			result = rt.NewArrayBuffer(data)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(rt.ToValue(result)); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] data.arrayBuffer() resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] data.arrayBuffer() reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] arrayBuffer worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))
	return
}

// loggerWrapper returns a JS-callable function that logs a message at the given level.
// Logging is synchronous (in-process, no I/O), so resolve is called inline without worker.Run.
func loggerWrapper(p *KernelPlugin, logf func(format string, args ...any)) func(goja.FunctionCall, *goja.Runtime) goja.Value {
	return func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			parts := make([]string, 0, len(call.Arguments))
			for _, arg := range call.Arguments {
				if goja.IsString(arg) {
					parts = append(parts, arg.String())
					continue
				}

				if arg == nil {
					parts = append(parts, "null")
					continue
				}

				if goja.IsUndefined(arg) || goja.IsNull(arg) {
					parts = append(parts, arg.String())
					continue
				}

				argObj := arg.ToObject(rt)
				if argObj != nil {
					if argJson, marshalErr := argObj.MarshalJSON(); marshalErr == nil {
						parts = append(parts, string(argJson))
						continue
					}
				}

				parts = append(parts, arg.String())
			}
			msg := strings.Join(parts, " ")
			rows := strings.Split(msg, "\n")
			for _, row := range rows {
				logf("[plugin:%s] %s", p.Name, row)
			}
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.logger resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.logger reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.logger worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	}
}

// goValueToJsValueSafely converts a Go value to a goja.Value via a JSON round-trip.
// Use this instead of rt.ToValue when the value may contain int64 fields (e.g. SiYuan block IDs, Unix timestamps) or json.RawMessage: rt.ToValue maps int64 to IEEE 754 double, which silently loses precision for values > 2^53.
// The JSON round-trip preserves integer values exactly by routing them through json.Number → Int64() before handing them to goja.
func goValueToJsValueSafely(rt *goja.Runtime, value any) (goja.Value, error) {
	b, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var parsed any
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.UseNumber()
	if err = dec.Decode(&parsed); err != nil {
		return nil, err
	}
	return rt.ToValue(convertJsonNumbers(parsed)), nil
}

// convertJsonNumbers recursively converts json.Number values in the given data structure to int64 or float64 where possible, preserving precision for large integers.
func convertJsonNumbers(v any) any {
	switch val := v.(type) {
	case json.Number:
		if i, err := val.Int64(); err == nil {
			return i
		}
		if f, err := val.Float64(); err == nil {
			return f
		}
		return val.String()
	case R:
		for k, mv := range val {
			val[k] = convertJsonNumbers(mv)
		}
		return val
	case []any:
		for i, mv := range val {
			val[i] = convertJsonNumbers(mv)
		}
		return val
	}
	return v
}

// getJsContextValue safely retrieves a nested value from the plugin's JS context, returning nil if any step fails.
func getJsContextValue(rt *goja.Runtime, paths []any) (value goja.Value, err error) {
	var cursor goja.Value = rt.GlobalObject()
	var path string = "globalThis"

	for _, key := range paths {
		if cursor == nil {
			err = fmt.Errorf("path %v: value is nil", key)
			return
		}

		if goja.IsUndefined(cursor) || goja.IsNull(cursor) {
			err = fmt.Errorf("path %v: value is %s", key, cursor.String())
			return
		}

		obj := cursor.ToObject(rt)
		if obj == nil {
			err = fmt.Errorf("path %v: expected object, got %T", key, cursor)
			return
		}

		switch k := key.(type) {
		case string:
			cursor = obj.Get(k)
			path = fmt.Sprintf("%s.%s", path, k)
		case int:
			cursor = obj.Get(strconv.Itoa(k))
			path = fmt.Sprintf("%s[%d]", path, k)
		default:
			err = fmt.Errorf("unsupported path type: %T", key)
			return
		}
	}
	value = cursor
	return
}

// dispatchEvent calls the globalThis.siyuan.event.on hook with the given event object.
// If it returns `true`, the caller should await the result by receiving an event with the specified topic.
func dispatchEvent(p *KernelPlugin, rt *goja.Runtime, e any) (await bool, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("goja panic during dispatchEvent: %v", r)
		}
	}()

	event, err := getJsContextValue(rt, []any{"siyuan", "event"})
	if err != nil {
		return
	}
	if event == nil {
		err = fmt.Errorf("globalThis.siyuan.event not found")
		return
	}
	if goja.IsUndefined(event) || goja.IsNull(event) {
		err = fmt.Errorf("globalThis.siyuan.event is %s", event.String())
		return
	}

	eventObj := event.ToObject(rt)
	if eventObj == nil {
		err = fmt.Errorf("globalThis.siyuan.event is not an object")
		return
	}

	handlerValue := eventObj.Get("handler")
	handler, ok := goja.AssertFunction(handlerValue)
	if !ok {
		return
	}

	eventJs := rt.ToValue(e)
	invokeResult, invokeErr := handler(event, eventJs)
	if invokeErr != nil {
		err = invokeErr
		return
	}

	// Strict true-only: do NOT use ToBoolean() — any truthy object (e.g. a Promise) would deadlock invokeHook.
	await = invokeResult.ToBoolean() == true
	return
}

// invokeFunction calls a goja.Callable with the given this and arguments, handling both synchronous return values and Promises.
func invokeFunction(callback func(result TaskResult), rt *goja.Runtime, async bool, fn goja.Callable, this goja.Value, args ...goja.Value) {
	resultJs, err := fn(this, args...)
	if callback == nil {
		return
	}

	result := resultJs.Export()
	if isGoPromise(result) {
		if !async {
			panic(fmt.Errorf("synchronous function returned a Promise"))
		}

		resultObj := resultJs.ToObject(rt)
		if resultObj == nil {
			callback(TaskResult{nil, fmt.Errorf("expected promise object, got %T", result)})
		}

		thenValue := resultObj.Get("then")
		if thenValue == nil {
			callback(TaskResult{nil, fmt.Errorf("promise object has no 'then' property")})
		}

		then, ok := goja.AssertFunction(thenValue)
		if !ok {
			callback(TaskResult{nil, fmt.Errorf("'promise.then property is not a function")})
		}

		then(resultObj, rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) {
			callback(TaskResult{call.Argument(0).Export(), nil})
		}), rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) {
			callback(TaskResult{nil, fmt.Errorf("promise rejected: %v", call.Argument(0).Export())})
		}))
	} else {
		logging.LogDebugf("invokeFunction result: %T %v, err: %v", result, result, err)
		callback(TaskResult{result, err})
	}
}

// isJsPromise checks if a goja.Value is a JavaScript Promise.
func isJsPromise(jsValue goja.Value) bool {
	if jsValue == nil {
		return false
	}

	goValue := jsValue.Export()
	return isGoPromise(goValue)
}

// isGoPromise checks if a Go value is a *goja.Promise.
func isGoPromise(goValue any) bool {
	if goValue == nil {
		return false
	}

	_, ok := goValue.(*goja.Promise)
	return ok
}

// isJsArray checks if a goja.Value is a JavaScript Array.
func isJsArray(rt *goja.Runtime, jsValue goja.Value) bool {
	if jsValue == nil {
		return false
	}

	if goja.IsUndefined(jsValue) || goja.IsNull(jsValue) {
		return false
	}

	jsObject := jsValue.ToObject(rt)
	return isJsObjectArray(jsObject)
}

// isJsObjectArray checks if a goja.Object is a JavaScript Array by inspecting its class name.
func isJsObjectArray(jsObject *goja.Object) bool {
	if jsObject == nil {
		return false
	}

	switch jsObject.ClassName() {
	case "Array":
		return true
	default:
		return false
	}
}
