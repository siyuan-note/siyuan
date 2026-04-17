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
	"strings"
	"sync"

	"github.com/fastschema/qjs"
	"github.com/gorilla/websocket"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	WebSocketReadyStateConnecting = 0 + iota
	WebSocketReadyStateOpen
	WebSocketReadyStateClosing
	WebSocketReadyStateClosed
)

var (
	client *req.Client = req.C()
)

// injectSandboxGlobals injects all siyuan.* APIs into the plugin's QJS context.
func injectSandboxGlobals(p *KernelPlugin) error {
	runtime := p.Runtime()
	if runtime == nil {
		return fmt.Errorf("QJS runtime not initialized")
	}

	ctx := runtime.Context()

	// Create the `siyuan` global object as an empty object
	siyuan := ctx.NewObject()

	injectPlugin(ctx, p, siyuan)
	injectLogger(ctx, p, siyuan)
	injectStorage(ctx, p, siyuan)
	injectFetch(ctx, p, siyuan)
	injectSocket(ctx, p, siyuan)
	injectRpc(ctx, p, siyuan)

	ctx.Global().SetPropertyStr("siyuan", siyuan)

	return nil
}

// injectPlugin adds siyuan.plugin to the QJS context.
func injectPlugin(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	i18n, err := GoValueToJsValue(ctx, p.I18n)
	if err != nil {
		i18n = ctx.NewNull()
	}

	plugin := ctx.NewObject()

	plugin.SetPropertyStr("name", ctx.NewString(p.Name))
	plugin.SetPropertyStr("displayName", ctx.NewString(p.DisplayName))
	plugin.SetPropertyStr("platform", ctx.NewString(bazaar.GetCurrentBackend()))
	plugin.SetPropertyStr("i18n", i18n)

	plugin.SetPropertyStr("onload", ctx.NewNull())
	plugin.SetPropertyStr("onunload", ctx.NewNull())

	siyuan.SetPropertyStr("plugin", plugin)
	return nil
}

// injectLogger adds siyuan.logger to the QJS context.
func injectLogger(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	loggerWrapper := func(logFn func(format string, args ...any)) func(this *qjs.This) (*qjs.Value, error) {
		return func(this *qjs.This) (value *qjs.Value, err error) {
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("panic during logger: %v", r)
				}
			}()

			// Get arguments via this.Args()
			args := this.Args()
			if len(args) < 1 {
				return ctx.NewUndefined(), nil
			}

			prefix := fmt.Sprintf("[plugin:%s]", p.Name)

			parts := make([]string, 0, len(args))
			for _, arg := range args {
				parts = append(parts, arg.String())
			}
			msg := strings.Join(parts, " ")

			logFn("%s %s", prefix, msg)

			return ctx.NewUndefined(), nil
		}
	}

	logger := ctx.NewObject()

	logger.SetPropertyStr("trace", ctx.Function(loggerWrapper(logging.LogTracef), false))
	logger.SetPropertyStr("debug", ctx.Function(loggerWrapper(logging.LogDebugf), false))
	logger.SetPropertyStr("info", ctx.Function(loggerWrapper(logging.LogInfof), false))
	logger.SetPropertyStr("warn", ctx.Function(loggerWrapper(logging.LogWarnf), false))
	logger.SetPropertyStr("error", ctx.Function(loggerWrapper(logging.LogErrorf), false))

	siyuan.SetPropertyStr("logger", logger)
	return nil
}

