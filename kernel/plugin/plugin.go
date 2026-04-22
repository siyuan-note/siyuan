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
}

type RpcMethodInfo struct {
	Name         string   `json:"name"`
	Descriptions []string `json:"descriptions"`
}

type R map[string]any

const (
	PluginEventTypeLifecycle = "lifecycle"
	PluginEventTypeRpc       = "rpc"
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

	bus     EventBus.Bus   // Event bus for plugin events and RPC request/response dispatch
	handler func(e []byte) // Event handler subscribed to plugin events

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

		EnableExtendModules(p, rt)

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
func (p *KernelPlugin) start() (retErr error) {
	defer func() {
		if r := recover(); r != nil {
			p.error()
			retErr = fmt.Errorf("goja panic during start: %v", r)
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

	if subscribeErr := p.subscribeEvents(); subscribeErr != nil {
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

// onLoaded is called after plugin start.
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

// subscribeEvents subscribes to plugin lifecycle and RPC events, dispatching them to the plugin's JS runtime.
func (p *KernelPlugin) subscribeEvents() (err error) {
	p.handler = func(e []byte) {
		event := R{}
		lo.Must0(json.Unmarshal([]byte(e), &event))
		p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			return dispatchEvent(p, rt, event)
		}, nil)
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

// callRpcMethod invokes a registered JS RPC method via the event bus and awaits the response.
func (p *KernelPlugin) callRpcMethod(method string, params any) (rpcResult any, rpcError *JsonRpcError) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogDebugf("[plugin:%s] panic in RPC method %q: %v", p.Name, method, r)
			rpcError = &JsonRpcError{
				Code:    JsonRpcErrorCodeInternalError,
				Message: fmt.Sprintf("goja panic in RPC method %q: %v", method, r),
			}
		}
	}()

	if p.State() != PluginStateRunning {
		return nil, &JsonRpcError{
			Code:    JsonRpcErrorCodeInternalError,
			Message: fmt.Sprintf("plugin %s not running (state: %s)", p.Name, p.State()),
		}
	}

	id := uuid.NewString()
	topic := fmt.Sprintf("%s:%s", PluginEventTypeRpc, id)

	done := make(chan string, 1)
	handler := func(e string) { done <- e }
	if err := p.bus.SubscribeOnce(topic, handler); err != nil {
		return nil, &JsonRpcError{Code: JsonRpcErrorCodeInternalError, Message: err.Error()}
	}

	event := R{
		"id":   id,
		"type": PluginEventTypeRpc,
		"detail": R{
			"method": method,
			"params": params,
		},
	}

	result, dispatchErr := p.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		return dispatchEvent(p, rt, event)
	})
	if dispatchErr != nil {
		if err := p.bus.Unsubscribe(topic, handler); err != nil {
			logging.LogErrorf("[plugin:%s] unsubscribe rpc response event: %s", p.Name, err)
		}
		return nil, &JsonRpcError{Code: JsonRpcErrorCodeInternalError, Message: fmt.Sprintf("%v", dispatchErr)}
	}

	if await, _ := result.(bool); !await {
		if err := p.bus.Unsubscribe(topic, handler); err != nil {
			logging.LogErrorf("[plugin:%s] unsubscribe rpc response event: %s", p.Name, err)
		}
		return nil, &JsonRpcError{Code: JsonRpcErrorCodeMethodNotFound, Message: fmt.Sprintf("method not found: %q", method)}
	}

	resultJSON := <-done
	if err := json.Unmarshal([]byte(resultJSON), &rpcResult); err != nil {
		return nil, &JsonRpcError{Code: JsonRpcErrorCodeInternalError, Message: fmt.Sprintf("unmarshal result: %v", err)}
	}
	return rpcResult, nil
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

// invokeHook calls a lifecycle hook (e.g. onload) if it exists, awaiting if it returns a Promise.
func (p *KernelPlugin) invokeHook(name string) {
	id := uuid.NewString()
	event := R{
		"id":   id,
		"type": PluginEventTypeLifecycle,
		"detail": R{
			"name": name,
		},
	}

	done := make(chan struct{})
	handler := func(e string) {
		logging.LogDebugf("[plugin:%s] received lifecycle response event for hook %q: %s", p.Name, name, e)
		close(done)
	}
	if err := p.bus.SubscribeOnce(id, handler); err != nil {
		logging.LogErrorf("[plugin:%s] subscribe lifecycle response event: %s", p.Name, err)
		return
	}

	await, err := p.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		return dispatchEvent(p, rt, event)
	})
	if err != nil {
		logging.LogErrorf("[plugin:%s] dispatch lifecycle event: %s", p.Name, err)
		return
	}

	if await, _ := await.(bool); !await {
		if err := p.bus.Unsubscribe(id, handler); err != nil {
			logging.LogErrorf("[plugin:%s] unsubscribe lifecycle response event: %s", p.Name, err)
		}
		close(done)
	}
	<-done
}
