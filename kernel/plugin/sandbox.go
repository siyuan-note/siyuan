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

// injectGlobalContext injects all siyuan.* APIs into the plugin's goja global context.
func injectGlobalContext(p *KernelPlugin, rt *goja.Runtime) (err error) {
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
	lo.Must0(injectFetch(p, rt, siyuan))
	lo.Must0(injectSocket(p, rt, siyuan))
	lo.Must0(injectRpc(p, rt, siyuan))

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

	plugin := rt.NewObject()

	lo.Must0(plugin.Set("name", p.Name))
	lo.Must0(plugin.Set("displayName", p.DisplayName))
	lo.Must0(plugin.Set("platform", bazaar.GetCurrentBackend()))
	lo.Must0(plugin.Set("i18n", p.I18n))

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

	lo.Must0(logger.Set("trace", rt.ToValue(loggerWrapper(p, rt, logging.LogTracef))))
	lo.Must0(logger.Set("debug", rt.ToValue(loggerWrapper(p, rt, logging.LogDebugf))))
	lo.Must0(logger.Set("info", rt.ToValue(loggerWrapper(p, rt, logging.LogInfof))))
	lo.Must0(logger.Set("warn", rt.ToValue(loggerWrapper(p, rt, logging.LogWarnf))))
	lo.Must0(logger.Set("error", rt.ToValue(loggerWrapper(p, rt, logging.LogErrorf))))

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

	lo.Must0(event.Set("on", goja.Null()))

	lo.Must0(event.Set("emit", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		runErr := p.worker.Run(func() (result any, err error) {
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

			p.bus.Publish(topic, string(eventJson))
			return
		}, func(result any, err error) {
			if lo.IsNil(err) {
				resolve(goja.Undefined())
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] event.emit reject: %v", p.Name, rejectErr)
				}
			}
		}, p.context)
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] event.emit worker run: %v", p.Name, runErr)
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

	resolvePath := func(relPath string) (string, error) {
		abs := filepath.Join(baseDir, filepath.Clean(relPath))
		if !(abs == baseDir || strings.HasPrefix(abs, baseDir+string(filepath.Separator))) {
			return "", fmt.Errorf("siyuan.storage: path traversal not allowed")
		}
		return abs, nil
	}

	storage := rt.NewObject()

	// siyuan.storage.get(path) -> Promise<{text, json, arrayBuffer}>
	lo.Must0(storage.Set("get", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		if len(call.Arguments) < 1 {
			if err := reject(rt.NewGoError(fmt.Errorf("path required"))); err != nil {
				logging.LogErrorf("[plugin:%s] storage.get reject: %v", p.Name, err)
			}
			return rt.ToValue(promise)
		}
		path := call.Argument(0).String()
		go func() {
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				_ = p.worker.Run(func() (result any, err error) {
					if err := reject(rt.NewGoError(resolveErr)); err != nil {
						logging.LogErrorf("[plugin:%s] storage.get reject: %v", p.Name, err)
					}
					return
				}, nil, p.context)
				return
			}
			data, readErr := filelock.ReadFile(abs)
			_ = p.worker.Run(func() (result any, err error) {
				if readErr != nil {
					if err := reject(rt.NewGoError(fmt.Errorf("failed to read file: %w", readErr))); err != nil {
						logging.LogErrorf("[plugin:%s] storage.get reject: %v", p.Name, err)
					}
					return
				}
				content := rt.NewObject()
				ObjectSetDataMethods(p, rt, content, data)
				if err := resolve(content); err != nil {
					logging.LogErrorf("[plugin:%s] storage.get resolve: %v", p.Name, err)
				}
				return
			}, nil, p.context)
		}()
		return rt.ToValue(promise)
	})))

	// siyuan.storage.put(path, content) -> Promise<void>
	lo.Must0(storage.Set("put", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		if len(call.Arguments) < 2 {
			if err := reject(rt.NewGoError(fmt.Errorf("path and content required"))); err != nil {
				logging.LogErrorf("[plugin:%s] storage.put reject: %v", p.Name, err)
			}
			return rt.ToValue(promise)
		}
		path := call.Argument(0).String()
		content := call.Argument(1).String()
		go func() {
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				_ = p.worker.Run(func() (result any, err error) {
					if err := reject(rt.NewGoError(resolveErr)); err != nil {
						logging.LogErrorf("[plugin:%s] storage.put reject: %v", p.Name, err)
					}
					return
				}, nil, p.context)
				return
			}
			dir := filepath.Dir(abs)
			mkdirErr := os.MkdirAll(dir, 0755)
			if mkdirErr != nil {
				_ = p.worker.Run(func() (result any, err error) {
					if err := reject(rt.NewGoError(fmt.Errorf("failed to make directory: %w", mkdirErr))); err != nil {
						logging.LogErrorf("[plugin:%s] storage.put reject: %v", p.Name, err)
					}
					return
				}, nil, p.context)
				return
			}
			writeErr := filelock.WriteFile(abs, []byte(content))
			_ = p.worker.Run(func() (result any, err error) {
				if writeErr != nil {
					if err := reject(rt.NewGoError(fmt.Errorf("failed to write file: %w", writeErr))); err != nil {
						logging.LogErrorf("[plugin:%s] storage.put reject: %v", p.Name, err)
					}
					return
				}
				if err := resolve(goja.Undefined()); err != nil {
					logging.LogErrorf("[plugin:%s] storage.put resolve: %v", p.Name, err)
				}
				return
			}, nil, p.context)
		}()
		return rt.ToValue(promise)
	})))

	// siyuan.storage.remove(path) -> Promise<void>
	lo.Must0(storage.Set("remove", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		if len(call.Arguments) < 1 {
			if err := reject(rt.NewGoError(fmt.Errorf("path required"))); err != nil {
				logging.LogErrorf("[plugin:%s] storage.remove reject: %v", p.Name, err)
			}
			return rt.ToValue(promise)
		}
		path := call.Argument(0).String()
		go func() {
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				_ = p.worker.Run(func() (result any, err error) {
					if err := reject(rt.NewGoError(resolveErr)); err != nil {
						logging.LogErrorf("[plugin:%s] storage.remove reject: %v", p.Name, err)
					}
					return
				}, nil, p.context)
				return
			}
			if abs == baseDir {
				_ = p.worker.Run(func() (result any, err error) {
					if err := reject(rt.NewGoError(fmt.Errorf("cannot remove storage root"))); err != nil {
						logging.LogErrorf("[plugin:%s] storage.remove reject: %v", p.Name, err)
					}
					return
				}, nil, p.context)
				return
			}
			removeErr := os.RemoveAll(abs)
			_ = p.worker.Run(func() (result any, err error) {
				if removeErr != nil {
					if err := reject(rt.NewGoError(fmt.Errorf("failed to remove: %w", removeErr))); err != nil {
						logging.LogErrorf("[plugin:%s] storage.remove reject: %v", p.Name, err)
					}
					return
				}
				if err := resolve(goja.Undefined()); err != nil {
					logging.LogErrorf("[plugin:%s] storage.remove resolve: %v", p.Name, err)
				}
				return
			}, nil, p.context)
		}()
		return rt.ToValue(promise)
	})))

	// siyuan.storage.list(path) -> Promise<Entry[]>
	lo.Must0(storage.Set("list", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		if len(call.Arguments) < 1 {
			if err := reject(rt.NewGoError(fmt.Errorf("path required"))); err != nil {
				logging.LogErrorf("[plugin:%s] storage.list reject: %v", p.Name, err)
			}
			return rt.ToValue(promise)
		}
		path := call.Argument(0).String()
		go func() {
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				_ = p.worker.Run(func() (result any, err error) {
					if err := reject(rt.NewGoError(resolveErr)); err != nil {
						logging.LogErrorf("[plugin:%s] storage.list reject: %v", p.Name, err)
					}
					return
				}, nil, p.context)
				return
			}
			entries, readErr := os.ReadDir(abs)
			if readErr != nil {
				_ = p.worker.Run(func() (result any, err error) {
					if err := reject(rt.NewGoError(fmt.Errorf("failed to read directory: %w", readErr))); err != nil {
						logging.LogErrorf("[plugin:%s] storage.list reject: %v", p.Name, err)
					}
					return
				}, nil, p.context)
				return
			}
			results := make([]map[string]any, 0, len(entries))
			for _, entry := range entries {
				info, infoErr := entry.Info()
				if infoErr != nil {
					continue
				}
				results = append(results, map[string]any{
					"name":      entry.Name(),
					"isDir":     info.IsDir(),
					"isSymlink": util.IsSymlink(entry),
					"updated":   info.ModTime().Unix(),
				})
			}
			_ = p.worker.Run(func() (result any, err error) {
				v, convertErr := goValueToJsValueSafely(rt, results)
				if convertErr != nil {
					if err := reject(rt.NewGoError(convertErr)); err != nil {
						logging.LogErrorf("[plugin:%s] storage.list reject: %v", p.Name, err)
					}
					return
				}
				if err := resolve(v); err != nil {
					logging.LogErrorf("[plugin:%s] storage.list resolve: %v", p.Name, err)
				}
				return
			}, nil, p.context)
		}()
		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, storage))

	lo.Must0(siyuan.Set("storage", storage))
	return
}

