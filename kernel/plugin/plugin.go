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
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/asaskevich/EventBus"
	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type PluginState int64

type RpcMethod struct {
	Name         string
	Descriptions []string
	Method       goja.Callable
}

type RpcMethodInfo struct {
	Name         string   `json:"name"`
	Descriptions []string `json:"descriptions"`
}

type R map[string]any

const (
	EventBusTopicPlugin  = "plugin"  // Topic to kernel plugin
	EventBusTopicRuntime = "runtime" // Topic to javascript runtime
)

const (
	PluginStateReady PluginState = iota
	PluginStateLoading
	PluginStateLoaded
	PluginStateRunning
	PluginStateStopping
	PluginStateStopped
	PluginStateError
)

func (s PluginState) String() string {
	switch s {
	case PluginStateReady:
		return "ready"
	case PluginStateLoading:
		return "loading"
	case PluginStateLoaded:
		return "loaded"
	case PluginStateRunning:
		return "running"
	case PluginStateStopping:
		return "stopping"
	case PluginStateStopped:
		return "stopped"
	case PluginStateError:
		return "error"
	default:
		return "unknown"
	}
}

// KernelPlugin represents a single kernel-side plugin instance.
type KernelPlugin struct {
	*model.Petal
	token string // JWT for this plugin
	file  string // kernel.js file path named in js runtime (e.g. "plugin-name/kernel.js")

	worker  Worker               // Worker for serializing plugin js-call-go (e.g. logger) and go-call-js (e.g. RPC calls) tasks on a single goroutine
	runtime *eventloop.EventLoop // goja event loop runtime for this plugin

	state   atomic.Int64    //  PluginState
	context context.Context // Context for managing plugin lifecycle and cancellation

	bus EventBus.Bus // Event bus for plugin events and RPC request/response dispatch

	rpcMethods sync.Map // string -> *RpcMethod, registered JSON-RPC methods

	socketsMu sync.RWMutex                    // separate mutex for sockets map (must not nest inside mu)
	sockets   map[*websocket.Conn]bool        // tracked loopback WebSocket connections (true: server, false: client)
	socketMus map[*websocket.Conn]*sync.Mutex // per-connection write mutex
}

func NewKernelPlugin(petal *model.Petal) *KernelPlugin {
	token, err := model.CreatePluginJWT(petal.Name)
	if err != nil {
		logging.LogErrorf("Failed to create plugin JWT for [%s]: %v", petal.Name, err)
	}

	plugin := &KernelPlugin{
		Petal: petal,
		token: token,
		file:  fmt.Sprintf("%s/kernel.js", petal.Name),

		bus:     EventBus.New(),
		context: context.Background(),

		sockets:   make(map[*websocket.Conn]bool),
		socketMus: make(map[*websocket.Conn]*sync.Mutex),
	}

	plugin.state.Store(int64(PluginStateReady))
	return plugin
}

// State returns the current plugin state (safe for concurrent reads).
func (p *KernelPlugin) State() PluginState {
	return PluginState(p.state.Load())
}

// InitRuntime initializes the goja runtime and evaluates kernel.js.
func (p *KernelPlugin) InitRuntime() (err error) {
	p.runtime = eventloop.NewEventLoop(eventloop.EnableConsole(true))
	p.worker.Start(p.runtime)

	p.runtime.Run(func(rt *goja.Runtime) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("goja panic during event loop run: %v", r)
			}
		}()

		// Use JSON struct tags for field name mapping, with fallback to original names if "json" tag is absent.
		rt.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))

		if enableErr := EnableExtendModules(p, rt); enableErr != nil {
			err = fmt.Errorf("EnableExtendModules: %v", enableErr)
			return
		}

		if enableErr := EnableSiyuanModule(p, rt); enableErr != nil {
			err = fmt.Errorf("EnableSiyuanModule: %v", enableErr)
			return
		}

		if _, runErr := rt.RunScript(p.file, p.Kernel.JS); runErr != nil {
			err = fmt.Errorf("RunScript: %v", runErr)
			return
		}
	})
	p.runtime.Start()
	return
}

// Eval evaluates JavaScript code in the plugin's goja runtime, returning the result or error.
func (p *KernelPlugin) Eval(rt *goja.Runtime, code string) (goja.Value, error) {
	return rt.RunScript(p.file, code)
}

