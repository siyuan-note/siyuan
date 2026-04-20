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

	if err := ObjectFreeze(ctx, siyuan); err != nil {
		return fmt.Errorf("failed to freeze siyuan object: %w", err)
	}

	ctx.Global().SetPropertyStr("siyuan", siyuan)

	return nil
}

// injectPlugin adds siyuan.plugin to the QJS context.
func injectPlugin(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	i18n, err := goValueToJsValue(ctx, p.I18n)
	if err != nil {
		i18n = ctx.NewNull()
	}

	plugin := ctx.NewObject()

	plugin.SetPropertyStr("name", ctx.NewString(p.Name))
	plugin.SetPropertyStr("displayName", ctx.NewString(p.DisplayName))
	plugin.SetPropertyStr("platform", ctx.NewString(bazaar.GetCurrentBackend()))
	plugin.SetPropertyStr("i18n", i18n)

	plugin.SetPropertyStr("onload", ctx.NewNull())
	plugin.SetPropertyStr("onloaded", ctx.NewNull())
	plugin.SetPropertyStr("onunload", ctx.NewNull())

	if err := ObjectSeal(ctx, plugin); err != nil {
		return fmt.Errorf("failed to seal siyuan.plugin object: %w", err)
	}

	siyuan.SetPropertyStr("plugin", plugin)

	return nil
}

// injectLogger adds siyuan.logger to the QJS context.
func injectLogger(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {

	logger := ctx.NewObject()

	logger.SetPropertyStr("trace", ctx.Function(loggerWrapper(ctx, p.Name, logging.LogTracef), false))
	logger.SetPropertyStr("debug", ctx.Function(loggerWrapper(ctx, p.Name, logging.LogDebugf), false))
	logger.SetPropertyStr("info", ctx.Function(loggerWrapper(ctx, p.Name, logging.LogInfof), false))
	logger.SetPropertyStr("warn", ctx.Function(loggerWrapper(ctx, p.Name, logging.LogWarnf), false))
	logger.SetPropertyStr("error", ctx.Function(loggerWrapper(ctx, p.Name, logging.LogErrorf), false))

	if err := ObjectFreeze(ctx, logger); err != nil {
		return fmt.Errorf("failed to freeze siyuan.logger object: %w", err)
	}

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

	storageMu := sync.RWMutex{} // guards all storage operations to prevent

	// siyuan.storage.get(path) -> Promise<Uint8Array>
	storage.SetPropertyStr("get", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		storageMu.RLock()
		defer storageMu.RUnlock()

		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("qjs panic during siyuan.storage.get: %v", r)
			}

			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
			} else {
				this.Promise().Resolve(result)
			}
		}()

		args := this.Args()
		if len(args) < 1 {
			err = fmt.Errorf("siyuan.storage.get: path required")
			return
		}

		abs, resolveErr := resolvePath(args[0].String())
		if resolveErr != nil {
			err = resolveErr
			return
		}

		data, readErr := filelock.ReadFile(abs)
		if readErr != nil {
			err = fmt.Errorf("siyuan.storage.get: %w", readErr)
			return
		}

		result = ctx.NewString(string(data))
		return
	}, true))

	// siyuan.storage.put(path, content) -> Promise<void>
	storage.SetPropertyStr("put", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		storageMu.Lock()
		defer storageMu.Unlock()

		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("qjs panic during siyuan.storage.put: %v", r)
			}

			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
			} else {
				this.Promise().Resolve(result)
			}
		}()

		args := this.Args()
		if len(args) < 2 {
			err = fmt.Errorf("siyuan.storage.put: path and content required")
			return
		}

		abs, resolveErr := resolvePath(args[0].String())
		if resolveErr != nil {
			err = resolveErr
			return
		}

		dir := filepath.Dir(abs)
		if mkdirErr := os.MkdirAll(dir, 0755); mkdirErr != nil {
			err = fmt.Errorf("siyuan.storage.put: MkdirAll: %w", mkdirErr)
			return
		}

		if writeErr := filelock.WriteFile(abs, []byte(args[1].String())); writeErr != nil {
			err = fmt.Errorf("siyuan.storage.put: WriteFile: %w", writeErr)
			return
		}

		result = ctx.NewUndefined()
		return
	}, true))

	// siyuan.storage.remove(path) -> Promise<void>
	storage.SetPropertyStr("remove", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		storageMu.Lock()
		defer storageMu.Unlock()

		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("qjs panic during siyuan.storage.remove: %v", r)
			}

			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
			} else {
				this.Promise().Resolve(result)
			}
		}()

		args := this.Args()
		if len(args) < 1 {
			err = fmt.Errorf("siyuan.storage.remove: path required")
			return
		}

		abs, resolveErr := resolvePath(args[0].String())
		if resolveErr != nil {
			err = resolveErr
			return
		}

		if abs == baseDir {
			err = fmt.Errorf("siyuan.storage.remove: cannot remove storage root")
			return
		}

		if removeErr := os.RemoveAll(abs); removeErr != nil {
			err = fmt.Errorf("siyuan.storage.remove: RemoveAll: %w", removeErr)
			return
		}

		result = ctx.NewUndefined()
		return
	}, true))

	// siyuan.storage.list(path) -> Promise<Entry[]>
	storage.SetPropertyStr("list", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		storageMu.RLock()
		defer storageMu.RUnlock()

		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("qjs panic during siyuan.storage.list: %v", r)
			}

			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
			} else {
				this.Promise().Resolve(result)
			}
		}()

		args := this.Args()
		if len(args) < 1 {
			err = fmt.Errorf("siyuan.storage.list: path required")
			return
		}

		abs, resolveErr := resolvePath(args[0].String())
		if resolveErr != nil {
			err = resolveErr
			return
		}

		entries, readErr := os.ReadDir(abs)
		if readErr != nil {
			err = fmt.Errorf("siyuan.storage.list: %w", readErr)
			return
		}

		// Build result as JSON string, then parse to JS object
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

		result, err = goValueToJsValue(ctx, results)
		return
	}, true))

	if err := ObjectFreeze(ctx, storage); err != nil {
		return fmt.Errorf("failed to freeze siyuan.storage object: %w", err)
	}

	siyuan.SetPropertyStr("storage", storage)
	return nil
}