// injectStorage adds siyuan.storage.* methods for scoped file CRUD.
func injectStorage(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	baseDir := filepath.Join(util.DataDir, "storage", "petal", p.Name)

	// Resolve and validate a relative path against the plugin's storage base directory.
	resolvePath := func(relPath string) (string, error) {
		abs := filepath.Join(baseDir, filepath.Clean(relPath))
		// Ensure the resolved path is still within baseDir
		if !(abs == baseDir || strings.HasPrefix(abs, baseDir+string(filepath.Separator))) {
			return "", fmt.Errorf("siyuan.storage: path traversal not allowed")
		}
		return abs, nil
	}

	storage := ctx.NewObject()

	storageMu := sync.Mutex{} // guards all storage operations to prevent

	// siyuan.storage.get(path) -> Promise<Uint8Array>
	storage.SetPropertyStr("get", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		go func() {
			storageMu.Lock()
			defer storageMu.Unlock()

			defer func() {
				if r := recover(); r != nil {
					this.Promise().Reject(ctx.NewError(fmt.Errorf("panic during siyuan.storage.get: %v", r)))
				}
			}()

			args := this.Args()
			if len(args) < 1 {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.get: path required")))
				return
			}
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}
			data, err := filelock.ReadFile(abs)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.get: %w", err)))
				return
			}
			result := ctx.NewString(string(data))
			this.Promise().Resolve(result)
		}()
		return
	}, true))

	// siyuan.storage.put(path, content) -> Promise<void>
	storage.SetPropertyStr("put", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		go func() {
			storageMu.Lock()
			defer storageMu.Unlock()

			defer func() {
				if r := recover(); r != nil {
					this.Promise().Reject(ctx.NewError(fmt.Errorf("panic during siyuan.storage.put: %v", r)))
				}
			}()

			args := this.Args()
			if len(args) < 2 {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.put: path and content required")))
				return
			}
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}
			dir := filepath.Dir(abs)
			if err = os.MkdirAll(dir, 0755); err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.put: mkdir: %w", err)))
				return
			}
			if err = filelock.WriteFile(abs, []byte(args[1].String())); err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.put: %w", err)))
				return
			}
			this.Promise().Resolve(ctx.NewUndefined())
		}()
		return
	}, true))

	// siyuan.storage.remove(path) -> Promise<void>
	storage.SetPropertyStr("remove", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {

		go func() {
			storageMu.Lock()
			defer storageMu.Unlock()

			defer func() {
				if r := recover(); r != nil {
					this.Promise().Reject(ctx.NewError(fmt.Errorf("panic during siyuan.storage.remove: %v", r)))
				}
			}()

			args := this.Args()
			if len(args) < 1 {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.remove: path required")))
				return
			}
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}
			if abs == baseDir {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.remove: cannot remove storage root")))
				return
			}
			if err = os.RemoveAll(abs); err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.remove: %w", err)))
				return
			}
			this.Promise().Resolve(ctx.NewUndefined())
		}()
		return
	}, true))

	// siyuan.storage.list(path) -> Promise<Entry[]>
	storage.SetPropertyStr("list", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		go func() {
			storageMu.Lock()
			defer storageMu.Unlock()

			defer func() {
				if r := recover(); r != nil {
					this.Promise().Reject(ctx.NewError(fmt.Errorf("panic during siyuan.storage.list: %v", r)))
				}
			}()

			args := this.Args()
			if len(args) < 1 {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.list: path required")))
				return
			}
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}
			entries, err := os.ReadDir(abs)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.list: %w", err)))
				return
			}

			// Build result as JSON string, then parse to JS object
			result := make([]map[string]any, 0, len(entries))
			for _, entry := range entries {
				info, infoErr := entry.Info()
				if infoErr != nil {
					continue
				}
				result = append(result, map[string]any{
					"name":      entry.Name(),
					"isDir":     info.IsDir(),
					"isSymlink": util.IsSymlink(entry),
					"updated":   info.ModTime().Unix(),
				})
			}

			resultJs, err := GoValueToJsValue(ctx, result)
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}

			this.Promise().Resolve(resultJs)
		}()
		return
	}, true))

	siyuan.SetPropertyStr("storage", storage)
	return nil
}

