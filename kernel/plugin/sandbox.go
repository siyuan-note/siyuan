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
	"sync/atomic"

	"github.com/dop251/goja"
	"github.com/gorilla/websocket"
	"github.com/imroc/req/v3"
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

// injectGlobalContext injects all siyuan.* APIs into the plugin's QJS global context.
func injectGlobalContext(p *KernelPlugin, ctx *qjs.Context) error {
	// Create the `siyuan` global object as an empty object
	siyuan := ctx.NewObject()

	injectPlugin(p, ctx, siyuan)
	injectEvent(p, ctx, siyuan)
	injectLogger(p, ctx, siyuan)
	injectStorage(p, ctx, siyuan)
	injectFetch(p, ctx, siyuan)
	injectSocket(p, ctx, siyuan)
	injectRpc(p, ctx, siyuan)

	if err := ObjectFreeze(ctx, siyuan); err != nil {
		return fmt.Errorf("failed to freeze siyuan object: %w", err)
	}

	ctx.Global().SetPropertyStr("siyuan", siyuan)

	return nil
}

// injectPlugin adds siyuan.plugin to the QJS context.
func injectPlugin(p *KernelPlugin, ctx *qjs.Context, siyuan *qjs.Value) error {
	i18n, err := goValueToJsValue(ctx, p.I18n)
	if err != nil {
		i18n = ctx.NewNull()
	}

	plugin := ctx.NewObject()

	plugin.SetPropertyStr("name", ctx.NewString(p.Name))
	plugin.SetPropertyStr("displayName", ctx.NewString(p.DisplayName))
	plugin.SetPropertyStr("platform", ctx.NewString(bazaar.GetCurrentBackend()))
	plugin.SetPropertyStr("i18n", i18n)

	if err := ObjectFreeze(ctx, plugin); err != nil {
		return fmt.Errorf("failed to freeze siyuan.plugin object: %w", err)
	}

	siyuan.SetPropertyStr("plugin", plugin)

	return nil
}

// injectLogger adds siyuan.logger to the QJS context.
func injectLogger(p *KernelPlugin, ctx *qjs.Context, siyuan *qjs.Value) error {

	logger := ctx.NewObject()

	logger.SetPropertyStr("trace", ctx.Function(loggerWrapper(p, ctx, logging.LogTracef), true))
	logger.SetPropertyStr("debug", ctx.Function(loggerWrapper(p, ctx, logging.LogDebugf), true))
	logger.SetPropertyStr("info", ctx.Function(loggerWrapper(p, ctx, logging.LogInfof), true))
	logger.SetPropertyStr("warn", ctx.Function(loggerWrapper(p, ctx, logging.LogWarnf), true))
	logger.SetPropertyStr("error", ctx.Function(loggerWrapper(p, ctx, logging.LogErrorf), true))

	if err := ObjectFreeze(ctx, logger); err != nil {
		return fmt.Errorf("failed to freeze siyuan.logger object: %w", err)
	}

	siyuan.SetPropertyStr("logger", logger)

	return nil
}

// injectEvent adds siyuan.event to the QJS context.
func injectEvent(p *KernelPlugin, ctx *qjs.Context, siyuan *qjs.Value) error {
	event := ctx.NewObject()

	event.SetPropertyStr("on", ctx.NewNull())
	event.SetPropertyStr("emit", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		// lifecycle:<id> 生命周期响应
		// rpc:<id> RPC 调用响应
		runErr := p.worker.Run(func() (result any, err any) {
			args := this.Args()
			if len(args) < 2 {
				err = fmt.Errorf("topic and event required")
				return
			}

			topicJs := args[0]
			if topicJs == nil || !topicJs.IsString() {
				err = fmt.Errorf("topic required")
				return
			}
			topic := topicJs.String()

			eventJs := args[1]
			if eventJs == nil || !eventJs.IsObject() {
				err = fmt.Errorf("event required")
				return
			}

			eventJson, stringifyErr := eventJs.JSONStringify()
			if stringifyErr != nil {
				err = stringifyErr
				return
			}

			p.bus.Publish(topic, eventJson)
			return
		}, func(result any, err any) {
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.event.emit: %w", err.(error))))
			} else {
				if result != nil {
					this.Promise().Resolve(result.(*qjs.Value))
				} else {
					this.Promise().Resolve()
				}
			}
		}, p.context)
		if runErr != nil {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.event.emit: %w", runErr)))
		}
		return
	}, true))

	if err := ObjectSeal(ctx, event); err != nil {
		return fmt.Errorf("failed to seal siyuan.plugin.event object: %w", err)
	}

	siyuan.SetPropertyStr("event", event)

	return nil
}

