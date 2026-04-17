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
	"os"
	"path/filepath"
	"sync"

	"github.com/fastschema/qjs"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type PluginState int

type RpcMethod struct {
	Name         string
	Descriptions []string
	Function     *qjs.Value
}

type RpcMethodInfo struct {
	Name         string   `json:"name"`
	Descriptions []string `json:"descriptions"`
}

const (
	StateLoading PluginState = iota
	StateRunning
	StateErrored
	StateStopping
	StateStopped
)

func (s PluginState) String() string {
	switch s {
	case StateLoading:
		return "loading"
	case StateRunning:
		return "running"
	case StateErrored:
		return "errored"
	case StateStopped:
		return "stopped"
	default:
		return "unknown"
	}
}

// KernelPlugin represents a single kernel-side plugin instance.
type KernelPlugin struct {
	*model.Petal
	token string // JWT for this plugin

	mu      sync.RWMutex // protects state and runtime
	state   PluginState
	runtime *qjs.Runtime

	rpcMethods sync.Map // registered JSON-RPC methods

	socketsMu sync.RWMutex                    // separate mutex for sockets map (must not nest inside mu)
	sockets   map[*websocket.Conn]bool        // tracked loopback WebSocket connections (true: server, false: client)
	socketMus map[*websocket.Conn]*sync.Mutex // per-connection write mutex
}

func NewKernelPlugin(petal *model.Petal) *KernelPlugin {
	token, _ := model.CreatePluginJWT(petal.Name)
	return &KernelPlugin{
		Petal:      petal,
		token:      token,
		state:      StateStopped,
		rpcMethods: sync.Map{},
		sockets:    make(map[*websocket.Conn]bool),
		socketMus:  make(map[*websocket.Conn]*sync.Mutex),
	}
}

// State returns the current plugin state (safe for concurrent reads).
func (p *KernelPlugin) State() PluginState {
	p.mu.RLock()
	defer p.mu.RUnlock()

	return p.state
}

// Runtime returns the plugin's QJS runtime, or nil if not initialized (safe for concurrent reads).
func (p *KernelPlugin) Runtime() *qjs.Runtime {
	p.mu.RLock()
	defer p.mu.RUnlock()

	return p.runtime
}

func (p *KernelPlugin) close() (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during runtime close: %v", r)
		}
	}()

	runtime := p.Runtime()
	if runtime != nil {
		runtime.Close()
	}
	return
}

// error sets the plugin state to errored and frees the QJS runtime.
func (p *KernelPlugin) error() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if err := p.close(); err != nil {
		logging.LogErrorf("[plugin:%s] failed to close runtime during error handling: %v", p.Name, err)
	}
	p.runtime = nil

	p.state = StateErrored
}

// start creates the QJS runtime, injects sandbox globals, and evaluates kernel.js.
func (p *KernelPlugin) start() (retErr error) {
	defer func() {
		if r := recover(); r != nil {
			p.error()
			retErr = fmt.Errorf("panic during start: %v", r)
		}
	}()

	p.mu.Lock()
	p.state = StateLoading
	p.mu.Unlock()

	baseDir := filepath.Join(util.DataDir, "storage", "petal", p.Name)
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return fmt.Errorf("create plugin dir [%s] failed: %s", baseDir, err)
	}

	runtime, qjsErr := qjs.New()

	p.mu.Lock()
	p.runtime = runtime
	p.mu.Unlock()

	if qjsErr != nil {
		p.error()
		return fmt.Errorf("create QJS runtime: %v", qjsErr)
	}

	// Inject sandbox globals (e.g. globalThis.siyuan) before evaluating plugin code.
	if injectErr := injectSandboxGlobals(p); injectErr != nil {
		p.error()
		return fmt.Errorf("inject sandbox globals: %v", injectErr)
	}

	// Load and evaluate kernel.js code in plugin's QJS runtime.
	_, evalErr := runtime.Eval(p.Name+"/kernel.js", qjs.Code(p.Kernel.JS))
	if evalErr != nil {
		p.error()
		return fmt.Errorf("eval error: %v", evalErr)
	}

	p.onLoad()

	p.mu.Lock()
	p.state = StateRunning
	p.mu.Unlock()

	logging.LogDebugf("[plugin:%s] started", p.Name)
	return nil
}

