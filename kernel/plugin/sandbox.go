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
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// injectSandboxGlobals injects all siyuan.* APIs into the plugin's QJS context.
func injectSandboxGlobals(p *KernelPlugin) error {
	ctx := p.runtime.Context()

	// Create the `siyuan` global object as an empty object
	siyuan := ctx.NewObject()

	injectPlugin(ctx, p, siyuan)
	injectLogger(ctx, p, siyuan)
	injectStorage(ctx, p, siyuan)
	injectFetch(ctx, p, siyuan)
	injectSocket(ctx, p, siyuan)
	injectRPC(ctx, p, siyuan)

	ctx.Global().SetPropertyStr("siyuan", siyuan)

	return nil
}

// injectPlugin adds siyuan.plugin to the QJS context.
func injectPlugin(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	plugin := ctx.NewObject()

	plugin.SetPropertyStr("name", ctx.NewString(p.Name))

	siyuan.SetPropertyStr("plugin", plugin)
	return nil
}

// injectLogger adds siyuan.logger to the QJS context.
func injectLogger(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	loggerWrapper := func(logFn func(format string, args ...interface{})) func(this *qjs.This) (*qjs.Value, error) {
		return func(this *qjs.This) (*qjs.Value, error) {
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

	logger.SetPropertyStr("trace", ctx.Function(loggerWrapper(logging.LogTracef)))
	logger.SetPropertyStr("debug", ctx.Function(loggerWrapper(logging.LogDebugf)))
	logger.SetPropertyStr("info", ctx.Function(loggerWrapper(logging.LogInfof)))
	logger.SetPropertyStr("warn", ctx.Function(loggerWrapper(logging.LogWarnf)))
	logger.SetPropertyStr("error", ctx.Function(loggerWrapper(logging.LogErrorf)))

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
		if !strings.HasPrefix(abs, baseDir) {
			return "", fmt.Errorf("siyuan.storage: path traversal not allowed")
		}
		return abs, nil
	}

	storage := ctx.NewObject()

	// siyuan.storage.get(path) -> Promise<Uint8Array>
	storage.SetPropertyStr("get", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.get: path required")))
			return
		}
		go func() {
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
			}
			data, err := filelock.ReadFile(abs)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.get: %w", err)))
				return
			}
			result := ctx.NewBytes(data)
			this.Promise().Resolve(result)
		}()
		return
	}, true))

	// siyuan.storage.put(path, content) -> Promise<void>
	storage.SetPropertyStr("put", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		args := this.Args()
		if len(args) < 2 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.put: path and content required")))
			return
		}
		go func() {
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
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.remove: path required")))
			return
		}
		go func() {
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
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
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.list: path required")))
			return
		}
		go func() {
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
			result := make([]map[string]interface{}, 0, len(entries))
			for _, entry := range entries {
				info, infoErr := entry.Info()
				if infoErr != nil {
					continue
				}
				result = append(result, map[string]interface{}{
					"name":      entry.Name(),
					"isDir":     info.IsDir(),
					"isSymlink": util.IsSymlink(entry),
					"updated":   info.ModTime().Unix(),
				})
			}

			jsonBytes, err := json.Marshal(result)
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}

			this.Promise().Resolve(ctx.ParseJSON(string(jsonBytes)))
		}()
		return
	}, true))

	siyuan.SetPropertyStr("storage", storage)
	return nil
}