// injectFetch adds siyuan.fetch method that tunnels HTTP requests to the kernel's REST API.
func injectFetch(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) error {
	siyuan.Set("fetch", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		if len(call.Arguments) < 1 {
			if err := reject(rt.NewGoError(fmt.Errorf("path required"))); err != nil {
				logging.LogErrorf("[plugin:%s] fetch reject: %v", p.Name, err)
			}
			return rt.ToValue(promise)
		}
		path := call.Argument(0).String()
		// Parse init options inline (on Worker goroutine, before going async)
		method := "GET"
		headers := map[string]string{}
		var stringBody string
		var bytesBody []byte
		if len(call.Arguments) > 1 {
			init := call.Argument(1)
			if !goja.IsNull(init) && !goja.IsUndefined(init) {
				if initObj, ok := init.(*goja.Object); ok {
					if m := initObj.Get("method"); m != nil && !goja.IsUndefined(m) {
						method = m.String()
					}
					if b := initObj.Get("body"); b != nil && !goja.IsUndefined(b) {
						if !goja.IsNull(b) {
							if abExport, ok := b.Export().(goja.ArrayBuffer); ok {
								bytesBody = abExport.Bytes()
							} else {
								stringBody = b.String()
							}
						}
					}
					if h := initObj.Get("headers"); h != nil && !goja.IsUndefined(h) && !goja.IsNull(h) {
						if _, ok := h.(*goja.Object); ok {
							exported := h.Export()
							if hMap, ok := exported.(map[string]interface{}); ok {
								for k, v := range hMap {
									headers[k] = fmt.Sprintf("%v", v)
								}
							}
						}
					}
				}
			}
		}
		go func() {
			targetURL := fmt.Sprintf("http://127.0.0.1:%s%s", util.ServerPort, path)
			if !strings.HasPrefix(path, "/") {
				_ = p.worker.Run(func() (result any, err error) {
					if err := reject(rt.NewGoError(fmt.Errorf("path must start with /"))); err != nil {
						logging.LogErrorf("[plugin:%s] fetch reject: %v", p.Name, err)
					}
					return
				}, nil, p.context)
				return
			}
			r := client.R()
			for k, v := range headers {
				r.SetHeader(k, v)
			}
			r.SetHeader(model.XAuthTokenKey, p.token)
			if stringBody != "" {
				r.SetBody(stringBody)
			} else if len(bytesBody) > 0 {
				r.SetBody(bytesBody)
			}
			resp, sendErr := r.Send(method, targetURL)
			if sendErr != nil {
				_ = p.worker.Run(func() (result any, err error) {
					if err := reject(rt.NewGoError(fmt.Errorf("failed to send request: %w", sendErr))); err != nil {
						logging.LogErrorf("[plugin:%s] fetch reject: %v", p.Name, err)
					}
					return
				}, nil, p.context)
				return
			}
			defer resp.Body.Close()
			respBody, readErr := io.ReadAll(resp.Body)
			if readErr != nil {
				_ = p.worker.Run(func() (result any, err error) {
					if err := reject(rt.NewGoError(fmt.Errorf("failed to read response body: %w", readErr))); err != nil {
						logging.LogErrorf("[plugin:%s] fetch reject: %v", p.Name, err)
					}
					return
				}, nil, p.context)
				return
			}
			respHeaders := map[string]string{}
			for k, vs := range resp.Header {
				respHeaders[k] = strings.Join(vs, ", ")
			}
			_ = p.worker.Run(func() (result any, err error) {
				respHeadersJs := rt.ToValue(respHeaders)
				response := rt.NewObject()
				response.Set("url", rt.ToValue(path))
				response.Set("ok", rt.ToValue(resp.StatusCode >= 200 && resp.StatusCode < 300))
				response.Set("status", rt.ToValue(resp.StatusCode))
				response.Set("statusText", rt.ToValue(resp.Status))
				response.Set("headers", respHeadersJs)
				ObjectSetDataMethods(p, rt, response, respBody)
				if err := resolve(response); err != nil {
					logging.LogErrorf("[plugin:%s] fetch resolve: %v", p.Name, err)
				}
				return
			}, nil, p.context)
		}()
		return rt.ToValue(promise)
	}))
	return nil
}

