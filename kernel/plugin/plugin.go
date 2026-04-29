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
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/asaskevich/EventBus"
	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lxzan/gws"
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

// gwsEventHandler implements gws.Event with settable callback fields so closures
// capturing the JS runtime context can be assigned after the upgrader/dialer is created.
type gwsEventHandler struct {
	gws.BuiltinEventHandler
	onOpen    func(*gws.Conn)
	onClose   func(*gws.Conn, error)
	onPing    func(*gws.Conn, []byte)
	onPong    func(*gws.Conn, []byte)
	onMessage func(*gws.Conn, *gws.Message)
}

func (h *gwsEventHandler) OnOpen(socket *gws.Conn) {
	if h.onOpen != nil {
		h.onOpen(socket)
	}
}

func (h *gwsEventHandler) OnClose(socket *gws.Conn, err error) {
	if h.onClose != nil {
		h.onClose(socket, err)
	}
}

func (h *gwsEventHandler) OnPing(socket *gws.Conn, payload []byte) {
	if h.onPing != nil {
		h.onPing(socket, payload)
	}
}

func (h *gwsEventHandler) OnPong(socket *gws.Conn, payload []byte) {
	if h.onPong != nil {
		h.onPong(socket, payload)
	}
}

func (h *gwsEventHandler) OnMessage(socket *gws.Conn, message *gws.Message) {
	if h.onMessage != nil {
		h.onMessage(socket, message)
	} else {
		message.Close()
	}
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

	socketsMu  sync.RWMutex       // mutex for gwsSockets map
	gwsSockets map[*gws.Conn]bool // tracked gws WebSocket connections (true: RPC server, false: regular)

	sseCancelsMu sync.Mutex
	sseCancels   map[uint64]context.CancelFunc
	sseNextID    uint64
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

		gwsSockets: make(map[*gws.Conn]bool),

		sseCancels: make(map[uint64]context.CancelFunc),
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
	for c := range p.gwsSockets {
		c.NetConn().Close()
		delete(p.gwsSockets, c)
	}
	p.socketsMu.Unlock()

	p.sseCancelsMu.Lock()
	for id, cancel := range p.sseCancels {
		cancel()
		delete(p.sseCancels, id)
	}
	p.sseCancelsMu.Unlock()

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
	conns := make([]*gws.Conn, 0, len(p.gwsSockets))
	for conn, isRpcConnection := range p.gwsSockets {
		if isRpcConnection {
			conns = append(conns, conn)
		}
	}
	p.socketsMu.RUnlock()

	var wg sync.WaitGroup
	for _, conn := range conns {
		wg.Add(1)
		c := conn
		payload := make([]byte, len(data))
		copy(payload, data) // each conn needs its own copy; WriteAsync is async and all conns share the same source slice
		c.WriteAsync(gws.OpcodeText, payload, func(writeErr error) {
			defer wg.Done()
			if writeErr != nil {
				logging.LogWarnf("[plugin:%s] RPC WebSocket notification write failed: %s", p.Name, writeErr)
			}
		})
	}
	wg.Wait()
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

// TrackGwsSocket adds a gws WebSocket connection to the plugin's tracked list.
func (p *KernelPlugin) TrackGwsSocket(conn *gws.Conn, isRpcConnection bool) {
	if conn == nil {
		return
	}
	p.socketsMu.Lock()
	defer p.socketsMu.Unlock()
	p.gwsSockets[conn] = isRpcConnection
}

// UntrackGwsSocket removes a gws WebSocket connection from the plugin's tracked list.
func (p *KernelPlugin) UntrackGwsSocket(conn *gws.Conn) {
	if conn == nil {
		return
	}
	p.socketsMu.Lock()
	defer p.socketsMu.Unlock()
	delete(p.gwsSockets, conn)
}

// TrackSSE registers an SSE cancel function and returns its ID for later removal.
func (p *KernelPlugin) TrackSSE(cancel context.CancelFunc) uint64 {
	p.sseCancelsMu.Lock()
	defer p.sseCancelsMu.Unlock()
	id := p.sseNextID
	p.sseNextID++
	p.sseCancels[id] = cancel
	return id
}

// UntrackSSE removes a previously registered SSE cancel function by ID.
func (p *KernelPlugin) UntrackSSE(id uint64) {
	p.sseCancelsMu.Lock()
	defer p.sseCancelsMu.Unlock()
	delete(p.sseCancels, id)
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

// handleHttpRequest dispatches an HTTP request to the plugin's JS handler and returns the response.
func (p *KernelPlugin) handleHttpRequest(request *Request, scope AccessScope) (response *HttpResponse, err error) {
	type handleResult FunctionResult[*HttpResponse]
	done := make(chan *handleResult, 1)

	runErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
		handler, handlerObj, getHandlerErr := getRequestHandler(rt, scope, RequestTypeHTTP)
		if getHandlerErr != nil {
			err = getHandlerErr
			return
		}

		jsRequest, convertErr := requestGoToJs(p, rt, request)
		if convertErr != nil {
			err = convertErr
			return
		}

		invokeFunction(func(rt *goja.Runtime, result *CallResult) {
			responseObj := result.Value.ToObject(rt)
			if responseObj == nil {
				done <- &handleResult{Error: fmt.Errorf("handler did not return an object")}
				return
			}

			// convert response.body?.raw?.data from (string | Buffer | ArrayBuffer) to []byte
			var raw *[]byte
			if bodyValue := responseObj.Get("body"); isJsValueNotNull(bodyValue) {
				// response.body
				if bodyObj := bodyValue.ToObject(rt); bodyObj != nil {
					if rawValue := bodyObj.Get("raw"); isJsValueNotNull(rawValue) {
						// response.body.raw
						if rawObj := rawValue.ToObject(rt); rawObj != nil {
							if dataValue := rawObj.Get("data"); isJsValueNotNull(dataValue) {
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
				done <- &handleResult{Error: marshalErr}
				return
			}

			response := HttpResponse{}
			if unmarshalErr := json.Unmarshal(resultJson, &response); unmarshalErr != nil {
				done <- &handleResult{Error: fmt.Errorf("invalid response format: %v", unmarshalErr)}
				return
			}

			if raw != nil && response.Body != nil && response.Body.Raw != nil {
				response.Body.Raw.Data = *raw
			}

			done <- &handleResult{Value: &response}
		}, rt, true, handler, handlerObj, jsRequest)
		return
	}, func(_ *goja.Runtime, _ any, err error) {
		if err != nil {
			done <- &handleResult{Error: err}
		}
	})
	if runErr != nil {
		done <- &handleResult{Error: runErr}
	}

	result := <-done
	if result.Error != nil {
		err = result.Error
	} else {
		response = result.Value
	}

	return
}

func (p *KernelPlugin) handleWebSocketRequest(c *gin.Context, request *Request, scope AccessScope) (err error) {
	h := &gwsEventHandler{}
	upgrader := gws.NewUpgrader(h, &gws.ServerOption{
		Authorize: func(r *http.Request, _ gws.SessionStorage) bool { return true },
	})

	socket, upgradeErr := upgrader.Upgrade(c.Writer, c.Request)
	if upgradeErr != nil {
		return upgradeErr
	}

	p.TrackGwsSocket(socket, false)
	var closeOnce sync.Once
	doClose := func() {
		closeOnce.Do(func() {
			p.UntrackGwsSocket(socket)
			socket.NetConn().Close()
		})
	}
	defer doClose()

	var readyState atomic.Int64
	var bufferedAmount atomic.Int64
	readyState.Store(int64(WebSocketReadyStateConnecting))

	connDone := make(chan error, 1)

	runErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
		handler, handlerObj, getHandlerErr := getRequestHandler(rt, scope, RequestTypeWS)
		if getHandlerErr != nil {
			err = getHandlerErr
			return
		}

		jsRequest, convertErr := requestGoToJs(p, rt, request)
		if convertErr != nil {
			err = convertErr
			return
		}

		jsRequestObj := jsRequest.ToObject(rt)
		if jsRequestObj == nil {
			err = fmt.Errorf("failed to convert request value to object")
			return
		}

		port := rt.NewObject()

		invokePortHook := func(name string, args ...goja.Value) {
			hook := port.Get(name)
			if fn, ok := goja.AssertFunction(hook); ok {
				if _, callErr := fn(port, args...); callErr != nil {
					logging.LogErrorf("[plugin:%s] ws server port hook %q: %v", p.Name, name, callErr)
				}
			}
		}

		setPortReadyState := func(rt *goja.Runtime, state WebSocketState) {
			readyState.Store(int64(state))
			port.Set("readyState", rt.ToValue(state))
		}

		updatePortBufferedAmount := func(rt *goja.Runtime, delta int) {
			bufferedAmount.Add(int64(delta))
			port.Set("bufferedAmount", rt.ToValue(bufferedAmount.Load()))
		}

		// Wire up gws event callbacks capturing the JS runtime context.
		h.onOpen = func(conn *gws.Conn) {
			p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
				setPortReadyState(rt, WebSocketReadyStateOpen)
				event := rt.NewObject()
				event.Set("type", rt.ToValue("open"))
				invokePortHook("onopen", event)
				return
			}, nil)
		}

		h.onClose = func(conn *gws.Conn, closeErr error) {
			doClose()
			p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
				if closeErr != nil {
					errEvent := rt.NewObject()
					errEvent.Set("type", rt.ToValue("error"))
					errEvent.Set("error", rt.NewGoError(closeErr))
					invokePortHook("onerror", errEvent)
				}

				if closeError, ok := closeErr.(*gws.CloseError); ok {
					setPortReadyState(rt, WebSocketReadyStateClosing)
					closeEvent := rt.NewObject()
					closeEvent.Set("type", rt.ToValue("close"))
					closeEvent.Set("code", rt.ToValue(closeError.Code))
					closeEvent.Set("reason", rt.ToValue(string(closeError.Reason)))
					closeEvent.Set("wasClean", rt.ToValue(bufferedAmount.Load() == 0))
					invokePortHook("onclose", closeEvent)
				}
				setPortReadyState(rt, WebSocketReadyStateClosed)
				return
			}, nil)
		}

		h.onPing = func(conn *gws.Conn, payload []byte) {
			p.worker.RunSync(func(rt *goja.Runtime) (_ any, _ error) {
				event := rt.NewObject()
				event.Set("type", rt.ToValue("ping"))
				event.Set("data", rt.ToValue(string(payload)))
				invokePortHook("onping", event)
				return
			})
		}

		h.onPong = func(conn *gws.Conn, payload []byte) {
			p.worker.RunSync(func(rt *goja.Runtime) (_ any, _ error) {
				event := rt.NewObject()
				event.Set("type", rt.ToValue("pong"))
				event.Set("data", rt.ToValue(string(payload)))
				invokePortHook("onpong", event)
				return
			})
		}

		h.onMessage = func(conn *gws.Conn, message *gws.Message) {
			defer message.Close()
			opcode := message.Opcode
			data := make([]byte, message.Data.Len())
			copy(data, message.Bytes()) // message.Bytes() points into gws-managed memory reclaimed by message.Close() (deferred above)
			runMsgErr := p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
				event := rt.NewObject()
				switch opcode {
				case gws.OpcodeText:
					event.Set("type", rt.ToValue("text"))
					event.Set("data", rt.ToValue(string(data)))
				case gws.OpcodeBinary:
					event.Set("type", rt.ToValue("binary"))
					event.Set("data", rt.ToValue(rt.NewArrayBuffer(data)))
				default:
					return
				}
				invokePortHook("onmessage", event)
				return
			}, nil)
			if runMsgErr != nil {
				doClose()
			}
		}

		var openOnce sync.Once
		startReadLoop := func() { go socket.ReadLoop() }

		port_open := rt.ToValue(func(openCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
			openPromise, openResolve, openReject := rt.NewPromise()

			openRunErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
				openOnce.Do(startReadLoop)
				return
			}, func(rt *goja.Runtime, _ any, err error) {
				if lo.IsNil(err) {
					if resolveErr := openResolve(nil); resolveErr != nil {
						logging.LogErrorf("[plugin:%s] ws server port.open resolve: %v", p.Name, resolveErr)
					}
				} else {
					if rejectErr := openReject(rt.NewGoError(err)); rejectErr != nil {
						logging.LogErrorf("[plugin:%s] ws server port.open reject: %v", p.Name, rejectErr)
					}
				}
			})
			if openRunErr != nil {
				logging.LogErrorf("[plugin:%s] ws server port.open worker run: %v", p.Name, openRunErr)
			}

			return rt.ToValue(openPromise)
		})

		port_send := rt.ToValue(func(sendCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
			sendPromise, sendResolve, sendReject := rt.NewPromise()

			sendRunErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
				var messageData []byte
				var opcode gws.Opcode
				if len(sendCall.Arguments) >= 1 {
					data := sendCall.Argument(0)
					if arrayBuffer, ok := data.Export().(goja.ArrayBuffer); ok {
						opcode = gws.OpcodeBinary
						b := arrayBuffer.Bytes()
						messageData = make([]byte, len(b))
						copy(messageData, b) // ArrayBuffer.Bytes() points into JS engine memory; copy before async send
					} else {
						opcode = gws.OpcodeText
						messageData = []byte(data.String())
					}
				}

				state := WebSocketState(readyState.Load())
				if state == WebSocketReadyStateClosing || state == WebSocketReadyStateClosed {
					err = fmt.Errorf("WebSocket is not open (state: %d)", state)
					return
				}

				updatePortBufferedAmount(rt, len(messageData))
				socket.WriteAsync(opcode, messageData, func(writeErr error) {
					p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
						if writeErr == nil {
							updatePortBufferedAmount(rt, -len(messageData))
						} else {
							err = writeErr
						}
						return
					}, func(rt *goja.Runtime, result any, err error) {
						if lo.IsNil(err) {
							if resolveErr := sendResolve(result); resolveErr != nil {
								logging.LogErrorf("[plugin:%s] ws server port.send resolve: %v", p.Name, resolveErr)
							}
						} else {
							if rejectErr := sendReject(rt.NewGoError(err)); rejectErr != nil {
								logging.LogErrorf("[plugin:%s] ws server port.send reject: %v", p.Name, rejectErr)
							}
						}
					})
				})
				return
			}, func(rt *goja.Runtime, _ any, err error) {
				if !lo.IsNil(err) {
					if rejectErr := sendReject(rt.NewGoError(err)); rejectErr != nil {
						logging.LogErrorf("[plugin:%s] ws server port.send reject: %v", p.Name, rejectErr)
					}
				}
			})
			if sendRunErr != nil {
				logging.LogErrorf("[plugin:%s] ws server port.send worker run: %v", p.Name, sendRunErr)
			}

			return rt.ToValue(sendPromise)
		})

		port_ping := rt.ToValue(func(pingCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
			pingPromise, pingResolve, pingReject := rt.NewPromise()

			pingRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
				var pingData string
				if len(pingCall.Arguments) > 0 && !goja.IsUndefined(pingCall.Argument(0)) {
					pingData = pingCall.Argument(0).String()
				}
				err = socket.WritePing([]byte(pingData))
				return
			}, func(rt *goja.Runtime, result any, err error) {
				if lo.IsNil(err) {
					if resolveErr := pingResolve(result); resolveErr != nil {
						logging.LogErrorf("[plugin:%s] ws server port.ping resolve: %v", p.Name, resolveErr)
					}
				} else {
					if rejectErr := pingReject(rt.NewGoError(err)); rejectErr != nil {
						logging.LogErrorf("[plugin:%s] ws server port.ping reject: %v", p.Name, rejectErr)
					}
				}
			})
			if pingRunErr != nil {
				logging.LogErrorf("[plugin:%s] ws server port.ping worker run: %v", p.Name, pingRunErr)
			}

			return rt.ToValue(pingPromise)
		})

		port_pong := rt.ToValue(func(pongCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
			pongPromise, pongResolve, pongReject := rt.NewPromise()

			pongRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
				var pongData string
				if len(pongCall.Arguments) > 0 && !goja.IsUndefined(pongCall.Argument(0)) {
					pongData = pongCall.Argument(0).String()
				}
				err = socket.WritePong([]byte(pongData))
				return
			}, func(rt *goja.Runtime, result any, err error) {
				if lo.IsNil(err) {
					if resolveErr := pongResolve(result); resolveErr != nil {
						logging.LogErrorf("[plugin:%s] ws server port.pong resolve: %v", p.Name, resolveErr)
					}
				} else {
					if rejectErr := pongReject(rt.NewGoError(err)); rejectErr != nil {
						logging.LogErrorf("[plugin:%s] ws server port.pong reject: %v", p.Name, rejectErr)
					}
				}
			})
			if pongRunErr != nil {
				logging.LogErrorf("[plugin:%s] ws server port.pong worker run: %v", p.Name, pongRunErr)
			}

			return rt.ToValue(pongPromise)
		})

		port_close := rt.ToValue(func(closeCall goja.FunctionCall, rt *goja.Runtime) goja.Value {
			closePromise, closeResolve, closeReject := rt.NewPromise()

			closeRunErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
				code := uint16(1000)
				var reason []byte
				if !isJsValueNotNull(closeCall.Argument(0)) {
					code = uint16(closeCall.Argument(0).ToInteger())
				}
				if !isJsValueNotNull(closeCall.Argument(1)) {
					reason = []byte(closeCall.Argument(1).String())
				}
				setPortReadyState(rt, WebSocketReadyStateClosing)
				err = socket.WriteClose(code, reason)
				return
			}, func(rt *goja.Runtime, result any, err error) {
				if lo.IsNil(err) {
					if resolveErr := closeResolve(result); resolveErr != nil {
						logging.LogErrorf("[plugin:%s] ws server port.close resolve: %v", p.Name, resolveErr)
					}
				} else {
					if rejectErr := closeReject(rt.NewGoError(err)); rejectErr != nil {
						logging.LogErrorf("[plugin:%s] ws server port.close reject: %v", p.Name, rejectErr)
					}
				}
			})
			if closeRunErr != nil {
				logging.LogErrorf("[plugin:%s] ws server port.close worker run: %v", p.Name, closeRunErr)
			}

			return rt.ToValue(closePromise)
		})

		lo.Must0(port.Set("binaryType", rt.ToValue("arraybuffer")))
		lo.Must0(port.Set("bufferedAmount", rt.ToValue(bufferedAmount.Load())))
		lo.Must0(port.Set("readyState", rt.ToValue(readyState.Load())))

		lo.Must0(port.Set("onopen", goja.Null()))
		lo.Must0(port.Set("onmessage", goja.Null()))
		lo.Must0(port.Set("onping", goja.Null()))
		lo.Must0(port.Set("onpong", goja.Null()))
		lo.Must0(port.Set("onclose", goja.Null()))
		lo.Must0(port.Set("onerror", goja.Null()))

		lo.Must0(port.Set("open", port_open))
		lo.Must0(port.Set("send", port_send))
		lo.Must0(port.Set("ping", port_ping))
		lo.Must0(port.Set("pong", port_pong))
		lo.Must0(port.Set("close", port_close))

		lo.Must0(ObjectSeal(rt, port))
		lo.Must0(jsRequestObj.Set("port", port))

		invokeFunction(func(_ *goja.Runtime, result *CallResult) {
			if result.Error != nil {
				doClose()
				connDone <- result.Error
				return
			}
			// Auto-open if the handler did not call port.open() explicitly.
			openOnce.Do(startReadLoop)
		}, rt, true, handler, handlerObj, jsRequest)

		return
	}, func(_ *goja.Runtime, _ any, runErr error) {
		if runErr != nil {
			doClose()
			connDone <- runErr
		}
	})

	if runErr != nil {
		doClose()
		return runErr
	}

	err = <-connDone
	return
}