// injectStorage adds siyuan.storage.* methods for scoped file CRUD.
func injectStorage(p *KernelPlugin, ctx *qjs.Context, siyuan *qjs.Value) error {
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

	// siyuan.storage.get(path) -> Promise<Uint8Array>
	storage.SetPropertyStr("get", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		runErr := p.worker.Run(func() (result any, err any) {
			args := this.Args()
			if len(args) < 1 {
				err = fmt.Errorf("path required")
				return
			}

			abs, resolveErr := resolvePath(args[0].String())
			if resolveErr != nil {
				err = resolveErr
				return
			}

			data, readErr := filelock.ReadFile(abs)
			if readErr != nil {
				err = fmt.Errorf("failed to read file: %w", readErr)
				return
			}

			content := ctx.NewObject()
			ObjectSetDataMethods(p, ctx, content, data)

			result = content
			return
		}, func(result any, err any) {
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.get: %w", err.(error))))
			} else {
				if result != nil {
					this.Promise().Resolve(result.(*qjs.Value))
				} else {
					this.Promise().Resolve()
				}
			}
		}, p.context)
		if runErr != nil {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.get: %w", runErr)))
		}
		return
	}, true))

	// siyuan.storage.put(path, content) -> Promise<void>
	storage.SetPropertyStr("put", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		runErr := p.worker.Run(func() (result any, err any) {
			args := this.Args()
			if len(args) < 2 {
				err = fmt.Errorf("path and content required")
				return
			}

			abs, resolveErr := resolvePath(args[0].String())
			if resolveErr != nil {
				err = resolveErr
				return
			}

			dir := filepath.Dir(abs)
			if mkdirErr := os.MkdirAll(dir, 0755); mkdirErr != nil {
				err = fmt.Errorf("failed to make directory: %w", mkdirErr)
				return
			}

			if writeErr := filelock.WriteFile(abs, []byte(args[1].String())); writeErr != nil {
				err = fmt.Errorf("failed to write file: %w", writeErr)
				return
			}

			return
		}, func(result any, err any) {
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.put: %w", err.(error))))
			} else {
				if result != nil {
					this.Promise().Resolve(result.(*qjs.Value))
				} else {
					this.Promise().Resolve()
				}
			}
		}, p.context)
		if runErr != nil {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.put: %w", runErr)))
		}
		return
	}, true))

	// siyuan.storage.remove(path) -> Promise<void>
	storage.SetPropertyStr("remove", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		runErr := p.worker.Run(func() (result any, err any) {
			args := this.Args()
			if len(args) < 1 {
				err = fmt.Errorf("path required")
				return
			}

			abs, resolveErr := resolvePath(args[0].String())
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
		}, func(result any, err any) {
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.remove: %w", err.(error))))
			} else {
				if result != nil {
					this.Promise().Resolve(result.(*qjs.Value))
				} else {
					this.Promise().Resolve()
				}
			}
		}, p.context)
		if runErr != nil {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.remove: %w", runErr)))
		}
		return
	}, true))

	// siyuan.storage.list(path) -> Promise<Entry[]>
	storage.SetPropertyStr("list", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		runErr := p.worker.Run(func() (result any, err any) {
			args := this.Args()
			if len(args) < 1 {
				err = fmt.Errorf("path required")
				return
			}

			abs, resolveErr := resolvePath(args[0].String())
			if resolveErr != nil {
				err = resolveErr
				return
			}

			entries, readErr := os.ReadDir(abs)
			if readErr != nil {
				err = fmt.Errorf("failed to read directory: %w", readErr)
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

			result, err = goValueToJsValue(ctx, results)
			return
		}, func(result any, err any) {
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.list: %w", err.(error))))
			} else {
				if result != nil {
					this.Promise().Resolve(result.(*qjs.Value))
				} else {
					this.Promise().Resolve()
				}
			}
		}, p.context)
		if runErr != nil {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.storage.list: %w", runErr)))
		}
		return
	}, true))

	if err := ObjectFreeze(ctx, storage); err != nil {
		return fmt.Errorf("failed to freeze siyuan.storage object: %w", err)
	}

	siyuan.SetPropertyStr("storage", storage)
	return nil
}