// injectSocket adds siyuan.socket method with browser-compatible WebSocket API.
func injectSocket(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) error {
	siyuan.Set("socket", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		if len(call.Arguments) < 1 {
			if err := reject(rt.NewGoError(fmt.Errorf("path required"))); err != nil {
				logging.LogErrorf("[plugin:%s] socket reject: %v", p.Name, err)
			}
			return rt.ToValue(promise)
		}

		path := call.Argument(0).String()
		if !strings.HasPrefix(path, "/") {
			if err := reject(rt.NewGoError(fmt.Errorf("path must start with /"))); err != nil {
				logging.LogErrorf("[plugin:%s] socket reject: %v", p.Name, err)
			}
			return rt.ToValue(promise)
		}

		// Collect protocol(s) from JS (on Worker goroutine, safe)
		var protocols []string
		if len(call.Arguments) > 1 {
			proto := call.Argument(1)
			if !goja.IsNull(proto) && !goja.IsUndefined(proto) {
				if protoObj, ok := proto.(*goja.Object); ok && protoObj.ClassName() == "Array" {
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

		wsURL := fmt.Sprintf("ws://127.0.0.1:%s%s", util.ServerPort, path)

		wsHeader := http.Header{}
		wsHeader.Set(model.XAuthTokenKey, p.token)
		if len(protocols) > 0 {
			wsHeader.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
		}

		var conn atomic.Pointer[websocket.Conn]
		var readyState atomic.Int64
		var sendQueueMu sync.RWMutex
		var sendQueue []any
		var wsWriteMu sync.Mutex

		// Create wsObj on the Worker goroutine
		wsObj := rt.NewObject()

		writeMessage := func(c *websocket.Conn, messageType int, data []byte) error {
			wsWriteMu.Lock()
			defer wsWriteMu.Unlock()
			return c.WriteMessage(messageType, data)
		}

		setReadyState := func(state WebSocketState) {
			stateInt64 := int64(state)
			readyState.Store(stateInt64)
			wsObj.Set("readyState", rt.ToValue(stateInt64))
		}

		invokeWsHook := func(name string, args ...goja.Value) {
			hook := wsObj.Get(name)
			if hook != nil && !goja.IsNull(hook) && !goja.IsUndefined(hook) {
				if fn, ok := goja.AssertFunction(hook); ok {
					if _, err := fn(wsObj, args...); err != nil {
						logging.LogErrorf("[plugin:%s] ws hook %q: %v", p.Name, name, err)
					}
				}
			}
		}

		setReadyState(WebSocketReadyStateConnecting)
		wsObj.Set("onopen", goja.Null())
		wsObj.Set("onping", goja.Null())
		wsObj.Set("onpong", goja.Null())
		wsObj.Set("onerror", goja.Null())
		wsObj.Set("onmessage", goja.Null())
		wsObj.Set("onclose", goja.Null())

		wsObj.Set("send", rt.ToValue(func(sendCall goja.FunctionCall) goja.Value {
			sendPromise, sendResolve, sendReject := rt.NewPromise()
			if len(sendCall.Arguments) < 1 {
				if err := sendResolve(goja.Undefined()); err != nil {
					logging.LogErrorf("[plugin:%s] socket.send resolve: %v", p.Name, err)
				}
				return rt.ToValue(sendPromise)
			}
			// Extract Go primitives from goja.Value on the JS goroutine (FunctionCall body)
			// before entering worker.Run, since goja values must not cross goroutines.
			var sendBytes []byte
			var sendStr string
			var isBinary bool
			if abExport, ok := sendCall.Argument(0).Export().(goja.ArrayBuffer); ok {
				raw := abExport.Bytes()
				sendBytes = make([]byte, len(raw))
				copy(sendBytes, raw)
				isBinary = true
			} else {
				sendStr = sendCall.Argument(0).String()
			}
			_ = p.worker.Run(func() (result any, err error) {
				state := WebSocketState(readyState.Load())
				if state == WebSocketReadyStateOpen {
					c := conn.Load()
					if c != nil {
						var sendErr error
						if isBinary {
							sendErr = writeMessage(c, websocket.BinaryMessage, sendBytes)
						} else {
							sendErr = writeMessage(c, websocket.TextMessage, []byte(sendStr))
						}
						if sendErr != nil {
							if err := sendReject(rt.NewGoError(sendErr)); err != nil {
								logging.LogErrorf("[plugin:%s] socket.send reject: %v", p.Name, err)
							}
							return
						}
					}
				} else if state == WebSocketReadyStateConnecting {
					sendQueueMu.Lock()
					if isBinary {
						sendQueue = append(sendQueue, sendBytes)
					} else {
						sendQueue = append(sendQueue, sendStr)
					}
					sendQueueMu.Unlock()
				}
				if err := sendResolve(goja.Undefined()); err != nil {
					logging.LogErrorf("[plugin:%s] socket.send resolve: %v", p.Name, err)
				}
				return
			}, nil, p.context)
			return rt.ToValue(sendPromise)
		}))

		wsObj.Set("ping", rt.ToValue(func(pingCall goja.FunctionCall) goja.Value {
			pingPromise, pingResolve, _ := rt.NewPromise()
			var pingData string
			if len(pingCall.Arguments) > 0 && !goja.IsUndefined(pingCall.Argument(0)) {
				pingData = pingCall.Argument(0).String()
			}
			_ = p.worker.Run(func() (result any, err error) {
				c := conn.Load()
				if c != nil {
					writeMessage(c, websocket.PingMessage, []byte(pingData))
				}
				if err := pingResolve(goja.Undefined()); err != nil {
					logging.LogErrorf("[plugin:%s] socket.ping resolve: %v", p.Name, err)
				}
				return
			}, nil, p.context)
			return rt.ToValue(pingPromise)
		}))

		wsObj.Set("pong", rt.ToValue(func(pongCall goja.FunctionCall) goja.Value {
			pongPromise, pongResolve, _ := rt.NewPromise()
			var pongData string
			if len(pongCall.Arguments) > 0 && !goja.IsUndefined(pongCall.Argument(0)) {
				pongData = pongCall.Argument(0).String()
			}
			_ = p.worker.Run(func() (result any, err error) {
				c := conn.Load()
				if c != nil {
					writeMessage(c, websocket.PongMessage, []byte(pongData))
				}
				if err := pongResolve(goja.Undefined()); err != nil {
					logging.LogErrorf("[plugin:%s] socket.pong resolve: %v", p.Name, err)
				}
				return
			}, nil, p.context)
			return rt.ToValue(pongPromise)
		}))

		wsObj.Set("close", rt.ToValue(func(closeCall goja.FunctionCall) goja.Value {
			closePromise, closeResolve, _ := rt.NewPromise()
			code := websocket.CloseNormalClosure
			var reason string
			if len(closeCall.Arguments) > 0 && !goja.IsUndefined(closeCall.Argument(0)) {
				code = int(closeCall.Argument(0).ToInteger())
			}
			if len(closeCall.Arguments) > 1 && !goja.IsUndefined(closeCall.Argument(1)) {
				reason = closeCall.Argument(1).String()
			}
			_ = p.worker.Run(func() (result any, err error) {
				c := conn.Load()
				if c != nil {
					writeMessage(c, websocket.CloseMessage, websocket.FormatCloseMessage(code, reason))
				}
				if err := closeResolve(goja.Undefined()); err != nil {
					logging.LogErrorf("[plugin:%s] socket.close resolve: %v", p.Name, err)
				}
				return
			}, nil, p.context)
			return rt.ToValue(closePromise)
		}))

		go func() {
			defer func() {
				if r := recover(); r != nil {
					logging.LogErrorf("[plugin:%s] panic during siyuan.socket: %v", p.Name, r)
				}
			}()

			dialer := websocket.Dialer{}
			c, _, dialErr := dialer.Dial(wsURL, wsHeader)
			if dialErr != nil {
				_, _ = p.worker.RunSync(func() (result any, err error) {
					event := rt.NewObject()
					event.Set("type", rt.ToValue("error"))
					event.Set("error", rt.NewGoError(dialErr))
					invokeWsHook("onerror", event)
					return
				}, p.context)
				return
			}

			defer func() {
				p.UntrackSocket(c)
				c.Close()
			}()
			p.TrackSocket(c, false)

			c.SetPingHandler(func(data string) error {
				_, runError := p.worker.RunSync(func() (result any, err error) {
					event := rt.NewObject()
					event.Set("type", rt.ToValue("ping"))
					event.Set("data", rt.ToValue(data))
					invokeWsHook("onping", event)
					return
				}, p.context)
				if runError != nil {
					return runError
				}
				return nil
			})
			c.SetPongHandler(func(data string) error {
				_, runError := p.worker.RunSync(func() (result any, err error) {
					event := rt.NewObject()
					event.Set("type", rt.ToValue("pong"))
					event.Set("data", rt.ToValue(data))
					invokeWsHook("onpong", event)
					return
				}, p.context)
				if runError != nil {
					return runError
				}
				return nil
			})
			c.SetCloseHandler(func(code int, reason string) error {
				_, runError := p.worker.RunSync(func() (result any, err error) {
					setReadyState(WebSocketReadyStateClosing)
					event := rt.NewObject()
					event.Set("type", rt.ToValue("close"))
					event.Set("code", rt.ToValue(int64(code)))
					event.Set("reason", rt.ToValue(reason))
					invokeWsHook("onclose", event)
					return
				}, p.context)
				if runError != nil {
					return runError
				}
				return nil
			})

			sendQueueMu.Lock()
			conn.Store(c)
			for _, data := range sendQueue {
				switch v := data.(type) {
				case string:
					writeMessage(c, websocket.TextMessage, []byte(v))
				case []byte:
					writeMessage(c, websocket.BinaryMessage, v)
				}
			}
			sendQueue = nil
			sendQueueMu.Unlock()

			_, _ = p.worker.RunSync(func() (result any, err error) {
				setReadyState(WebSocketReadyStateOpen)
				event := rt.NewObject()
				event.Set("type", rt.ToValue("open"))
				invokeWsHook("onopen", event)
				return
			}, p.context)

			for {
				messageType, data, readErr := c.ReadMessage()
				if readErr != nil {
					if websocket.IsUnexpectedCloseError(readErr, websocket.CloseNormalClosure) {
						_, _ = p.worker.RunSync(func() (result any, err error) {
							event := rt.NewObject()
							event.Set("type", rt.ToValue("error"))
							event.Set("error", rt.NewGoError(readErr))
							invokeWsHook("onerror", event)
							return
						}, p.context)
					}
					break
				}
				switch messageType {
				case websocket.TextMessage:
					_, _ = p.worker.RunSync(func() (result any, err error) {
						event := rt.NewObject()
						event.Set("type", rt.ToValue("message"))
						event.Set("data", rt.ToValue(string(data)))
						invokeWsHook("onmessage", event)
						return
					}, p.context)
				case websocket.BinaryMessage:
					_, _ = p.worker.RunSync(func() (result any, err error) {
						event := rt.NewObject()
						event.Set("type", rt.ToValue("message"))
						event.Set("data", rt.ToValue(rt.NewArrayBuffer(data)))
						invokeWsHook("onmessage", event)
						return
					}, p.context)
				}
			}
		}()

		if err := resolve(wsObj); err != nil {
			logging.LogErrorf("[plugin:%s] socket resolve: %v", p.Name, err)
		}
		return rt.ToValue(promise)
	}))
	return nil
}

// injectRpc adds siyuan.rpc method for RPC method registration.
func injectRpc(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) error {
	rpc := rt.NewObject()

	rpc.Set("subscribe", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		if len(call.Arguments) < 1 {
			if err := reject(rt.NewGoError(fmt.Errorf("name required"))); err != nil {
				logging.LogErrorf("[plugin:%s] rpc.subscribe reject: %v", p.Name, err)
			}
			return rt.ToValue(promise)
		}
		name := call.Argument(0).String()
		descArgs := call.Arguments[1:]
		descriptions := make([]string, len(descArgs))
		for i, a := range descArgs {
			descriptions[i] = a.String()
		}
		if err := p.subscribeRpcMethod(name, descriptions...); err != nil {
			if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] rpc.subscribe reject: %v", p.Name, rejectErr)
			}
			return rt.ToValue(promise)
		}
		if err := resolve(goja.Undefined()); err != nil {
			logging.LogErrorf("[plugin:%s] rpc.subscribe resolve: %v", p.Name, err)
		}
		return rt.ToValue(promise)
	}))

	rpc.Set("unsubscribe", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		if len(call.Arguments) < 1 {
			if err := reject(rt.NewGoError(fmt.Errorf("method name required"))); err != nil {
				logging.LogErrorf("[plugin:%s] rpc.unsubscribe reject: %v", p.Name, err)
			}
			return rt.ToValue(promise)
		}
		name := call.Argument(0).String()
		if err := p.unsubscribeRpcMethod(name); err != nil {
			if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] rpc.unsubscribe reject: %v", p.Name, rejectErr)
			}
			return rt.ToValue(promise)
		}
		if err := resolve(goja.Undefined()); err != nil {
			logging.LogErrorf("[plugin:%s] rpc.unsubscribe resolve: %v", p.Name, err)
		}
		return rt.ToValue(promise)
	}))

	rpc.Set("broadcast", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		if len(call.Arguments) < 1 {
			if err := reject(rt.NewGoError(fmt.Errorf("method required"))); err != nil {
				logging.LogErrorf("[plugin:%s] rpc.broadcast reject: %v", p.Name, err)
			}
			return rt.ToValue(promise)
		}
		method := call.Argument(0).String()
		var params any
		if len(call.Arguments) > 1 && !goja.IsNull(call.Argument(1)) && !goja.IsUndefined(call.Argument(1)) {
			params = call.Argument(1).Export()
		}
		_ = p.worker.Run(func() (result any, err error) {
			p.BroadcastNotification(method, params)
			if err := resolve(goja.Undefined()); err != nil {
				logging.LogErrorf("[plugin:%s] rpc.broadcast resolve: %v", p.Name, err)
			}
			return
		}, nil, p.context)
		return rt.ToValue(promise)
	}))

	if err := ObjectFreeze(rt, rpc); err != nil {
		return fmt.Errorf("failed to freeze siyuan.rpc object: %w", err)
	}

	return siyuan.Set("rpc", rpc)
}

