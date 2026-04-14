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
	"time"

	"github.com/fastschema/qjs"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// injectSandboxGlobals injects all siyuan.* APIs into the plugin's QJS context.
func injectSandboxGlobals(p *KernelPlugin) error {
	ctx := p.runtime.Context()

	// Create the `siyuan` global object as an empty object
	siyuanObj := ctx.NewObject()
	if siyuanObj == nil {
		return fmt.Errorf("failed to create siyuan object")
	}
	ctx.Global().SetPropertyStr("siyuan", siyuanObj)

	if err := injectLog(ctx, p); err != nil {
		return err
	}
	if err := injectStorage(ctx, p, siyuanObj); err != nil {
		return err
	}
	if err := injectFetch(ctx, p, siyuanObj); err != nil {
		return err
	}
	if err := injectSocket(ctx, p, siyuanObj); err != nil {
		return err
	}
	if err := injectRPCRegister(ctx, p, siyuanObj); err != nil {
		return err
	}

	return nil
}

// injectLog adds siyuan.log(level, ...args) to the QJS context.
func injectLog(ctx *qjs.Context, p *KernelPlugin) error {
	// SetFunc signature: func(this *This) (*Value, error)
	// Get arguments via this.Args()
	ctx.SetFunc("__siyuan_log", func(this *qjs.This) (*qjs.Value, error) {
		args := this.Args()
		if len(args) < 1 {
			return ctx.NewNull(), nil
		}

		level := args[0].String()
		parts := make([]string, 0, len(args)-1)
		for _, arg := range args[1:] {
			parts = append(parts, arg.String())
		}
		msg := strings.Join(parts, " ")
		prefix := fmt.Sprintf("[plugin:%s]", p.Name)

		switch level {
		case "info":
			logging.LogInfof("%s %s", prefix, msg)
		case "warn":
			logging.LogWarnf("%s %s", prefix, msg)
		case "error":
			logging.LogErrorf("%s %s", prefix, msg)
		default:
			logging.LogInfof("%s %s", prefix, msg)
		}

		return ctx.NewNull(), nil
	})

	// Wire up siyuan.log in JS - calls the Go binding
	_, err := ctx.Eval(`
		siyuan.log = function(level, ...args) {
			__siyuan_log(level, ...args);
		};
	`)
	return err
}

// injectStorage adds siyuan.storage.* methods for scoped file CRUD.
func injectStorage(ctx *qjs.Context, p *KernelPlugin, siyuanObj *qjs.Value) error {
	baseDir := filepath.Join(util.DataDir, "storage", "petal", p.Name)

	// Resolve and validate a relative path against the plugin's storage base directory.
	resolvePath := func(relPath string) (string, error) {
		if strings.Contains(relPath, "..") {
			return "", fmt.Errorf("path traversal not allowed")
		}
		abs := filepath.Join(baseDir, filepath.Clean(relPath))
		// Ensure the resolved path is still within baseDir
		if !strings.HasPrefix(abs, baseDir) {
			return "", fmt.Errorf("path traversal not allowed")
		}
		return abs, nil
	}

	// storage.get(path) -> Promise<string>
	ctx.SetAsyncFunc("__siyuan_storage_get", func(this *qjs.This) {
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.get: path required")))
			return
		}
		go func() {
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}
			data, err := filelock.ReadFile(abs)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.get: %w", err)))
				return
			}
			this.Promise().Resolve(ctx.NewString(string(data)))
		}()
	})

	// storage.put(path, content) -> Promise<void>
	ctx.SetAsyncFunc("__siyuan_storage_put", func(this *qjs.This) {
		args := this.Args()
		if len(args) < 2 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.put: path and content required")))
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
				this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.put: mkdir: %w", err)))
				return
			}
			if err = filelock.WriteFile(abs, []byte(args[1].String())); err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.put: %w", err)))
				return
			}
			this.Promise().Resolve(ctx.NewUndefined())
		}()
	})

	// storage.remove(path) -> Promise<void>
	ctx.SetAsyncFunc("__siyuan_storage_remove", func(this *qjs.This) {
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.remove: path required")))
			return
		}
		go func() {
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}
			if err = os.RemoveAll(abs); err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.remove: %w", err)))
				return
			}
			this.Promise().Resolve(ctx.NewUndefined())
		}()
	})

	// storage.list(path) -> Promise<Entry[]>
	ctx.SetAsyncFunc("__siyuan_storage_list", func(this *qjs.This) {
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.list: path required")))
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
				this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.list: %w", err)))
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
					"isSymlink": entry.Type()&os.ModeSymlink != 0,
					"updated":   info.ModTime().Unix(),
				})
			}
			jsonBytes, _ := json.Marshal(result)
			jsVal := ctx.ParseJSON(string(jsonBytes))
			this.Promise().Resolve(jsVal)
		}()
	})

	// Wire up siyuan.storage.* methods in JS
	_, err := ctx.Eval(`
		siyuan.storage = {
			get: function(path) { return __siyuan_storage_get(path); },
			put: function(path, content) { return __siyuan_storage_put(path, content); },
			remove: function(path) { return __siyuan_storage_remove(path); },
			list: function(path) { return __siyuan_storage_list(path); }
		};
	`)
	return err
}