// injectFetch adds siyuan.fetch method that tunnels HTTP requests to the kernel's REST API.
func injectFetch(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	siyuan.SetPropertyStr("fetch", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("panic during siyuan.fetch: %v", r)))
			}
		}()

		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.fetch: path required")))
			return
		}

		path := args[0].String()

		// Path validation: must start with /
		if !strings.HasPrefix(path, "/") {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.fetch: path must start with /")))
			return
		}

		method := "GET"
		headers := map[string]string{}

		var stringBody string
		var bytesBody []byte

		// Parse init options if provided
		if len(args) > 1 && !args[1].IsNull() && !args[1].IsUndefined() {
			init := args[1]
			if m := init.GetPropertyStr("method"); m != nil && !m.IsUndefined() {
				method = m.String()
			}
			if b := init.GetPropertyStr("body"); b != nil && !b.IsUndefined() {
				if b.IsString() {
					stringBody = b.String()
				} else if b.IsByteArray() {
					bytesBody = b.Bytes()
				}
			}
			if h := init.GetPropertyStr("headers"); h != nil && !h.IsUndefined() && h.IsObject() {
				// Extract headers via JSON round-trip to avoid complex JS property enumeration
				headersJSON, jsonErr := h.JSONStringify()
				if jsonErr == nil {
					var parsed map[string]any
					if unmarshalErr := json.Unmarshal([]byte(headersJSON), &parsed); unmarshalErr == nil {
						for k, v := range parsed {
							headers[k] = fmt.Sprintf("%v", v)
						}
					}
				}
			}
		}

		go func() {
			targetURL := fmt.Sprintf("http://127.0.0.1:%s%s", util.ServerPort, path)

			r := client.R()

			// Apply user headers (Authorization will be overwritten above)
			for k, v := range headers {
				r.SetHeader(k, v)
			}
			r.SetHeader(model.XAuthTokenKey, p.token)

			if stringBody != "" {
				r.SetBody(stringBody)
			} else if len(bytesBody) > 0 {
				r.SetBody(bytesBody)
			}

			resp, err := r.Send(method, targetURL)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.fetch: %w", err)))
				return
			}
			defer resp.Body.Close()

			respBody, err := io.ReadAll(resp.Body)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.fetch: read body: %w", err)))
				return
			}

			// Build Response-like object
			respHeaders := map[string]string{}
			for k, vs := range resp.Header {
				respHeaders[k] = strings.Join(vs, ", ")
			}

			// ctx.ParseJSON(string(json.Marshal(m))) 2.5x faster than qjs.GoMapToJs(ctx, reflect.ValueOf(m))
			respHeadersJs, err := GoValueToJsValue(ctx, respHeaders)
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}

			response := ctx.NewObject()
			response.SetPropertyStr("url", ctx.NewString(targetURL))
			response.SetPropertyStr("ok", ctx.NewBool(resp.StatusCode >= 200 && resp.StatusCode < 300))
			response.SetPropertyStr("status", qjs.GoNumberToJs(ctx, resp.StatusCode))
			response.SetPropertyStr("statusText", ctx.NewString(resp.Status))
			response.SetPropertyStr("headers", respHeadersJs)
			response.SetPropertyStr("body", ctx.NewBytes(respBody))

			response.SetPropertyStr("text", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
				go func() {
					defer func() {
						if r := recover(); r != nil {
							this.Promise().Reject(ctx.NewError(fmt.Errorf("panic during response.text: %v", r)))
						}
					}()

					this.Promise().Resolve(ctx.NewString(string(respBody)))
				}()
				return
			}, true))
			response.SetPropertyStr("json", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
				go func() {
					defer func() {
						if r := recover(); r != nil {
							this.Promise().Reject(ctx.NewError(fmt.Errorf("panic during response.json: %v", r)))
						}
					}()

					value, err := ParseJsonStringToJsValue(ctx, string(respBody))
					if err != nil {
						this.Promise().Reject(ctx.NewError(err))
						return
					}
					this.Promise().Resolve(value)
				}()
				return
			}, true))
			response.SetPropertyStr("arrayBuffer", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
				go func() {
					defer func() {
						if r := recover(); r != nil {
							this.Promise().Reject(ctx.NewError(fmt.Errorf("panic during response.arrayBuffer: %v", r)))
						}
					}()

					this.Promise().Resolve(ctx.NewArrayBuffer(respBody))
				}()
				return
			}, true))

			this.Promise().Resolve(response)
		}()
		return
	}, true))
	return nil
}