// ObjectFreeze calls Object.freeze() on the given goja object.
func ObjectFreeze(rt *goja.Runtime, obj *goja.Object) error {
	Object, ok := rt.GlobalObject().Get("Object").(*goja.Object)
	if !ok {
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
	Object, ok := rt.GlobalObject().Get("Object").(*goja.Object)
	if !ok {
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
func ObjectSetDataMethods(p *KernelPlugin, rt *goja.Runtime, object *goja.Object, data []byte) {
	object.Set("text", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, _ := rt.NewPromise()
		_ = p.worker.Run(func() (result any, err error) {
			if err := resolve(rt.ToValue(string(data))); err != nil {
				logging.LogErrorf("[plugin:%s] text resolve: %v", p.Name, err)
			}
			return
		}, nil, p.context)
		return rt.ToValue(promise)
	}))
	object.Set("json", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := rt.NewPromise()
		_ = p.worker.Run(func() (result any, err error) {
			v, e := goValueToJsValueSafely(rt, json.RawMessage(data))
			if e != nil {
				if err := reject(rt.NewGoError(e)); err != nil {
					logging.LogErrorf("[plugin:%s] json reject: %v", p.Name, err)
				}
				return
			}
			if err := resolve(v); err != nil {
				logging.LogErrorf("[plugin:%s] json resolve: %v", p.Name, err)
			}
			return
		}, nil, p.context)
		return rt.ToValue(promise)
	}))
	object.Set("arrayBuffer", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		promise, resolve, _ := rt.NewPromise()
		_ = p.worker.Run(func() (result any, err error) {
			if err := resolve(rt.ToValue(rt.NewArrayBuffer(data))); err != nil {
				logging.LogErrorf("[plugin:%s] arrayBuffer resolve: %v", p.Name, err)
			}
			return
		}, nil, p.context)
		return rt.ToValue(promise)
	}))
}