// close interrupts the goja runtime and clears the pointer.
func (p *KernelPlugin) close() (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("goja panic during close runtime: %v", r)
		}
	}()

	if p.runtime != nil {
		p.runtime.Stop() // Stops the event loop and waits for it to finish.
		// p.runtime.Terminate() // Interrupts the runtime and causes all executing code to throw an exception.
	}
	return
}

// error sets the plugin state to errored and frees the goja runtime.
func (p *KernelPlugin) error() {
	if err := p.close(); err != nil {
		logging.LogErrorf("[plugin:%s] failed to close runtime during error handling: %v", p.Name, err)
	}

	p.state.Store(int64(PluginStateError))
}

// start creates the goja runtime, injects sandbox globals, and evaluates kernel.js.
func (p *KernelPlugin) start() (err error) {
	defer func() {
		if r := recover(); r != nil {
			p.error()
			err = fmt.Errorf("goja panic during start: %v", r)
		}
	}()

	p.state.Store(int64(PluginStateLoading))

	baseDir := filepath.Join(util.DataDir, "storage", "petal", p.Name)
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return fmt.Errorf("create plugin dir [%s] failed: %s", baseDir, err)
	}

	if runtimeErr := p.InitRuntime(); runtimeErr != nil {
		p.error()
		return fmt.Errorf("start runtime: %v", runtimeErr)
	}

	if subscribeErr := p.subscribeEventHandlers(); subscribeErr != nil {
		p.error()
		return fmt.Errorf("subscribe plugin events: %v", subscribeErr)
	}

	p.onLoad()
	p.state.Store(int64(PluginStateLoaded))
	p.onLoaded()
	p.state.Store(int64(PluginStateRunning))
	p.onRunning()

	p.bus.Publish(EventBusTopicRuntime, R{
		"id":   uuid.NewString(),
		"type": "start",
	})

	logging.LogDebugf("[plugin:%s] started", p.Name)
	return
}

// stop cleanly shuts down the plugin: closes sockets, frees goja runtime.
func (p *KernelPlugin) stop() (ok bool, err error) {
	defer func() {
		if r := recover(); r != nil {
			p.error()
			ok = false
			err = fmt.Errorf("panic during plugin stop: %v", r)
		}
	}()

	if p.State() != PluginStateRunning {
		ok = false
		return
	}

	p.bus.Publish(EventBusTopicRuntime, R{
		"id":   uuid.NewString(),
		"type": "stop",
	})

	p.state.Store(int64(PluginStateStopping))

	p.onUnload()

	p.rpcMethods.Clear()

	p.socketsMu.Lock()
	for c := range p.sockets {
		c.Close()
		delete(p.sockets, c)
		delete(p.socketMus, c)
	}
	p.socketsMu.Unlock()

	p.unsubscribeEventHandlers()

	p.close()
	p.state.Store(int64(PluginStateStopped))

	logging.LogDebugf("[plugin:%s] stopped", p.Name)

	ok = true
	return
}

// onLoad is called before plugin loaded.
func (p *KernelPlugin) onLoad() {
	if p.State() == PluginStateLoading {
		p.invokeHook("onload")
	}
}

// onLoaded is called after plugin loaded.
func (p *KernelPlugin) onLoaded() {
	if p.State() == PluginStateLoaded {
		p.invokeHook("onloaded")
	}
}

// onRunning is called after plugin running.
func (p *KernelPlugin) onRunning() {
	if p.State() == PluginStateRunning {
		p.invokeHook("onrunning")
	}
}

// onUnload is called before plugin stop.
func (p *KernelPlugin) onUnload() {
	if p.State() == PluginStateStopping {
		p.invokeHook("onunload")
	}
}

// bindRpcMethod add or updates a JS function as a named RPC method.
func (p *KernelPlugin) bindRpcMethod(name string, method goja.Callable, descriptions ...string) error {
	p.rpcMethods.Store(name, &RpcMethod{
		Name:         name,
		Descriptions: descriptions,
		Method:       method,
	})
	return nil
}