// injectFetch adds siyuan.fetch method that tunnels HTTP requests to the kernel's REST API.
func injectFetch(ctx *qjs.Context, p *KernelPlugin, siyuanObj *qjs.Value) error {
	ctx.SetAsyncFunc("__siyuan_fetch", func(this *qjs.This) {
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("fetch: path required")))
			return
		}

		path := args[0].String()

		// Path validation: must start with /, no scheme allowed
		if !strings.HasPrefix(path, "/") || strings.Contains(path, "://") {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("fetch: path must start with / and must not contain a scheme")))
			return
		}

		method := "GET"
		var body string
		headers := map[string]string{}

		// Parse init options if provided
		if len(args) > 1 && !args[1].IsNull() && !args[1].IsUndefined() {
			init := args[1]
			if m := init.GetPropertyStr("method"); m != nil && !m.IsUndefined() {
				method = m.String()
			}
			if b := init.GetPropertyStr("body"); b != nil && !b.IsUndefined() {
				body = b.String()
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

			var bodyReader io.Reader
			if body != "" {
				bodyReader = strings.NewReader(body)
			}

			req, err := http.NewRequest(method, targetURL, bodyReader)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("fetch: create request: %w", err)))
				return
			}

			// Inject auth token (via callback, avoids importing model)
			if p.TokenFunc != nil {
				if token := p.TokenFunc(); token != "" {
					req.Header.Set("Authorization", "Token "+token)
				}
			}

			// Apply user headers (Authorization will be overwritten above)
			for k, v := range headers {
				if !strings.EqualFold(k, "Authorization") {
					req.Header.Set(k, v)
				}
			}
			if req.Header.Get("Content-Type") == "" && body != "" {
				req.Header.Set("Content-Type", "application/json")
			}

			client := &http.Client{Timeout: 30 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("fetch: %w", err)))
				return
			}
			defer resp.Body.Close()

			respBody, err := io.ReadAll(resp.Body)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("fetch: read body: %w", err)))
				return
			}

			// Build Response-like object
			respHeaders := map[string]string{}
			for k, vs := range resp.Header {
				respHeaders[k] = strings.Join(vs, ", ")
			}

			result := map[string]interface{}{
				"ok":         resp.StatusCode >= 200 && resp.StatusCode < 300,
				"status":     resp.StatusCode,
				"statusText": resp.Status,
				"_body":      string(respBody),
				"headers":    respHeaders,
			}

			// Convert result to JS object via JSON
			jsonBytes, _ := json.Marshal(result)
			jsResult := ctx.ParseJSON(string(jsonBytes))
			this.Promise().Resolve(jsResult)
		}()
	})

	// Wire up siyuan.fetch in JS with Response-like object
	_, err := ctx.Eval(`
		siyuan.fetch = async function(path, init) {
			const raw = await __siyuan_fetch(path, init || {});
			return {
				ok: raw.ok,
				status: raw.status,
				statusText: raw.statusText,
				headers: raw.headers || {},
				json: async function() { return JSON.parse(raw._body); },
				text: async function() { return raw._body; }
			};
		};
	`)
	return err
}

// injectSocket adds siyuan.socket method with browser-compatible WebSocket API.
func injectSocket(ctx *qjs.Context, p *KernelPlugin, siyuanObj *qjs.Value) error {
	ctx.SetFunc("__siyuan_socket", func(this *qjs.This) (*qjs.Value, error) {
		args := this.Args()
		if len(args) < 1 {
			panic("socket: path required")
		}

		path := args[0].String()
		if !strings.HasPrefix(path, "/") || strings.Contains(path, "://") {
			panic("socket: path must start with / and must not contain a scheme")
		}

		// Append auth token to query string
		sep := "?"
		if strings.Contains(path, "?") {
			sep = "&"
		}
		token := ""
		if p.TokenFunc != nil {
			token = p.TokenFunc()
		}
		wsURL := fmt.Sprintf("ws://127.0.0.1:%s%s%stoken=%s", util.ServerPort, path, sep, token)

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
		sendFn := ctx.Function(func(sendThis *qjs.This) (*qjs.Value, error) {
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
		})
		wsObj.SetPropertyStr("send", sendFn)

		// close method
		closeFn := ctx.Function(func(closeThis *qjs.This) (*qjs.Value, error) {
			mu.Lock()
			defer mu.Unlock()
			if conn != nil {
				conn.Close()
			}
			wsObj.SetPropertyStr("readyState", ctx.NewInt32(3)) // CLOSED
			return ctx.NewUndefined(), nil
		})
		wsObj.SetPropertyStr("close", closeFn)

		// Start WebSocket connection in a goroutine
		go func() {
			dialer := websocket.Dialer{}
			c, _, err := dialer.Dial(wsURL, nil)
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
	})

	_, err := ctx.Eval(`siyuan.socket = function(path, protocols) { return __siyuan_socket(path, protocols); };`)
	return err
}

// injectRPCRegister adds siyuan.rpc.register method. TODO in Task 9.
func injectRPCRegister(ctx *qjs.Context, p *KernelPlugin, siyuanObj *qjs.Value) error {
	// TODO: implement in Task 9
	return nil
}