// loggerWrapper returns a JS-callable function that logs a message at the given level.
// Logging is synchronous (in-process, no I/O), so resolve is called inline without worker.Run.
func loggerWrapper(p *KernelPlugin, rt *goja.Runtime, logFn func(format string, args ...any)) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		promise, resolve, _ := rt.NewPromise()

		runErr := p.worker.Run(func() (result any, err error) {
			parts := make([]string, 0, len(call.Arguments))
			for _, arg := range call.Arguments {
				parts = append(parts, arg.String())
			}
			msg := strings.Join(parts, " ")

			logFn("[plugin:%s] %s", p.Name, msg)
			return
		}, func(result any, err error) {

		}, p.context)
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] loggerWrapper worker run: %v", p.Name, runErr)
		}

		if err := resolve(goja.Undefined()); err != nil {
			logging.LogErrorf("[plugin:%s] logger resolve: %v", p.Name, err)
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
	case map[string]any:
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
	var cur goja.Value = rt.GlobalObject()
	for _, path := range paths {
		obj, ok := cur.(*goja.Object)
		if !ok {
			err = fmt.Errorf("path %v: expected object, got %T", path, cur)
			return
		}

		switch k := path.(type) {
		case string:
			cur = obj.Get(k)
		case int:
			cur = obj.Get(strconv.Itoa(k))
		default:
			err = fmt.Errorf("unsupported path type: %T", path)
			return
		}
	}
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
	if err != nil || event == nil {
		return
	}

	eventObj, ok := event.(*goja.Object)
	if !ok {
		return
	}

	hook := eventObj.Get("on")
	if hook == nil || goja.IsNull(hook) || goja.IsUndefined(hook) {
		return
	}

	fn, ok := goja.AssertFunction(hook)
	if !ok {
		return
	}

	eventJs := rt.ToValue(e)

	invokeResult, invokeErr := fn(event, eventJs)
	if invokeErr != nil {
		err = invokeErr
		return
	}

	// Strict true-only: do NOT use ToBoolean() — any truthy object (e.g. a Promise) would deadlock invokeHook.
	await = invokeResult != nil && invokeResult.Export() == true
	return
}