// stop cleanly shuts down the plugin: closes sockets, frees QJS runtime.
func (p *KernelPlugin) stop() (retErr error) {
	defer func() {
		if r := recover(); r != nil {
			p.error()
			retErr = fmt.Errorf("panic during stop: %v", r)
		}
	}()

	p.mu.Lock()
	p.state = StateStopping
	p.mu.Unlock()

	p.onUnload()

	p.rpcMethods.Clear()

	p.socketsMu.Lock()
	for c := range p.sockets {
		c.Close()
		delete(p.sockets, c)
		delete(p.socketMus, c)
	}
	p.socketsMu.Unlock()

	p.close()

	p.mu.Lock()
	p.runtime = nil
	p.state = StateStopped
	p.mu.Unlock()

	logging.LogDebugf("[plugin:%s] stopped", p.Name)
	return
}

// onLoad is called after plugin start.
func (p *KernelPlugin) onLoad() {
	if p.State() == StateLoading {
		p.invokeJsLifecycleHook("onload")
	}

}

// onUnload is called before plugin stop.
func (p *KernelPlugin) onUnload() {
	if p.State() == StateStopping {
		p.invokeJsLifecycleHook("onunload")
	}

}

// bindRpcMethod add or updates a JS function as a named RPC method.
func (p *KernelPlugin) bindRpcMethod(name string, function *qjs.Value, descriptions ...string) error {
	p.rpcMethods.Store(name, &RpcMethod{
		Name:         name,
		Descriptions: descriptions,
		Function:     function,
	})
	return nil
}

// unbindRpcMethod removes a registered RPC method
func (p *KernelPlugin) unbindRpcMethod(name string, function *qjs.Value) error {
	value, ok := p.rpcMethods.Load(name)
	if !ok {
		return nil
	}

	rpcMethod, ok := value.(*RpcMethod)
	if !ok {
		return nil
	}

	if rpcMethod.Function.Raw() == function.Raw() {
		p.rpcMethods.Delete(name)
	}
	return nil
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
// If Stop races and closes the connection after the tracking check, WriteMessage returns
// an error which is propagated to the caller.
func (p *KernelPlugin) writeWebSocketMessage(conn *websocket.Conn, data []byte) error {
	p.socketsMu.RLock()
	mu, ok := p.socketMus[conn]
	p.socketsMu.RUnlock()
	if !ok {
		return nil
	}

	// Between RUnlock above and mu.Lock below, Stop() may close the connection.
	// The subsequent WriteMessage will return an error (use of closed connection),
	// which callers log and discard.
	mu.Lock()
	defer mu.Unlock()
	return conn.WriteMessage(websocket.TextMessage, data)
}

// dispatchRpcRequests dispatches multiple JSON-RPC requests concurrently.
// Returns responses in the same order as requests. Nil responses indicate notifications.
func (p *KernelPlugin) dispatchRpcRequests(requests []*JsonRpcInboundRequest) []any {
	responses := make([]any, len(requests))
	var wg sync.WaitGroup

	for i, req := range requests {
		if req.IsNotification() {
			go func(request *JsonRpcInboundRequest) {
				p.dispatchRpcRequest(request)
			}(req)
			continue
		}
		wg.Add(1)
		go func(index int, request *JsonRpcInboundRequest) {
			defer wg.Done()
			responses[index] = p.dispatchRpcRequest(request)
		}(i, req)
	}

	wg.Wait()
	return responses
}

// dispatchRpcRequest routes a single JSON-RPC request to the plugin's registered JS method.
// Returns nil for notifications (no ID field).
func (p *KernelPlugin) dispatchRpcRequest(request *JsonRpcInboundRequest) any {
	// Validate request structure
	if err := request.Validate(); err != nil {
		if request.IsNotification() {
			return nil
		}
		return &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error:   err,
			ID:      request.ID,
		}
	}

	result, err := p.callRpcMethod(request.Method, request.Params)

	// For notifications, return nil (no response)
	if request.IsNotification() {
		return nil
	}

	if err != nil {
		return &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error:   err,
			ID:      request.ID,
		}
	}

	return &JsonRpcRequestResponse{
		JsonRpc: JsonRpcVersion,
		Result:  result,
		ID:      request.ID,
	}
}