// injectFetch adds siyuan.fetch method that tunnels HTTP requests to the kernel's REST API.
func injectFetch(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	siyuan.SetPropertyStr("fetch", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("qjs panic during siyuan.fetch: %v", r)
			}

			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
			} else {
				this.Promise().Resolve(result)
			}
		}()

		args := this.Args()
		if len(args) < 1 {
			err = fmt.Errorf("siyuan.fetch: path required")
			return
		}

		path := args[0].String()

		// Path validation: must start with /
		if !strings.HasPrefix(path, "/") {
			err = fmt.Errorf("siyuan.fetch: path must start with /")
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
			err = fmt.Errorf("siyuan.fetch: %w", err)
			return
		}
		defer resp.Body.Close()

		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			err = fmt.Errorf("siyuan.fetch: read body: %w", err)
			return
		}

		// Build Response-like object
		respHeaders := map[string]string{}
		for k, vs := range resp.Header {
			respHeaders[k] = strings.Join(vs, ", ")
		}

		// ctx.ParseJSON(string(json.Marshal(m))) 2.5x faster than qjs.GoMapToJs(ctx, reflect.ValueOf(m))
		respHeadersJs, err := goValueToJsValue(ctx, respHeaders)
		if err != nil {
			err = fmt.Errorf("siyuan.fetch: failed to convert response headers: %w", err)
			return
		}

		response := ctx.NewObject()
		response.SetPropertyStr("url", ctx.NewString(path))
		response.SetPropertyStr("ok", ctx.NewBool(resp.StatusCode >= 200 && resp.StatusCode < 300))
		response.SetPropertyStr("status", qjs.GoNumberToJs(ctx, resp.StatusCode))
		response.SetPropertyStr("statusText", ctx.NewString(resp.Status))
		response.SetPropertyStr("headers", respHeadersJs)

		response.SetPropertyStr("text", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("qjs panic during response.text: %v", r)
				}

				if err != nil {
					this.Promise().Reject(ctx.NewError(err))
				} else {
					this.Promise().Resolve(result)
				}
			}()

			result = ctx.NewString(string(respBody))
			return
		}, true))
		response.SetPropertyStr("json", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("qjs panic during response.json: %v", r)
				}

				if err != nil {
					this.Promise().Reject(ctx.NewError(err))
				} else {
					this.Promise().Resolve(result)
				}
			}()

			result, err = parseJsonStringToJsValue(ctx, string(respBody))
			return
		}, true))
		response.SetPropertyStr("arrayBuffer", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("qjs panic during response.arrayBuffer: %v", r)
				}

				if err != nil {
					this.Promise().Reject(ctx.NewError(err))
				} else {
					this.Promise().Resolve(result)
				}
			}()

			result = ctx.NewArrayBuffer(respBody)
			return
		}, true))

		result = response
		return
	}, true))
	return nil
}