// unbindRpcMethod removes a registered RPC method
func (p *KernelPlugin) unbindRpcMethod(name string) error {
	_, ok := p.rpcMethods.LoadAndDelete(name)
	if !ok {
		return nil
	}
	return nil
}

// runtimeEventHandler dispatches an event to the plugin's goja runtime
func (p *KernelPlugin) runtimeEventHandler(event any) {
	p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
		return dispatchEvent(p, rt, event)
	}, nil)
}

// pluginEventHandler handles events sent to the plugin
func (p *KernelPlugin) pluginEventHandler(event any) {
	logging.LogDebugf("[plugin:%s] receive event: %#v", p.Name, event)
}

// subscribeEventHandlers subscribes to plugin lifecycle and RPC events, dispatching them to the plugin's JS runtime.
func (p *KernelPlugin) subscribeEventHandlers() (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = r.(error)
		}
	}()

	lo.Must0(p.bus.Subscribe(EventBusTopicRuntime, p.runtimeEventHandler))
	lo.Must0(p.bus.Subscribe(EventBusTopicPlugin, p.pluginEventHandler))
	return
}

// unsubscribeEventHandlers unsubscribes from plugin events.
func (p *KernelPlugin) unsubscribeEventHandlers() (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = r.(error)
		}
	}()

	lo.Must0(p.bus.Unsubscribe(EventBusTopicRuntime, p.runtimeEventHandler))
	lo.Must0(p.bus.Unsubscribe(EventBusTopicPlugin, p.pluginEventHandler))
	return
}

// GetRpcMethodsInfo returns a list of registered RPC methods with their descriptions.
func (p *KernelPlugin) GetRpcMethodsInfo() (methods []*RpcMethodInfo) {
	p.rpcMethods.Range(func(name any, value any) bool {
		if method, ok := value.(*RpcMethod); ok {
			methods = append(methods, &RpcMethodInfo{
				Name:         method.Name,
				Descriptions: method.Descriptions,
			})
		}
		return true
	})
	return
}

// writeWebSocketMessage serializes a single write to conn using the per-connection mutex.
// Returns nil immediately if conn is no longer tracked (already removed by Stop or UntrackSocket).
// If Stop races and closes the connection after the tracking check, WriteMessage returns an error which is propagated to the caller.
func (p *KernelPlugin) writeWebSocketMessage(conn *websocket.Conn, messageType int, data []byte) (err error) {
	if conn == nil {
		err = fmt.Errorf("WebSocket connection is nil")
		return
	}

	p.socketsMu.RLock()
	mu, ok := p.socketMus[conn]
	p.socketsMu.RUnlock()
	if !ok {
		err = fmt.Errorf("WebSocket connection not tracked")
		return
	}

	// Between RUnlock above and mu.Lock below, Stop() may close the connection.
	// The subsequent WriteMessage will return an error (use of closed connection),
	// which callers log and discard.
	mu.Lock()
	defer mu.Unlock()
	err = conn.WriteMessage(messageType, data)
	return
}

// BroadcastNotification sends a JSON-RPC 2.0 notification to all inbound RPC WebSocket clients.
func (p *KernelPlugin) BroadcastNotification(method string, params util.Optional[any]) {
	notification := JsonRpcRequest{
		JsonRpc: JsonRpcVersion,
		Method:  method,
		Params:  params,
	}
	data, err := json.Marshal(notification)
	if err != nil {
		logging.LogWarnf("[plugin:%s] broadcast marshal: %s", p.Name, err)
		return
	}

	p.socketsMu.RLock()
	conns := make([]*websocket.Conn, 0, len(p.sockets))
	for conn, isRpcConnection := range p.sockets {
		if isRpcConnection {
			conns = append(conns, conn)
		}
	}
	p.socketsMu.RUnlock()

	wg := sync.WaitGroup{}
	for _, conn := range conns {
		wg.Add(1)
		go func(c *websocket.Conn) {
			defer wg.Done()
			if err := p.writeWebSocketMessage(c, websocket.TextMessage, data); err != nil {
				logging.LogWarnf("[plugin:%s] RPC WebSocket notification write failed: %s", p.Name, err)
			}
		}(conn)
	}
	wg.Wait()
}

func (p *KernelPlugin) handleHttpRequest(request *Request, scope AccessScope) (response *HttpResponse, err error) {
	response, err = p.invokeServerHandler(scope, RequestTypeHTTP, request)
	return
}