// injectSocket adds siyuan.socket method with browser-compatible WebSocket API.
func injectSocket(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	siyuan.SetPropertyStr("socket", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("panic during siyuan.socket: %v", r)))
			}
		}()

		var path string
		var protocol *qjs.Value

		args := this.Args()
		if len(args) < 1 {
			err = fmt.Errorf("siyuan.socket: path required")
			return
		}

		if len(args) > 0 && args[0] != nil && args[0].IsString() {
			path = args[0].String()
		}

		if len(args) > 1 && args[1] != nil && !args[1].IsNull() && !args[1].IsUndefined() {
			protocol = args[1]
		}

		if !strings.HasPrefix(path, "/") {
			err = fmt.Errorf("siyuan.socket: path must start with /")
			return
		}

		wsURL := fmt.Sprintf("ws://127.0.0.1:%s%s", util.ServerPort, path)

		wsHeader := http.Header{}
		wsHeader.Set(model.XAuthTokenKey, p.token)

		if protocol.IsString() {
			wsHeader.Set("Sec-WebSocket-Protocol", protocol.String())
		} else if protocol.IsArray() {
			protocols, err := qjs.JsArrayToGo[[]string](protocol)
			if err == nil {
				wsHeader.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
			}
		}

		// Store connection reference (accessed via closure)
		var mu sync.RWMutex // guards conn, sendQueue, readyState
		var conn *websocket.Conn
		var readyState int
		var sendQueue []any    // send calls may happen before connection is established, so we queue them
		var writeMu sync.Mutex // serializes all conn.WriteMessage calls

		// Create a JS object representing the WebSocket
		wsObj := ctx.NewObject()

		setReadyState := func(state int) {
			mu.Lock()
			readyState = state
			mu.Unlock()
			wsObj.SetPropertyStr("readyState", ctx.NewInt64(int64(state)))
		}

		invokeWsHook := func(name string, args ...*qjs.Value) {
			hook := wsObj.GetPropertyStr(name)
			if hook != nil && hook.IsFunction() {
				wsObj.InvokeJS(name, args...)
			}
		}

		setReadyState(WebSocketReadyStateConnecting)
		wsObj.SetPropertyStr("onopen", ctx.NewNull())
		wsObj.SetPropertyStr("onping", ctx.NewNull())
		wsObj.SetPropertyStr("onpong", ctx.NewNull())
		wsObj.SetPropertyStr("onerror", ctx.NewNull())
		wsObj.SetPropertyStr("onmessage", ctx.NewNull())
		wsObj.SetPropertyStr("onclose", ctx.NewNull())

		// send method - implemented as a Go function that JS can call
		wsObj.SetPropertyStr("send", ctx.Function(func(sendThis *qjs.This) (result *qjs.Value, err error) {
			sendArgs := sendThis.Args()
			if len(sendArgs) < 1 {
				return
			}
			data := sendArgs[0]

			mu.RLock()
			state := readyState
			mu.RUnlock()

			if state == 1 { // OPEN
				mu.RLock()
				c := conn
				mu.RUnlock()
				if c != nil {
					writeMu.Lock()
					if data.IsString() {
						c.WriteMessage(websocket.TextMessage, []byte(data.String()))
					} else if data.IsByteArray() {
						c.WriteMessage(websocket.BinaryMessage, data.Bytes())
					}
					writeMu.Unlock()
				}
				return
			}

			if state == 0 { // CONNECTING - queue for later
				mu.Lock()
				if data.IsString() {
					sendQueue = append(sendQueue, data.String())
				} else if data.IsByteArray() {
					sendQueue = append(sendQueue, data.Bytes())
				}
				mu.Unlock()
				return
			}

			return
		}))

		// ping method
		wsObj.SetPropertyStr("ping", ctx.Function(func(pingThis *qjs.This) (result *qjs.Value, err error) {
			var data string

			args := pingThis.Args()
			if len(args) > 0 && args[0].IsString() {
				data = args[0].String()
			}

			mu.RLock()
			c := conn
			mu.RUnlock()
			if c != nil {
				writeMu.Lock()
				c.WriteMessage(websocket.PingMessage, []byte(data))
				writeMu.Unlock()
			}
			return
		}, false))

		// pong method
		wsObj.SetPropertyStr("pong", ctx.Function(func(pongThis *qjs.This) (result *qjs.Value, err error) {
			var data string

			args := pongThis.Args()
			if len(args) > 0 && args[0].IsString() {
				data = args[0].String()
			}

			mu.RLock()
			c := conn
			mu.RUnlock()
			if c != nil {
				writeMu.Lock()
				c.WriteMessage(websocket.PongMessage, []byte(data))
				writeMu.Unlock()
			}
			return
		}, false))

		// close method
		wsObj.SetPropertyStr("close", ctx.Function(func(closeThis *qjs.This) (result *qjs.Value, err error) {
			var code int = websocket.CloseNormalClosure
			var reason string

			args := closeThis.Args()
			if len(args) > 0 && args[0].IsNumber() {
				code = int(args[0].Int64())
			}
			if len(args) > 1 && args[1].IsString() {
				reason = args[1].String()
			}

			mu.RLock()
			c := conn
			mu.RUnlock()
			if c != nil {
				writeMu.Lock()
				c.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason))
				writeMu.Unlock()
			}
			return
		}, false))

		// Start WebSocket connection in a goroutine
		go func() {
			defer func() {
				setReadyState(WebSocketReadyStateClosed)
			}()

			dialer := websocket.Dialer{}
			c, _, err := dialer.Dial(wsURL, wsHeader)
			if err != nil {
				event := ctx.NewObject()
				event.SetPropertyStr("type", ctx.NewString("error"))
				event.SetPropertyStr("error", ctx.NewError(err))
				invokeWsHook("onerror", event)
				return
			}

			defer func() {
				p.UntrackSocket(c)
				c.Close()
			}()
			p.TrackSocket(c, false)

			c.SetPingHandler(func(data string) (err error) {
				event := ctx.NewObject()
				event.SetPropertyStr("type", ctx.NewString("ping"))
				event.SetPropertyStr("data", ctx.NewString(data))
				invokeWsHook("onping", event)
				return
			})
			c.SetPongHandler(func(data string) (err error) {
				event := ctx.NewObject()
				event.SetPropertyStr("type", ctx.NewString("pong"))
				event.SetPropertyStr("data", ctx.NewString(data))
				invokeWsHook("onpong", event)
				return
			})
			c.SetCloseHandler(func(code int, reason string) (err error) {
				setReadyState(WebSocketReadyStateClosing)

				event := ctx.NewObject()
				event.SetPropertyStr("type", ctx.NewString("close"))
				event.SetPropertyStr("code", ctx.NewInt64(int64(code)))
				event.SetPropertyStr("reason", ctx.NewString(reason))
				invokeWsHook("onclose", event)
				return
			})

			// Flush send queue
			mu.Lock()
			writeMu.Lock()
			for _, data := range sendQueue {
				switch v := data.(type) {
				case string:
					c.WriteMessage(websocket.TextMessage, []byte(v))
				case []byte:
					c.WriteMessage(websocket.BinaryMessage, v)
				}
			}
			writeMu.Unlock()

			conn = c
			sendQueue = nil
			readyState = WebSocketReadyStateOpen
			mu.Unlock()

			setReadyState(WebSocketReadyStateOpen)
			invokeWsHook("onopen")

			// Read loop - consumes messages but doesn't dispatch to JS yet
			// (requires QJS event loop integration for safe callback invocation)
			for {
				messageType, data, readErr := c.ReadMessage()
				if readErr != nil {
					if websocket.IsUnexpectedCloseError(readErr, websocket.CloseNormalClosure) {
						event := ctx.NewObject()
						event.SetPropertyStr("type", ctx.NewString("error"))
						event.SetPropertyStr("error", ctx.NewError(readErr))
						invokeWsHook("onerror", event)
					}
					break
				}
				switch messageType {
				case websocket.TextMessage:
					event := ctx.NewObject()
					event.SetPropertyStr("type", ctx.NewString("message"))
					event.SetPropertyStr("data", ctx.NewString(string(data)))
					invokeWsHook("onmessage", event)
				case websocket.BinaryMessage:
					event := ctx.NewObject()
					event.SetPropertyStr("type", ctx.NewString("message"))
					event.SetPropertyStr("data", ctx.NewArrayBuffer(data))
					invokeWsHook("onmessage", event)
				}
			}
		}()

		return wsObj, nil
	}, false))
	return nil
}