// injectSocket adds siyuan.socket method with browser-compatible WebSocket API.
func injectSocket(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	siyuan.SetPropertyStr("socket", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("qjs panic during siyuan.socket: %v", r)
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

		if protocol != nil {
			if protocol.IsString() {
				wsHeader.Set("Sec-WebSocket-Protocol", protocol.String())
			} else if protocol.IsArray() {
				protocols, err := qjs.JsArrayToGo[[]string](protocol)
				if err == nil {
					wsHeader.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
				}
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
				ctx.Invoke(hook, wsObj, args...)
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
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("qjs panic during siyuan.socket.send: %v", r)
				}
			}()

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
		}, false))

		// ping method
		wsObj.SetPropertyStr("ping", ctx.Function(func(pingThis *qjs.This) (result *qjs.Value, err error) {
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("qjs panic during siyuan.socket.ping: %v", r)
				}
			}()

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
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("qjs panic during siyuan.socket.pong: %v", r)
				}
			}()

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
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("qjs panic during siyuan.socket.close: %v", r)
				}
			}()

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
				if r := recover(); r != nil {
					logging.LogErrorf("qjs panic during siyuan.socket: %v", r)
				}
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
			event := ctx.NewObject()
			event.SetPropertyStr("type", ctx.NewString("open"))
			invokeWsHook("onopen", event)

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
				err = fmt.Errorf("qjs panic during siyuan.rpc.bind: %v", r)
			}
		}()

		args := this.Args()
		if len(args) < 2 {
			err = fmt.Errorf("siyuan.rpc.bind: name and function required")
			return
		}

		name := args[0].String()
		method := args[1]

		descriptionArgs := args[2:]
		descriptions := make([]string, len(descriptionArgs))
		for i, arg := range descriptionArgs {
			descriptions[i] = arg.String()
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
				err = fmt.Errorf("qjs panic during siyuan.rpc.unbind: %v", r)
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

	rpc.SetPropertyStr("broadcast", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("qjs panic during siyuan.rpc.broadcast: %v", r)
			}

			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
			} else {
				this.Promise().Resolve(result)
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
		result = ctx.NewUndefined()
		return
	}, true))

	if err := ObjectFreeze(ctx, rpc); err != nil {
		return fmt.Errorf("failed to freeze siyuan.rpc object: %w", err)
	}

	siyuan.SetPropertyStr("rpc", rpc)
	return nil
}

// ObjectSeal applies Object.seal to the given JS object to prevent plugins from tampering with injected APIs, returning an error if sealing fails.
func ObjectSeal(ctx *qjs.Context, object *qjs.Value) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("qjs panic during invoke Object.seal: %v", r)
		}
	}()

	Object := ctx.Global().GetPropertyStr("Object")
	if Object == nil {
		return fmt.Errorf("Object not found in global context")
	}
	if !Object.IsObject() {
		return fmt.Errorf("Object is not an object in global context")
	}

	seal := Object.GetPropertyStr("seal")
	if seal == nil {
		return fmt.Errorf("Object.seal not found in global context")
	}
	if !seal.IsFunction() {
		return fmt.Errorf("Object.seal is not a function in global context")
	}

	_, invokeErr := ctx.Invoke(seal, Object, object)
	if invokeErr != nil {
		return invokeErr
	}
	return
}