// callRpcMethod invokes a registered JS RPC method with the given JSON params.
// Returns the JS function's return value as a Go any.
func (p *KernelPlugin) callRpcMethod(method string, params any) (retResult any, rpcErr *JsonRpcError) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogDebugf("[plugin:%s] panic in RPC method %q: %v", p.Name, method, r)
			rpcErr = &JsonRpcError{
				Code:    JsonRpcErrorCodeInternalError,
				Message: fmt.Sprintf("panic in RPC method %q: %v", method, r),
			}
		}
	}()

	state := p.State()
	runtime := p.Runtime()

	if state != StateRunning {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("plugin %s not running (state: %s)", p.Name, p.state),
		}
	}

	if runtime == nil {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("QJS runtime not initialized for plugin %s", p.Name),
		}
	}
	ctx := runtime.Context()

	// Convert params to JS value
	paramValue, convertErr := rpcParamsToJsValue(ctx, params)
	if convertErr != nil {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("convert params: %v", convertErr),
		}
	}

	rpcMethod := p.getRpcMethod(method)
	if rpcMethod == nil {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeMethodNotFound,
			Message: fmt.Sprintf("method not found: %q", method),
		}
	}

	// Call the JS function using ctx.Invoke(fn, thisVal, args...)
	var result *qjs.Value
	var err error
	if paramValue == nil {
		result, err = ctx.Invoke(rpcMethod, ctx.Global())
	} else if paramValue.IsArray() {
		var paramsArray []*qjs.Value
		paramArray, _ := paramValue.ToArray()
		paramArray.ForEach(func(key *qjs.Value, value *qjs.Value) {
			paramsArray = append(paramsArray, value)
		})
		result, err = ctx.Invoke(rpcMethod, ctx.Global(), paramsArray...)
	} else {
		result, err = ctx.Invoke(rpcMethod, ctx.Global(), paramValue)
	}
	if err != nil {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("call %q: %v", method, err),
		}
	}

	// Await if Promise
	if result != nil && result.IsPromise() {
		result, err = result.Await()
		if err != nil {
			return nil, &JsonRpcError{
				Code:    JsonRpcErrorCodeInternalError,
				Message: fmt.Sprintf("await %q: %v", method, err),
			}
		}
	}

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

	var goResult any
	if err = json.Unmarshal([]byte(jsonStr), &goResult); err != nil {
		// If it's a primitive that doesn't unmarshal cleanly, return the raw string.
		return jsonStr, nil
	}
	return goResult, nil
}

// TrackSocket adds a WebSocket connection to the plugin's tracked list.
func (p *KernelPlugin) TrackSocket(conn *websocket.Conn, isRpcConnection bool) {
	p.socketsMu.Lock()
	defer p.socketsMu.Unlock()
	p.sockets[conn] = isRpcConnection
	p.socketMus[conn] = &sync.Mutex{}
}

// UntrackSocket removes a WebSocket connection from the plugin's tracked list.
func (p *KernelPlugin) UntrackSocket(conn *websocket.Conn) {
	p.socketsMu.Lock()
	defer p.socketsMu.Unlock()
	delete(p.sockets, conn)
	delete(p.socketMus, conn)
}

// getRpcMethod retrieves a registered RPC method by name, or nil if not found or not a function.
func (p *KernelPlugin) getRpcMethod(name string) *qjs.Value {
	value, ok := p.rpcMethods.Load(name)
	if !ok {
		return nil
	}

	method, ok := value.(*RpcMethod)
	if !ok {
		return nil
	}

	if !method.Function.IsFunction() {
		return nil
	}

	return method.Function
}

// getJsContextValue safely retrieves a nested value from the plugin's JS context, returning nil if any step fails.
func (p *KernelPlugin) getJsContextValue(paths []any) (value *qjs.Value, retErr error) {
	runtime := p.Runtime()
	if runtime == nil {
		return nil, fmt.Errorf("QJS runtime not initialized")
	}

	ctx := runtime.Context()
	if ctx == nil {
		return
	}

	this := ctx.Global()

	for _, path := range paths {
		if this == nil {
			return
		}

		if pathStr, ok := path.(string); ok {
			this = this.GetPropertyStr(pathStr)
			continue
		}

		if pathInt, ok := path.(int64); ok {
			this = this.GetPropertyIndex(pathInt)
			continue
		}

		if pathValue, ok := path.(*qjs.Value); ok {
			this = this.GetProperty(pathValue)
			continue
		}
		return
	}

	value = this
	return
}

// invokeJsLifecycleHook calls a JS lifecycle hook (e.g. onload) if it exists, awaiting if it returns a Promise.
func (p *KernelPlugin) invokeJsLifecycleHook(name string, args ...any) (result *qjs.Value, err error) {
	plugin, err := p.getJsContextValue([]any{"siyuan", "plugin"})
	if err != nil {
		return
	}
	if plugin == nil {
		err = fmt.Errorf("globalThis.siyuan.plugin not found in JS context")
		return
	}

	hook := plugin.GetPropertyStr(name)
	if hook != nil && hook.IsFunction() {
		result, err = plugin.Invoke(name, args...)
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