// handleServerSentEventRequest dispatches an SSE request to the plugin's JS handler and streams events until completion or client disconnect.
func (p *KernelPlugin) handleServerSentEventRequest(c *gin.Context, request *Request, scope AccessScope) (err error) {
	type sseEvent struct {
		name    string
		message any
	}

	ctx, cancel := context.WithCancel(c.Request.Context())

	sseID := p.TrackSSE(cancel)
	var closeOnce sync.Once
	doClose := func() {
		closeOnce.Do(func() {
			cancel()
			p.UntrackSSE(sseID)
		})
	}
	defer doClose()

	events := make(chan sseEvent, 64)
	handlerDone := make(chan error, 1) // using to receive handler error or close signal

	runErr := p.worker.Run(func(rt *goja.Runtime) (_ any, err error) {
		handler, handlerObj, getHandlerErr := getRequestHandler(rt, scope, RequestTypeSSE)
		if getHandlerErr != nil {
			err = getHandlerErr
			return
		}

		jsRequest, convertErr := requestGoToJs(p, rt, request)
		if convertErr != nil {
			err = convertErr
			return
		}

		jsRequestObj := jsRequest.ToObject(rt)
		if jsRequestObj == nil {
			err = fmt.Errorf("failed to convert request value to object")
			return
		}

		port := rt.NewObject()

		invokePortHook := func(name string, args ...goja.Value) {
			hook := port.Get(name)
			if fn, ok := goja.AssertFunction(hook); ok {
				if _, callErr := fn(port, args...); callErr != nil {
					logging.LogErrorf("[plugin:%s] ws server port hook %q: %v", p.Name, name, callErr)
				}
			}
		}

		port_send := rt.ToValue(func(call goja.FunctionCall) goja.Value {
			name := call.Argument(0).String()
			message := call.Argument(1).Export()
			select {
			case events <- sseEvent{name, message}:
			case <-ctx.Done():
			}
			return goja.Undefined()
		})

		port_close := rt.ToValue(func(call goja.FunctionCall) goja.Value {
			doClose()
			return goja.Undefined()
		})

		lo.Must0(port.Set("onopen", goja.Null()))
		lo.Must0(port.Set("onclose", goja.Null()))

		lo.Must0(port.Set("send", port_send))
		lo.Must0(port.Set("close", port_close))

		lo.Must0(ObjectSeal(rt, port))

		lo.Must0(jsRequestObj.Set("port", port))

		invokeFunction(func(_ *goja.Runtime, result *CallResult) {
			if result.Error != nil {
				handlerDone <- result.Error
			} else {
				p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
					event := rt.NewObject()
					event.Set("type", rt.ToValue("open"))
					invokePortHook("onopen", event)
					return
				}, nil)

				handlerDone <- nil
			}
		}, rt, true, handler, handlerObj, jsRequest)

		go func() {
			<-ctx.Done()
			p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
				event := rt.NewObject()
				event.Set("type", rt.ToValue("close"))
				invokePortHook("onclose", event)
				return
			}, nil)
		}()

		return
	}, func(_ *goja.Runtime, _ any, err error) {
		if err != nil {
			handlerDone <- err
		}
	})
	if runErr != nil {
		return runErr
	}

	for {
		select {
		case e := <-events:
			c.SSEvent(e.name, e.message)
			c.Writer.Flush()
		case <-ctx.Done():
			return
		case handlerErr := <-handlerDone:
			if handlerErr != nil {
				err = handlerErr
				return
			}
			// Handler completed successfully; keep streaming until port.close() or client disconnect.
		}
	}
}