func (p *KernelPlugin) handleWebSocketRequest(c *gin.Context, request *Request, scope AccessScope) (err error) {
	// TODO: Invoke siyuan.server[scope].ws.handler
	return
}

func (p *KernelPlugin) handleServerSentEventRequest(c *gin.Context, request *Request, scope AccessScope) (err error) {
	// TODO: Invoke siyuan.server[scope].sse.handler
	return
}

// dispatchRpcRequests dispatches multiple JSON-RPC requests concurrently.
// Returns responses in the same order as requests. Nil responses indicate notifications.
func (p *KernelPlugin) dispatchRpcRequests(requests []*JsonRpcProcessingRequest) []*JsonRpcProcessingResponse {
	responses := make([]*JsonRpcProcessingResponse, len(requests))
	var wg sync.WaitGroup

	for i, request := range requests {
		// For requests that failed JSON parsing or validation, return the error immediately without dispatching.
		if request.Error != nil {
			responses[i] = &JsonRpcProcessingResponse{Error: request.Error}
			continue
		}

		// For notifications, dispatch without waiting for a response.
		if request.Request.IsNotification() {
			go func(request *JsonRpcRequest) {
				p.dispatchRpcRequest(request)
			}(request.Request)
			responses[i] = nil
			continue
		}

		if request.Request == nil {
			responses[i] = nil
			continue
		}

		// For normal requests, dispatch concurrently and collect responses.
		wg.Add(1)
		go func(index int, request *JsonRpcRequest) {
			defer wg.Done()
			responses[index] = p.dispatchRpcRequest(request)
		}(i, request.Request)
	}

	wg.Wait()
	return responses
}

// dispatchRpcRequest routes a single JSON-RPC request to the plugin's registered JS method.
// Returns nil for notifications (no ID field).
func (p *KernelPlugin) dispatchRpcRequest(request *JsonRpcRequest) *JsonRpcProcessingResponse {
	// Validate request structure
	if rpcError := request.Validate(); rpcError != nil {
		// For notifications, return nil (no response).
		if request.IsNotification() {
			return nil
		}

		// For invalid requests, return error response.
		return &JsonRpcProcessingResponse{
			Error: &JsonRpcErrorResponse{
				JsonRpc: JsonRpcVersion,
				Error:   rpcError,
				ID:      request.ID,
			},
		}
	}

	// For notifications, call the method without waiting for a response and return nil.
	if request.IsNotification() {
		go p.callRpcMethod(request.Method, request.Params.Value)
		return nil
	}

	// For normal requests, call the method and return response or error.
	rpcResult, rpcError := p.callRpcMethod(request.Method, request.Params.Value)
	if rpcError == nil {
		return &JsonRpcProcessingResponse{
			Response: &JsonRpcRequestResponse{
				JsonRpc: JsonRpcVersion,
				Result:  rpcResult,
				ID:      request.ID,
			},
		}
	} else {
		return &JsonRpcProcessingResponse{
			Error: &JsonRpcErrorResponse{
				JsonRpc: JsonRpcVersion,
				Error:   rpcError,
				ID:      request.ID,
			},
		}
	}
}