// ObjectFreeze applies Object.freeze to the given JS object to prevent plugins from tampering with injected APIs, returning an error if freezing fails.
func ObjectFreeze(ctx *qjs.Context, object *qjs.Value) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("qjs panic during invoke Object.freeze: %v", r)
		}
	}()

	Object := ctx.Global().GetPropertyStr("Object")
	if Object == nil {
		return fmt.Errorf("Object not found in global context")
	}
	if !Object.IsObject() {
		return fmt.Errorf("Object is not an object in global context")
	}

	freeze := Object.GetPropertyStr("freeze")
	if freeze == nil {
		return fmt.Errorf("Object.freeze not found in global context")
	}
	if !freeze.IsFunction() {
		return fmt.Errorf("Object.freeze is not a function in global context")
	}

	_, invokeErr := ctx.Invoke(freeze, Object, object)
	if invokeErr != nil {
		return invokeErr
	}
	return
}

// invokeJsLifecycleHook calls a JS lifecycle hook (e.g. onload) if it exists, awaiting if it returns a Promise.
func invokeJsLifecycleHook(ctx *qjs.Context, name string) (result *qjs.Value, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("qjs panic during invoke siyuan.plugin.%s: %v", name, r)
		}
	}()

	plugin, err := getJsContextValue(ctx, []any{"siyuan", "plugin"})
	if err != nil {
		return
	}
	if plugin == nil {
		err = fmt.Errorf("globalThis.siyuan.plugin not found in JS context")
		return
	}

	hook := plugin.GetPropertyStr(name)
	if hook != nil && hook.IsFunction() {
		result, err = ctx.Invoke(hook, plugin)
		if err != nil {
			return
		}
		if result != nil {
			if result.IsPromise() {
				// Await if Promise
				result, err = result.Await()
			}
		}
	}
	return
}

// goValueToJsValue converts a Go value to a QJS Value by JSON serialization round-trip, returning an error if serialization fails.
func goValueToJsValue(ctx *qjs.Context, value any) (result *qjs.Value, err error) {
	valueBytes, err := json.Marshal(value)
	if err != nil {
		return
	}

	return parseJsonStringToJsValue(ctx, string(valueBytes))
}

// parseJsonStringToJsValue parses a JSON string into a QJS Value, returning an error if parsing fails.
func parseJsonStringToJsValue(ctx *qjs.Context, jsonStr string) (result *qjs.Value, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("qjs panic during parseJsonStringToJsValue: %v", r)
		}
	}()

	result = ctx.ParseJSON(jsonStr)
	if ctx.HasException() {
		result = nil
		err = ctx.Exception()
	}
	return
}

// parseJsonArrayStringToJsValueArray parses a JSON array string into a slice of QJS Values, returning an error if parsing fails.
func parseJsonArrayStringToJsValueArray(ctx *qjs.Context, jsonStr string) (result []*qjs.Value, err error) {
	// ⚠️ The code snippet below can't parse to right []*qjs.Value (only parse to [0, 0, ..., 0])
	// paramArray, _ := paramValue.ToArray()
	// paramsArray := make([]*qjs.Value, 0, paramArray.Len())
	// paramArray.ForEach(func(key *qjs.Value, value *qjs.Value) {
	// 	jsonStr, _ := value.JSONStringify()
	// 	paramsArray = append(paramsArray, ctx.NewString(jsonStr))
	// })

	var jsonArray []json.RawMessage
	err = json.Unmarshal([]byte(jsonStr), &jsonArray)
	if err != nil {
		return
	}

	result = make([]*qjs.Value, len(jsonArray))
	for i, jsonItem := range jsonArray {
		result[i], err = parseJsonStringToJsValue(ctx, string(jsonItem))
		if err != nil {
			return
		}
	}
	return
}

// getJsContextValue safely retrieves a nested value from the plugin's JS context, returning nil if any step fails.
func getJsContextValue(ctx *qjs.Context, paths []any) (value *qjs.Value, retErr error) {
	defer func() {
		if r := recover(); r != nil {
			retErr = fmt.Errorf("qjs panic during getJsContextValue: %v", r)
		}
	}()

	this := ctx.Global()

	for _, path := range paths {
		if this == nil {
			return
		}

		switch k := path.(type) {
		case string:
			this = this.GetPropertyStr(k)
		case int64:
			this = this.GetPropertyIndex(k)
		case *qjs.Value:
			this = this.GetProperty(k)
		default:
			return nil, fmt.Errorf("unsupported path type: %T", path)
		}
	}

	value = this
	return
}

