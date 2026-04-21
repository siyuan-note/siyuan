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
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/asaskevich/EventBus"
	"github.com/fastschema/qjs"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type PluginState int64

type RpcMethod struct {
	Name         string
	Descriptions []string
}

type RpcMethodInfo struct {
	Name         string   `json:"name"`
	Descriptions []string `json:"descriptions"`
}

const (
	PluginEventTypeLifecycle = "lifecycle"
	PluginEventTypeRpc       = "rpc"
)

type PluginEvent struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

type PluginLifecycleEvent struct {
	*PluginEvent
	Detail *PluginLifecycleEventDetail `json:"detail"`
}

type PluginLifecycleEventDetail struct {
	Name string `json:"name"` // "load", "loaded", "unload"
}

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

	file    string                      // file path for qjs runtime (e.g. "plugin-name/kernel.js")
	options []qjs.EvalOptionFunc        // options for evaluating in qjs runtime
	runtime atomic.Pointer[qjs.Runtime] // *qjs.Runtime

	state   atomic.Int64    //  PluginState
	worker  *Worker         // Worker for serializing plugin js-call-go (e.g. logger) and go-call-js (e.g. RPC calls) tasks on a single goroutine
	context context.Context // Context for managing plugin lifecycle and cancellation

	bus     EventBus.Bus   // Event bus for plugin events and RPC request/response dispatch
	handler func(e string) // Event handler subscribed to plugin events

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

		file: fmt.Sprintf("%s/kernel.js", petal.Name),
		options: []qjs.EvalOptionFunc{
			qjs.TypeGlobal(),
			qjs.TypeModule(),
			qjs.FlagAsync(),
		},

		bus:     EventBus.New(),
		worker:  NewWorker(64),
		context: context.Background(),

		sockets:   make(map[*websocket.Conn]bool),
		socketMus: make(map[*websocket.Conn]*sync.Mutex),
	}

	plugin.state.Store(int64(PluginStateReady))
	plugin.runtime.Store(nil)
	return plugin
}

// State returns the current plugin state (safe for concurrent reads).
func (p *KernelPlugin) State() PluginState {
	return PluginState(p.state.Load())
}

// Runtime returns the plugin's QJS runtime, or nil if not initialized (safe for concurrent reads).
func (p *KernelPlugin) Runtime() *qjs.Runtime {
	return p.runtime.Load()
}

func (p *KernelPlugin) Context() *qjs.Context {
	runtime := p.Runtime()
	if runtime == nil {
		return nil
	}
	context := runtime.Context()
	if context == nil {
		return nil
	}
	return context
}

// Eval evaluates JavaScript code in the plugin's QJS context, returning the result or error.
func (p *KernelPlugin) Eval(ctx *qjs.Context, code string) (result *qjs.Value, err error) {
	return ctx.Eval(p.file, append(p.options, qjs.Code(code))...)
}

// close frees the QJS runtime.
func (p *KernelPlugin) close() (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("qjs panic during close runtime: %v", r)
		}
	}()

	runtime := p.Runtime()
	if runtime != nil {
		runtime.Close()
		p.runtime.Store(nil)
	}
	return
}

// error sets the plugin state to errored and frees the QJS runtime.
func (p *KernelPlugin) error() {
	if err := p.close(); err != nil {
		logging.LogErrorf("[plugin:%s] failed to close runtime during error handling: %v", p.Name, err)
	}

	p.state.Store(int64(PluginStateError))
}

// start creates the QJS runtime, injects sandbox globals, and evaluates kernel.js.
func (p *KernelPlugin) start() (retErr error) {
	defer func() {
		if r := recover(); r != nil {
			p.error()
			retErr = fmt.Errorf("qjs panic during start: %v", r)
		}
	}()

	p.state.Store(int64(PluginStateLoading))

	baseDir := filepath.Join(util.DataDir, "storage", "petal", p.Name)
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return fmt.Errorf("create plugin dir [%s] failed: %s", baseDir, err)
	}

	runtime, qjsErr := qjs.New(qjs.Option{
		Stdout: &KernelPluginLogger{name: p.Name, logFn: logging.LogInfo},
		Stderr: &KernelPluginLogger{name: p.Name, logFn: logging.LogError},
	})

	p.runtime.Store(runtime)

	if qjsErr != nil {
		p.error()
		return fmt.Errorf("create QJS runtime: %v", qjsErr)
	}

	ctx := p.Context()
	if ctx == nil {
		p.error()
		return fmt.Errorf("failed to get QJS context")
	}

	// Inject sandbox globals (e.g. globalThis.siyuan) before evaluating plugin code.
	if injectErr := injectGlobalContext(p, ctx); injectErr != nil {
		p.error()
		return fmt.Errorf("inject sandbox globals: %v", injectErr)
	}

	// Load and evaluate kernel.js code in plugin's QJS runtime.
	_, evalErr := p.Eval(ctx, p.Kernel.JS)
	if evalErr != nil {
		p.error()
		return fmt.Errorf("eval error: %v", evalErr)
	}

	subscribeErr := p.subscribeEvents(ctx)
	if subscribeErr != nil {
		p.error()
		return fmt.Errorf("subscribe plugin events: %v", subscribeErr)
	}

	p.onLoad()

	p.state.Store(int64(PluginStateLoaded))

	p.onLoaded()

	p.state.Store(int64(PluginStateRunning))

	logging.LogDebugf("[plugin:%s] started", p.Name)
	return nil
}