// callRpcMethod invokes a registered JS RPC method via the event bus and awaits the response.
func (p *KernelPlugin) callRpcMethod(method string, params any) (rpcResult any, rpcError *JsonRpcError) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogDebugf("[plugin:%s] panic in RPC method [%s]: %v", p.Name, method, r)
			rpcError = &JsonRpcError{
				Code:    JsonRpcErrorCodeInternalError,
				Message: JsonRpcErrorInternalError.Message,
				Data:    fmt.Sprintf("goja panic in RPC method [%s]: %v", method, r),
			}
		}
	}()

	if p.State() != PluginStateRunning {
		rpcError = &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: JsonRpcErrorInternalError.Message,
			Data:    fmt.Sprintf("plugin [%s] not running (state: [%s])", p.Name, p.State()),
		}
		return
	}

	value, ok := p.rpcMethods.Load(method)
	if !ok {
		rpcError = &JsonRpcError{
			Code:    JsonRpcErrorCodeMethodNotFound,
			Message: JsonRpcErrorMethodNotFound.Message,
			Data:    fmt.Sprintf("method [%s] not found in plugin [%s]", method, p.Name),
		}
		return
	}

	rpcMethod, ok := value.(*RpcMethod)
	if !ok {
		rpcError = &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: JsonRpcErrorInternalError.Message,
			Data:    fmt.Sprintf("invalid method type for [%s]", method),
		}
		return
	}

	done := make(chan *TaskResult, 1)

	p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
		rpcParams := []goja.Value{}
		jsParams := rt.ToValue(params)
		if isJsArray(rt, jsParams) {
			// If params is an array, convert to []goja.Value for variadic JS function calls.
			rt.ForOf(jsParams, func(cur goja.Value) bool {
				rpcParams = append(rpcParams, cur)
				return true
			})
		} else if !goja.IsUndefined(jsParams) && !goja.IsNull(jsParams) {
			// If params is not an array but is defined, pass as single argument.
			rpcParams = append(rpcParams, jsParams)
		} else {
			// If params is undefined or null, pass no arguments.
		}

		invokeFunction(func(_ *goja.Runtime, result *CallResult) {
			done <- result.TaskResult()
		}, rt, true, rpcMethod.Method, rt.GlobalObject(), rpcParams...)
		return
	}, nil)

	result := <-done
	if result.err != nil {
		rpcError = &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: JsonRpcErrorInternalError.Message,
			Data:    fmt.Sprintf("error invoking method %q: %v", method, result.err),
		}
		return
	}

	rpcResult = result.value
	return
}

// TrackSocket adds a WebSocket connection to the plugin's tracked list.
func (p *KernelPlugin) TrackSocket(conn *websocket.Conn, isRpcConnection bool) {
	if conn == nil {
		return
	}

	p.socketsMu.Lock()
	defer p.socketsMu.Unlock()
	p.sockets[conn] = isRpcConnection
	p.socketMus[conn] = &sync.Mutex{}
}

// UntrackSocket removes a WebSocket connection from the plugin's tracked list.
func (p *KernelPlugin) UntrackSocket(conn *websocket.Conn) {
	if conn == nil {
		return
	}

	p.socketsMu.Lock()
	defer p.socketsMu.Unlock()
	delete(p.sockets, conn)
	delete(p.socketMus, conn)
}

// invokeHook calls a lifecycle hook (e.g. onload) if it exists, awaiting if it returns a Promise.
func (p *KernelPlugin) invokeHook(name string) {
	var err error
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during lifecycle hook invocation: %v", r)
		}

		if err != nil {
			logging.LogErrorf("[plugin:%s] lifecycle hook [%q] error: %v", p.Name, name, err)
		}
	}()

	done := make(chan TaskResult, 1)

	runErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
		lifecycle, err := getJsContextValue(rt, []any{"siyuan", "plugin", "lifecycle"})
		if err != nil {
			return
		}
		if lifecycle == nil {
			err = fmt.Errorf("globalThis.siyuan.plugin.lifecycle not found")
			return
		}

		pluginObj := lifecycle.ToObject(rt)
		if pluginObj == nil {
			err = fmt.Errorf("globalThis.siyuan.plugin.lifecycle is not an object")
			return
		}

		hookValue := pluginObj.Get(name)
		hook, ok := goja.AssertFunction(hookValue)
		if !ok {
			err = fmt.Errorf("globalThis.siyuan.plugin.lifecycle.%s not bound to a function", name)
			return
		}

		invokeFunction(func(_ *goja.Runtime, result *CallResult) {
			done <- *result.TaskResult()
		}, rt, true, hook, lifecycle)
		return
	}, func(_ *goja.Runtime, _ any, err error) {
		if err != nil {
			done <- TaskResult{err: err}
		}
	})
	if runErr != nil {
		done <- TaskResult{err: runErr}
	}

	result := <-done
	if result.err != nil {
		err = result.err
	}
}

type ServerHandlerResult FunctionResult[*HttpResponse]