// loggerWrapper creates a function that can be registered as a JavaScript logger method (e.g., debug, info, error) for the plugin. It formats the log message with the plugin name and forwards it to the provided logFn.
func loggerWrapper(ctx *qjs.Context, pluginName string, logFn func(format string, args ...any)) func(this *qjs.This) (*qjs.Value, error) {
	return func(this *qjs.This) (result *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("qjs panic during invoke siyuan.logger.%s: %v", pluginName, r)
			}
		}()

		// Get arguments via this.Args()
		args := this.Args()
		if len(args) < 1 {
			result = ctx.NewUndefined()
			return
		}

		parts := make([]string, 0, len(args))
		for _, arg := range args {
			parts = append(parts, arg.String())
		}
		msg := strings.Join(parts, " ")

		logFn("[plugin:%s] %s", pluginName, msg)

		result = ctx.NewUndefined()
		return
	}
}

// rpcParamsToJsValue converts Go RPC params to a *qjs.Value or []*qjs.Value for JS invocation.
// It accepts various Go types (string, []byte, json.RawMessage, or any JSON-serializable struct) and returns an error if conversion fails.
func rpcParamsToJsValue(ctx *qjs.Context, params any) (isArray bool, value *qjs.Value, array []*qjs.Value, err error) {
	if params == nil {
		return
	}

	var jsonStr string
	switch v := params.(type) {
	case string:
		jsonStr = v
	case *string:
		if v == nil {
			return
		}
		jsonStr = *v
	case []byte:
		jsonStr = string(v)
	case json.RawMessage:
		jsonStr = string(v)
	case *[]byte:
		if v == nil {
			return
		}
		jsonStr = string(*v)
	case *json.RawMessage:
		if v == nil {
			return
		}
		jsonStr = string(*v)
	default:
		b, marshalErr := json.Marshal(v)
		if marshalErr != nil {
			err = marshalErr
			return
		}
		jsonStr = string(b)
	}

	isArray = isJsonArray(jsonStr) // quick check to determine if we should parse as array or single value
	if isArray {
		array, err = parseJsonArrayStringToJsValueArray(ctx, jsonStr)
	} else {
		value, err = parseJsonStringToJsValue(ctx, jsonStr)
	}
	return
}

// invokeRpcMethod calls the given JS function with the provided params and returns the result or error.
func invokeRpcMethod(ctx *qjs.Context, rpcMethodName string, rpcMethod *qjs.Value, rpcParams any) (rpcResult any, rpcError *JsonRpcError) {
	// Convert params to JS value
	isArray, paramValue, paramArray, convertErr := rpcParamsToJsValue(ctx, rpcParams)
	if convertErr != nil {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("convert params: %v", convertErr),
		}
	}

	// Call the JS function using ctx.Invoke(fn, thisVal, args...)
	var result *qjs.Value
	var err error
	if isArray {
		result, err = ctx.Invoke(rpcMethod, ctx.Global(), paramArray...)
	} else {
		if paramValue == nil {
			result, err = ctx.Invoke(rpcMethod, ctx.Global())
		} else {
			result, err = ctx.Invoke(rpcMethod, ctx.Global(), paramValue)
		}
	}
	if err != nil {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("call %q: %v", rpcMethodName, err),
		}
	}

	// Await if Promise
	if result != nil && result.IsPromise() {
		result, err = result.Await()
		if err != nil {
			return nil, &JsonRpcError{
				Code:    JsonRpcErrorCodeInternalError,
				Message: fmt.Sprintf("await %q: %v", rpcMethodName, err),
			}
		}
	}

	// If result is null or undefined, return nil (JSON-RPC allows result to be null, but we treat undefined as null for convenience)
	if result == nil || result.IsNull() || result.IsUndefined() {
		return nil, nil
	}

	// Convert JS result to Go via JSON round-trip using the built-in JSONStringify method.
	jsonStr, stringifyErr := result.JSONStringify()
	if stringifyErr != nil {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("stringify result: %v", stringifyErr),
		}
	}

	// Unmarshal JSON string back to Go type (could be any JSON-serializable type: object, array, string, number, bool, or null)
	if err = json.Unmarshal([]byte(jsonStr), &rpcResult); err != nil {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("unmarshal result: %v", err),
		}
	}

	return
}