// injectFetch adds siyuan.fetch method that tunnels HTTP requests to the kernel's REST API.
func injectFetch(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	siyuan.SetPropertyStr("fetch", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.fetch: path required")))
			return
		}

		path := args[0].String()

		// Path validation: must start with /, no scheme allowed
		if !strings.HasPrefix(path, "/") || strings.Contains(path, "://") {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.fetch: path must start with / and must not contain a scheme")))
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
					var parsed map[string]string
					if unmarshalErr := json.Unmarshal([]byte(headersJSON), &parsed); unmarshalErr == nil {
						headers = parsed
					}
				}
			}
		}

		go func() {
			targetURL := fmt.Sprintf("http://127.0.0.1:%s%s", util.ServerPort, path)

			r := req.C().R().
				SetHeader(model.XAuthTokenKey, p.Token)

			// Apply user headers (Authorization will be overwritten above)
			for k, v := range headers {
				r.SetHeader(k, v)
			}

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

			respHeadersJsonBytes, err := json.Marshal(respHeaders)
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}

			response := ctx.NewObject()
			response.SetPropertyStr("url", ctx.NewString(targetURL))
			response.SetPropertyStr("ok", ctx.NewBool(resp.StatusCode >= 200 && resp.StatusCode < 300))
			response.SetPropertyStr("status", ctx.NewInt32(int32(resp.StatusCode)))
			response.SetPropertyStr("statusText", ctx.NewString(resp.Status))
			response.SetPropertyStr("headers", ctx.ParseJSON(string(respHeadersJsonBytes)))
			response.SetPropertyStr("body", ctx.NewBytes(respBody))

			response.SetPropertyStr("text", ctx.Function(func(this *qjs.This) (value *qjs.Value, error error) {
				go this.Promise().Resolve(ctx.NewString(string(respBody)))
				return
			}, true))
			response.SetPropertyStr("json", ctx.Function(func(this *qjs.This) (value *qjs.Value, error error) {
				go this.Promise().Resolve(ctx.ParseJSON(string(respBody)))
				return
			}, true))
			response.SetPropertyStr("bytes", ctx.Function(func(this *qjs.This) (value *qjs.Value, error error) {
				go this.Promise().Resolve(ctx.NewBytes(respBody))
				return
			}, true))
			response.SetPropertyStr("arrayBuffer", ctx.Function(func(this *qjs.This) (value *qjs.Value, error error) {
				go this.Promise().Resolve(ctx.NewArrayBuffer(respBody))
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
		args := this.Args()
		if len(args) < 1 {
			panic("socket: path required")
		}

		path := args[0].String()
		protocols := (func() string {
			if len(args) > 1 {
				return args[1].String()
			}
			return ""
		})()

		if !strings.HasPrefix(path, "/") || strings.Contains(path, "://") {
			panic("socket: path must start with / and must not contain a scheme")
		}

		wsURL := fmt.Sprintf("ws://127.0.0.1:%s%s", util.ServerPort, path)

		wsHeader := http.Header{}
		wsHeader.Set(model.XAuthTokenKey, p.Token)
		if (protocols) != "" {
			wsHeader.Set("Sec-Websocket-Protocol", protocols)
		}

		// Create a JS object representing the WebSocket
		wsObj := ctx.NewObject()
		wsObj.SetPropertyStr("readyState", ctx.NewInt32(0))
		wsObj.SetPropertyStr("onopen", ctx.NewNull())
		wsObj.SetPropertyStr("onmessage", ctx.NewNull())
		wsObj.SetPropertyStr("onclose", ctx.NewNull())
		wsObj.SetPropertyStr("onerror", ctx.NewNull())

		// Internal tracking
		sendQueue := []string{}

		// Store connection reference (accessed via closure)
		var conn *websocket.Conn
		var mu sync.Mutex

		// send method - implemented as a Go function that JS can call
		wsObj.SetPropertyStr("send", ctx.Function(func(sendThis *qjs.This) (*qjs.Value, error) {
			sendArgs := sendThis.Args()
			if len(sendArgs) < 1 {
				return ctx.NewUndefined(), nil
			}

			data := sendArgs[0].String()
			stateVal := wsObj.GetPropertyStr("readyState")
			state := int32(0)
			if stateVal != nil && !stateVal.IsUndefined() {
				state = stateVal.Int32()
			}

			mu.Lock()
			defer mu.Unlock()

			if state == 1 && conn != nil { // OPEN
				conn.WriteMessage(websocket.TextMessage, []byte(data))
			} else if state == 0 { // CONNECTING - queue for later
				sendQueue = append(sendQueue, data)
			}
			return ctx.NewUndefined(), nil
		}))

		// close method
		wsObj.SetPropertyStr("close", ctx.Function(func(closeThis *qjs.This) (*qjs.Value, error) {
			mu.Lock()
			defer mu.Unlock()
			if conn != nil {
				conn.Close()
			}
			wsObj.SetPropertyStr("readyState", ctx.NewInt32(3)) // CLOSED
			return ctx.NewUndefined(), nil
		}))

		// Start WebSocket connection in a goroutine
		go func() {
			dialer := websocket.Dialer{}
			c, _, err := dialer.Dial(wsURL, wsHeader)
			if err != nil {
				logging.LogErrorf("[plugin:%s] socket connect failed: %s", p.Name, err)
				return
			}

			mu.Lock()
			conn = c
			mu.Unlock()

			p.TrackSocket(c)
			wsObj.SetPropertyStr("readyState", ctx.NewInt32(1)) // OPEN

			// Flush send queue
			mu.Lock()
			for _, msg := range sendQueue {
				c.WriteMessage(websocket.TextMessage, []byte(msg))
			}
			sendQueue = nil
			mu.Unlock()

			defer func() {
				c.Close()
				p.UntrackSocket(c)
				wsObj.SetPropertyStr("readyState", ctx.NewInt32(3)) // CLOSED
			}()

			// Read loop - consumes messages but doesn't dispatch to JS yet
			// (requires QJS event loop integration for safe callback invocation)
			for {
				_, _, readErr := c.ReadMessage()
				if readErr != nil {
					return
				}
			}
		}()

		return wsObj, nil
	}, false))
	return nil
}

// injectRPC adds siyuan.rpc.register method for RPC method registration.
func injectRPC(ctx *qjs.Context, p *KernelPlugin, siyuan *qjs.Value) error {
	rpc := ctx.NewObject()

	rpc.SetPropertyStr("register", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		args := this.Args()
		if len(args) < 2 {
			err = fmt.Errorf("siyuan.rpc.register: name and function required")
			return
		}

		name := args[0].String()
		fn := args[1]

		if !fn.IsFunction() {
			err = fmt.Errorf("siyuan.rpc.register: second argument must be a function")
			return
		}

		if err = p.RegisterRPCMethod(name, fn); err != nil {
			return
		}

		return
	}, false))

	siyuan.SetPropertyStr("rpc", rpc)
	return nil
}