// injectFetch adds siyuan.fetch method that tunnels HTTP requests to the kernel's REST API.
func injectFetch(p *KernelPlugin, ctx *qjs.Context, siyuan *qjs.Value) error {
	siyuan.SetPropertyStr("fetch", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		runErr := p.worker.Run(func() (result any, err any) {
			args := this.Args()
			if len(args) < 1 {
				err = fmt.Errorf("path required")
				return
			}

			path := args[0].String()

			// Path validation: must start with /
			if !strings.HasPrefix(path, "/") {
				err = fmt.Errorf("path must start with /")
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

			resp, sendErr := r.Send(method, targetURL)
			if sendErr != nil {
				err = fmt.Errorf("failed to send request: %w", sendErr)
				return
			}
			defer resp.Body.Close()

			respBody, readErr := io.ReadAll(resp.Body)
			if readErr != nil {
				err = fmt.Errorf("failed to read response body: %w", readErr)
				return
			}

			// Build Response-like object
			respHeaders := map[string]string{}
			for k, vs := range resp.Header {
				respHeaders[k] = strings.Join(vs, ", ")
			}

			respHeadersJs, convertErr := goValueToJsValue(ctx, respHeaders)
			if convertErr != nil {
				err = fmt.Errorf("failed to convert response headers: %w", convertErr)
				return
			}

			response := ctx.NewObject()
			response.SetPropertyStr("url", ctx.NewString(path))
			response.SetPropertyStr("ok", ctx.NewBool(resp.StatusCode >= 200 && resp.StatusCode < 300))
			response.SetPropertyStr("status", qjs.GoNumberToJs(ctx, resp.StatusCode))
			response.SetPropertyStr("statusText", ctx.NewString(resp.Status))
			response.SetPropertyStr("headers", respHeadersJs)

			ObjectSetDataMethods(p, ctx, response, respBody)
			result = response
			return
		}, func(result any, err any) {
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.fetch: %w", err.(error))))
			} else {
				if result != nil {
					this.Promise().Resolve(result.(*qjs.Value))
				} else {
					this.Promise().Resolve()
				}
			}
		}, p.context)
		if runErr != nil {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.fetch: %w", runErr)))
		}
		return
	}, true))
	return nil
}