// invokeServerHandler invokes the appropriate server handler (HTTP, WebSocket, SSE) based on the request type and access scope.
func (p *KernelPlugin) invokeServerHandler(scope AccessScope, requestType RequestType, request *Request) (response *HttpResponse, err error) {
	done := make(chan *ServerHandlerResult, 1)

	runErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
		// Get handler object: siyuan.server[scope][requestType]
		handlerObjValue, getObjErr := getJsContextValue(rt, []any{"siyuan", "server", string(scope), string(requestType)})
		if getObjErr != nil {
			err = getObjErr
			return
		}

		handlerObj := handlerObjValue.ToObject(rt)
		if handlerObj == nil {
			err = fmt.Errorf("globalThis.siyuan.server[%s][%s] is not an object", scope, requestType)
			return
		}

		// Get handler: siyuan.server[scope][requestType].handler
		handlerValue := handlerObj.Get("handler")
		if goja.IsUndefined(handlerValue) || goja.IsNull(handlerValue) {
			err = fmt.Errorf("siyuan.server[%s][%s].handler is not set", scope, requestType)
			return
		}
		handler, ok := goja.AssertFunction(handlerValue)
		if !ok {
			err = fmt.Errorf("siyuan.server[%s][%s].handler is not a function", scope, requestType)
			return
		}

		// convert body raw data to js object
		if request.Request.Body.Data != nil {
			request.Request.Body.Data, err = NewDataObject(p, rt, *request.Request.Body.Data.(*[]byte))
			if err != nil {
				return
			}
		}

		// convert body form files data to js object
		if request.Request.Body.Form != nil {
			for _, fileList := range request.Request.Body.Form.File {
				for _, file := range fileList {
					if file.Data != nil {
						file.Data, err = NewDataObject(p, rt, *file.Data.(*[]byte))
						if err != nil {
							return
						}
					}
				}
			}
		}

		jsRequest := rt.ToValue(request)
		invokeFunction(func(rt *goja.Runtime, result *CallResult) {
			responseObj := result.Value.ToObject(rt)
			if responseObj == nil {
				done <- &ServerHandlerResult{Error: fmt.Errorf("handler did not return an object")}
				return
			}

			// convert response.body?.raw?.data from (string | Buffer | ArrayBuffer) to []byte
			var raw *[]byte
			if bodyValue := responseObj.Get("body"); !goja.IsUndefined(bodyValue) && !goja.IsNull(bodyValue) {
				// response.body
				if bodyObj := bodyValue.ToObject(rt); bodyObj != nil {
					if rawValue := bodyObj.Get("raw"); !goja.IsUndefined(rawValue) && !goja.IsNull(rawValue) {
						// response.body.raw
						if rawObj := rawValue.ToObject(rt); rawObj != nil {
							if dataValue := rawObj.Get("data"); !goja.IsUndefined(dataValue) && !goja.IsNull(dataValue) {
								// response.body.raw.data
								dataBytes, convertErr := jsValueToBytes(rt, dataValue)
								if convertErr == nil {
									raw = &dataBytes
									rawObj.Set("data", goja.Null())
								}
							}
						}
					}
				}
			}

			// ❌ panic: invalid memory address or nil pointer dereference
			// response := HttpResponse{}
			// if err := rt.ExportTo(responseObj, &response); err != nil {
			// 	done <- &ServerHandlerResult{Error: fmt.Errorf("invalid response format: %v", err)}
			// 	return
			// }

			resultJson, marshalErr := responseObj.MarshalJSON()
			if marshalErr != nil {
				done <- &ServerHandlerResult{Error: marshalErr}
				return
			}

			response := HttpResponse{}
			if unmarshalErr := json.Unmarshal(resultJson, &response); unmarshalErr != nil {
				done <- &ServerHandlerResult{Error: fmt.Errorf("invalid response format: %v", unmarshalErr)}
				return
			}

			if raw != nil && response.Body != nil && response.Body.Raw != nil {
				response.Body.Raw.Data = *raw
			}

			done <- &ServerHandlerResult{Value: &response}
		}, rt, true, handler, handlerObj, jsRequest)
		return
	}, func(_ *goja.Runtime, _ any, err error) {
		if err != nil {
			done <- &ServerHandlerResult{Error: err}
		}
	})
	if runErr != nil {
		done <- &ServerHandlerResult{Error: runErr}
	}

	result := <-done
	if result.Error != nil {
		err = result.Error
	} else {
		response = result.Value
	}

	return
}