// stop cleanly shuts down the plugin: closes sockets, frees QJS runtime.
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

	p.unsubscribeEvents()
	p.worker.Close()

	p.close()
	p.state.Store(int64(PluginStateStopped))

	logging.LogDebugf("[plugin:%s] stopped", p.Name)

	ok = true
	return
}

// onLoad is called after plugin start.
func (p *KernelPlugin) onLoad() {
	if p.State() == PluginStateLoading {
		p.invokeHook("load")
	}
}

// onLoad is called after plugin start.
func (p *KernelPlugin) onLoaded() {
	if p.State() == PluginStateLoaded {
		p.invokeHook("loaded")
	}
}

// onUnload is called before plugin stop.
func (p *KernelPlugin) onUnload() {
	if p.State() == PluginStateStopping {
		p.invokeHook("unload")
	}
}

// subscribeRpcMethod add or updates a JS function as a named RPC method.
func (p *KernelPlugin) subscribeRpcMethod(name string, descriptions ...string) error {
	p.rpcMethods.Store(name, &RpcMethod{
		Name:         name,
		Descriptions: descriptions,
	})
	return nil
}

// unsubscribeRpcMethod removes a registered RPC method
func (p *KernelPlugin) unsubscribeRpcMethod(name string) error {
	_, ok := p.rpcMethods.LoadAndDelete(name)
	if !ok {
		return nil
	}
	return nil
}

// subscribeEvents subscribes to plugin lifecycle and RPC events, dispatching them to the plugin's JS context.
func (p *KernelPlugin) subscribeEvents(ctx *qjs.Context) (err error) {
	p.handler = func(e string) {
		p.worker.Run(func() (result any, err any) {
			return dispatchEvent(p, ctx, e)
		}, nil, p.context)
	}

	if err = p.bus.Subscribe(PluginEventTypeLifecycle, p.handler); err != nil {
		return
	}
	if err = p.bus.Subscribe(PluginEventTypeRpc, p.handler); err != nil {
		return
	}
	return
}

// unsubscribeEvents unsubscribes from plugin events.
func (p *KernelPlugin) unsubscribeEvents() {
	if p.handler != nil {
		p.bus.Unsubscribe(PluginEventTypeLifecycle, p.handler)
		p.bus.Unsubscribe(PluginEventTypeRpc, p.handler)
	}
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
func (p *KernelPlugin) callRpcMethod(method string, params any) (rpcResult any, rpcError *JsonRpcError) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogDebugf("[plugin:%s] panic in RPC method %q: %v", p.Name, method, r)
			rpcError = &JsonRpcError{
				Code:    JsonRpcErrorCodeInternalError,
				Message: fmt.Sprintf("qjs panic in RPC method %q: %v", method, r),
			}
		}
	}()

	state := p.State()

	if state != PluginStateRunning {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("plugin %s not running (state: %s)", p.Name, p.State()),
		}
	}

	ctx := p.Context()
	if ctx == nil {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("QJS context not initialized for plugin %s", p.Name),
		}
	}

	rpcMethod := p.getRpcMethod(method)
	if rpcMethod == nil {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeMethodNotFound,
			Message: fmt.Sprintf("method not found: %q", method),
		}
	}

	// TODO: 使用事件总线派遣 RPC request
	// TODO: 使用事件总线接受 RPC response
	return
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
func (p *KernelPlugin) getRpcMethod(name string) *RpcMethod {
	value, ok := p.rpcMethods.Load(name)
	if !ok {
		return nil
	}

	method, ok := value.(*RpcMethod)
	if !ok {
		return nil
	}

	return method
}

// invokeHook calls a lifecycle hook (e.g. onload) if it exists, awaiting if it returns a Promise.
func (p *KernelPlugin) invokeHook(name string) {
	ctx := p.Context()
	if ctx == nil {
		return
	}

	id := uuid.NewString()
	event := &PluginLifecycleEvent{
		PluginEvent: &PluginEvent{
			ID:   id,
			Type: PluginEventTypeLifecycle,
		},
		Detail: &PluginLifecycleEventDetail{
			Name: name,
		},
	}

	done := make(chan struct{})
	topic := fmt.Sprintf("%s:%s", PluginEventTypeLifecycle, id)
	handler := func(e string) {
		logging.LogDebugf("[plugin:%s] received lifecycle response event for hook %q: %s", p.Name, name, e)
		close(done)
	}
	if err := p.bus.SubscribeOnce(topic, handler); err != nil {
		logging.LogErrorf("[plugin:%s] subscribe lifecycle response event: %s", p.Name, err)
	}

	await, err := p.worker.RunSync(func() (any, any) {
		return dispatchEvent(p, ctx, event)
	}, p.context)
	if err != nil {
		logging.LogErrorf("[plugin:%s] dispatch lifecycle event: %s", p.Name, err.(error))
		return
	}

	if !await.(bool) {
		// if err := p.bus.Unsubscribe(topic, handler); err != nil {
		// 	logging.LogErrorf("[plugin:%s] unsubscribe lifecycle response event: %s", p.Name, err)
		// }
		close(done)
	}
	<-done
}