// injectSocket adds siyuan.socket method with browser-compatible WebSocket API.
func injectSocket(p *KernelPlugin, ctx *qjs.Context, siyuan *qjs.Value) error {
	siyuan.SetPropertyStr("socket", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		runErr := p.worker.Run(func() (result any, err any) {
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
			var conn atomic.Pointer[websocket.Conn]
			var readyState atomic.Int64 // WebSocketState

			var sendQueueMu sync.RWMutex // guards readyState
			var sendQueue []any          // send calls may happen before connection is established, so we queue them

			var wsWriteMu sync.Mutex // serializes all conn.WriteMessage calls

			// Create a JS object representing the WebSocket
			wsObj := ctx.NewObject()

			writeMessage := func(c *websocket.Conn, messageType int, data []byte) error {
				wsWriteMu.Lock()
				defer wsWriteMu.Unlock()

				return c.WriteMessage(messageType, data)
			}

			setReadyState := func(state WebSocketState) {
				stateInt64 := int64(state)
				readyState.Store(stateInt64)
				wsObj.SetPropertyStr("readyState", ctx.NewInt64(stateInt64))
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
				runErr := p.worker.Run(func() (result any, err any) {
					sendArgs := sendThis.Args()
					if len(sendArgs) < 1 {
						return
					}
					data := sendArgs[0]

					state := WebSocketState(readyState.Load())

					if state == WebSocketReadyStateOpen { // OPEN
						c := conn.Load()
						if c != nil {
							if data.IsString() {
								err = writeMessage(c, websocket.TextMessage, []byte(data.String()))
							} else if data.IsByteArray() {
								err = writeMessage(c, websocket.BinaryMessage, data.Bytes())
							}
						}
						return
					}

					if state == WebSocketReadyStateConnecting { // CONNECTING - queue for later
						sendQueueMu.Lock()
						if data.IsString() {
							sendQueue = append(sendQueue, data.String())
						} else if data.IsByteArray() {
							sendQueue = append(sendQueue, data.Bytes())
						}
						sendQueueMu.Unlock()
						return
					}
					return
				}, func(result any, err any) {
					if err != nil {
						this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.socket.send: %w", err.(error))))
					} else {
						if result != nil {
							this.Promise().Resolve(result.(*qjs.Value))
						} else {
							this.Promise().Resolve()
						}
					}
				}, p.context)
				if runErr != nil {
					this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.socket.send: %w", runErr)))
				}
				return
			}, true))

			// ping method
			wsObj.SetPropertyStr("ping", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
				runErr := p.worker.Run(func() (result any, err any) {
					var data string
					args := this.Args()
					if len(args) > 0 && args[0].IsString() {
						data = args[0].String()
					}

					c := conn.Load()
					if c != nil {
						writeMessage(c, websocket.PingMessage, []byte(data))
					}
					return
				}, func(result any, err any) {
					if err != nil {
						this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.socket.ping: %w", err.(error))))
					} else {
						if result != nil {
							this.Promise().Resolve(result.(*qjs.Value))
						} else {
							this.Promise().Resolve()
						}
					}
				}, p.context)
				if runErr != nil {
					this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.socket.ping: %w", runErr)))
				}
				return
			}, true))

			// pong method
			wsObj.SetPropertyStr("pong", ctx.Function(func(pongThis *qjs.This) (result *qjs.Value, err error) {
				runErr := p.worker.Run(func() (result any, err any) {
					var data string
					args := pongThis.Args()
					if len(args) > 0 && args[0].IsString() {
						data = args[0].String()
					}

					c := conn.Load()
					if c != nil {
						writeMessage(c, websocket.PongMessage, []byte(data))
					}
					return
				}, func(result any, err any) {
					if err != nil {
						this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.socket.pong: %w", err.(error))))
					} else {
						if result != nil {
							this.Promise().Resolve(result.(*qjs.Value))
						} else {
							this.Promise().Resolve()
						}
					}
				}, p.context)
				if runErr != nil {
					this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.socket.pong: %w", runErr)))
				}
				return
			}, true))

			// close method
			wsObj.SetPropertyStr("close", ctx.Function(func(closeThis *qjs.This) (result *qjs.Value, err error) {
				runErr := p.worker.Run(func() (result any, err any) {
					code := websocket.CloseNormalClosure
					var reason string

					args := closeThis.Args()
					if len(args) > 0 && args[0].IsNumber() {
						code = int(args[0].Int64())
					}
					if len(args) > 1 && args[1].IsString() {
						reason = args[1].String()
					}

					c := conn.Load()
					if c != nil {
						writeMessage(c, websocket.CloseMessage, websocket.FormatCloseMessage(code, reason))
					}
					return
				}, func(result any, err any) {
					if err != nil {
						this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.socket.close: %w", err.(error))))
					} else {
						if result != nil {
							this.Promise().Resolve(result.(*qjs.Value))
						} else {
							this.Promise().Resolve()
						}
					}
				}, p.context)
				if runErr != nil {
					this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.socket.close: %w", runErr)))
				}
				return
			}, true))

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
					p.worker.RunSync(func() (any, any) {
						event := ctx.NewObject()
						event.SetPropertyStr("type", ctx.NewString("error"))
						event.SetPropertyStr("error", ctx.NewError(err))
						invokeWsHook("onerror", event)
						return nil, nil
					}, p.context)
					return
				}

				defer func() {
					p.UntrackSocket(c)
					c.Close()
				}()
				p.TrackSocket(c, false)

				c.SetPingHandler(func(data string) (err error) {
					_, runError := p.worker.RunSync(func() (any, any) {
						event := ctx.NewObject()
						event.SetPropertyStr("type", ctx.NewString("ping"))
						event.SetPropertyStr("data", ctx.NewString(data))
						invokeWsHook("onping", event)
						return nil, nil
					}, p.context)
					if runError != nil {
						return runError.(error)
					}
					return nil
				})
				c.SetPongHandler(func(data string) (err error) {
					_, runError := p.worker.RunSync(func() (any, any) {
						event := ctx.NewObject()
						event.SetPropertyStr("type", ctx.NewString("pong"))
						event.SetPropertyStr("data", ctx.NewString(data))
						invokeWsHook("onpong", event)
						return nil, nil
					}, p.context)
					if runError != nil {
						return runError.(error)
					}
					return nil
				})
				c.SetCloseHandler(func(code int, reason string) (err error) {
					_, runError := p.worker.RunSync(func() (any, any) {
						setReadyState(WebSocketReadyStateClosing)

						event := ctx.NewObject()
						event.SetPropertyStr("type", ctx.NewString("close"))
						event.SetPropertyStr("code", ctx.NewInt64(int64(code)))
						event.SetPropertyStr("reason", ctx.NewString(reason))
						invokeWsHook("onclose", event)
						return nil, nil
					}, p.context)
					if runError != nil {
						return runError.(error)
					}
					return nil
				})

				// Flush send queue
				sendQueueMu.Lock()
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

				conn.Store(c)

				p.worker.RunSync(func() (any, any) {
					setReadyState(WebSocketReadyStateOpen)
					event := ctx.NewObject()
					event.SetPropertyStr("type", ctx.NewString("open"))
					invokeWsHook("onopen", event)
					return nil, nil
				}, p.context)

				// Read loop - consumes messages but doesn't dispatch to JS yet
				// (requires QJS event loop integration for safe callback invocation)
				for {
					messageType, data, readErr := c.ReadMessage()
					if readErr != nil {
						if websocket.IsUnexpectedCloseError(readErr, websocket.CloseNormalClosure) {
							p.worker.RunSync(func() (any, any) {
								event := ctx.NewObject()
								event.SetPropertyStr("type", ctx.NewString("error"))
								event.SetPropertyStr("error", ctx.NewError(readErr))
								invokeWsHook("onerror", event)
								return nil, nil
							}, p.context)
						}
						break
					}
					switch messageType {
					case websocket.TextMessage:
						p.worker.RunSync(func() (any, any) {
							event := ctx.NewObject()
							event.SetPropertyStr("type", ctx.NewString("message"))
							event.SetPropertyStr("data", ctx.NewString(string(data)))
							invokeWsHook("onmessage", event)
							return nil, nil
						}, p.context)
					case websocket.BinaryMessage:
						p.worker.RunSync(func() (any, any) {
							event := ctx.NewObject()
							event.SetPropertyStr("type", ctx.NewString("message"))
							event.SetPropertyStr("data", ctx.NewArrayBuffer(data))
							invokeWsHook("onmessage", event)
							return nil, nil
						}, p.context)
					}
				}
			}()

			result = wsObj
			return
		}, func(result any, err any) {
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.socket: %w", err.(error))))
			} else {
				if result != nil {
					this.Promise().Resolve(result.(*qjs.Value))
				} else {
					this.Promise().Resolve()
				}
			}
		}, p.context)
		if runErr != nil {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.socket: %w", runErr)))
		}
		return
	}, true))
	return nil
}