// injectRpc adds siyuan.rpc method for RPC method registration.
func injectRpc(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	rpc := ctx.NewObject()

	rpc.SetPropertyStr("bind", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("panic during siyuan.rpc.bind: %v", r)
			}
		}()

		args := this.Args()
		if len(args) < 2 {
			err = fmt.Errorf("siyuan.rpc.bind: name and function required")
			return
		}

		name := args[0].String()
		method := args[1]

		descriptions := make([]string, len(args)-2)
		for i := 2; i < len(args); i++ {
			descriptions[i-2] = args[i].String()
		}

		if !method.IsFunction() {
			err = fmt.Errorf("siyuan.rpc.bind: second argument must be a function")
			return
		}

		if err = p.bindRpcMethod(name, method, descriptions...); err != nil {
			return
		}

		return
	}, false))

	rpc.SetPropertyStr("unbind", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("panic during siyuan.rpc.unbind: %v", r)
			}
		}()

		args := this.Args()
		if len(args) < 2 {
			err = fmt.Errorf("siyuan.rpc.unbind: name and function required")
			return
		}

		name := args[0].String()
		fn := args[1]

		if !fn.IsFunction() {
			err = fmt.Errorf("siyuan.rpc.unbind: second argument must be a function")
			return
		}

		if err = p.unbindRpcMethod(name, fn); err != nil {
			return
		}

		return
	}, false))

	rpc.SetPropertyStr("broadcast", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("panic during siyuan.rpc.broadcast: %v", r)
			}
		}()

		args := this.Args()
		if len(args) < 1 {
			err = fmt.Errorf("siyuan.rpc.broadcast: method required")
			return
		}

		method := args[0].String()

		var params any
		if len(args) > 1 && !args[1].IsNull() && !args[1].IsUndefined() {
			paramsJSON, jsonErr := args[1].JSONStringify()
			if jsonErr != nil {
				err = fmt.Errorf("siyuan.rpc.broadcast: serialize params: %w", jsonErr)
				return
			}
			if jsonErr = json.Unmarshal([]byte(paramsJSON), &params); jsonErr != nil {
				err = fmt.Errorf("siyuan.rpc.broadcast: parse params: %w", jsonErr)
				return
			}
		}

		p.BroadcastNotification(method, params)
		return
	}, false))

	siyuan.SetPropertyStr("rpc", rpc)
	return nil
}

// GoValueToJsValue converts a Go value to a QJS Value by JSON serialization round-trip, returning an error if serialization fails.
func GoValueToJsValue(ctx *qjs.Context, value any) (result *qjs.Value, err error) {
	valueBytes, err := json.Marshal(value)
	if err != nil {
		return
	}

	return ParseJsonStringToJsValue(ctx, string(valueBytes))
}

// ParseJsonStringToJsValue parses a JSON string into a QJS Value, returning an error if parsing fails.
func ParseJsonStringToJsValue(ctx *qjs.Context, jsonStr string) (result *qjs.Value, err error) {
	result = ctx.ParseJSON(jsonStr)
	if ctx.HasException() {
		result = nil
		err = ctx.Exception()
	}
	return
}

func ParseJsonArrayStringToJsValueArray(ctx *qjs.Context, jsonStr string) (result []*qjs.Value, err error) {
	var jsonArray []json.RawMessage
	err = json.Unmarshal([]byte(jsonStr), &jsonArray)
	if err != nil {
		return
	}

	result = make([]*qjs.Value, len(jsonArray))
	for i, jsonItem := range jsonArray {
		result[i], err = ParseJsonStringToJsValue(ctx, string(jsonItem))
		if err != nil {
			return
		}
	}
	return
}