// injectRpc adds siyuan.rpc method for RPC method registration.
func injectRpc(p *KernelPlugin, ctx *qjs.Context, siyuan *qjs.Value) error {
	rpc := ctx.NewObject()

	rpc.SetPropertyStr("subscribe", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				logging.LogErrorf("qjs panic during siyuan.rpc.bind: %v", r)
			}
		}()
		runErr := p.worker.Run(func() (result any, err any) {
			args := this.Args()
			if len(args) < 2 {
				err = fmt.Errorf("name and function required")
				return
			}

			name := args[0].String()

			descriptionArgs := args[1:]
			descriptions := make([]string, len(descriptionArgs))
			for i, arg := range descriptionArgs {
				descriptions[i] = arg.String()
			}

			if bindErr := p.subscribeRpcMethod(name, descriptions...); bindErr != nil {
				err = bindErr
				return
			}

			return
		}, func(result any, err any) {
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.rpc.bind: %w", err.(error))))
			} else {
				if result != nil {
					this.Promise().Resolve(result.(*qjs.Value))
				} else {
					this.Promise().Resolve()
				}
			}
		}, p.context)
		if runErr != nil {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.rpc.bind: %w", runErr)))
		}
		return
	}, true))

	rpc.SetPropertyStr("unsubscribe", ctx.Function(func(this *qjs.This) (value *qjs.Value, err error) {
		runErr := p.worker.Run(func() (result any, err any) {
			args := this.Args()
			if len(args) < 1 {
				err = fmt.Errorf("method name is required")
				return
			}

			name := args[0].String()
			if unbindErr := p.unsubscribeRpcMethod(name); unbindErr != nil {
				err = unbindErr
				return
			}

			return
		}, func(result any, err any) {
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.rpc.unbind: %w", err.(error))))
			} else {
				if result != nil {
					this.Promise().Resolve(result.(*qjs.Value))
				} else {
					this.Promise().Resolve()
				}
			}
		}, p.context)
		if runErr != nil {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.rpc.unbind: %w", runErr)))
		}
		return
	}, true))

	rpc.SetPropertyStr("broadcast", ctx.Function(func(this *qjs.This) (result *qjs.Value, err error) {
		runErr := p.worker.Run(func() (result any, err any) {
			args := this.Args()
			if len(args) < 1 {
				err = fmt.Errorf("method required")
				return
			}

			method := args[0].String()

			var params any
			if len(args) > 1 && !args[1].IsNull() && !args[1].IsUndefined() {
				paramsJSON, jsonErr := args[1].JSONStringify()
				if jsonErr != nil {
					err = fmt.Errorf("serialize params: %w", jsonErr)
					return
				}
				if jsonErr = json.Unmarshal([]byte(paramsJSON), &params); jsonErr != nil {
					err = fmt.Errorf("parse params: %w", jsonErr)
					return
				}
			}

			p.BroadcastNotification(method, params)
			return
		}, func(result any, err any) {
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.rpc.broadcast: %w", err.(error))))
			} else {
				if result != nil {
					this.Promise().Resolve(result.(*qjs.Value))
				} else {
					this.Promise().Resolve()
				}
			}
		}, p.context)
		if runErr != nil {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("siyuan.rpc.broadcast: %w", runErr)))
		}
		return
	}, true))

	if err := ObjectFreeze(ctx, rpc); err != nil {
		return fmt.Errorf("failed to freeze siyuan.rpc object: %w", err)
	}

	siyuan.SetPropertyStr("rpc", rpc)
	return nil
}

// ObjectFreeze is a no-op stub; the real implementation will be added in Task 6.
func ObjectFreeze(_ *goja.Runtime, _ *goja.Object) error { return nil }

// ObjectSeal is a no-op stub; the real implementation will be added in Task 6.
func ObjectSeal(_ *goja.Runtime, _ *goja.Object) error { return nil }

// goValueToJsValue converts a Go value to a goja.Value by JSON serialization round-trip, returning an error if serialization fails.
func goValueToJsValue(rt *goja.Runtime, value any) (goja.Value, error) {
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
func getJsContextValue(rt *goja.Runtime, paths []any) (goja.Value, error) {
	var cur goja.Value = rt.GlobalObject()
	for _, path := range paths {
		obj, ok := cur.(*goja.Object)
		if !ok {
			return nil, fmt.Errorf("path %v: expected object, got %T", path, cur)
		}
		switch k := path.(type) {
		case string:
			cur = obj.Get(k)
		case int64:
			cur = obj.Get(fmt.Sprintf("%d", k))
		default:
			return nil, fmt.Errorf("unsupported path type: %T", path)
		}
		if cur == nil || goja.IsNull(cur) || goja.IsUndefined(cur) {
			return nil, nil
		}
	}
	return cur, nil
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

	eventJs, parseErr := goValueToJsValue(rt, e)
	if parseErr != nil {
		err = parseErr
		return
	}

	invokeResult, invokeErr := fn(event, eventJs)
	if invokeErr != nil {
		err = invokeErr
		return
	}

	// Strict true-only: do NOT use ToBoolean() — any truthy object (e.g. a Promise) would deadlock invokeHook.
	await = invokeResult != nil && invokeResult.Export() == true
	return
}
