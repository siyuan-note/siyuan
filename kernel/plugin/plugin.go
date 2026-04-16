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
	"sync"

	"github.com/fastschema/qjs"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
)

type PluginState int

const (
	StateLoading PluginState = iota
	StateRunning
	StateErrored
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
// It owns an isolated QJS runtime and serializes all calls into it via mu.
type KernelPlugin struct {
	*model.Petal
	token string // JWT for this plugin

	mu         sync.Mutex
	state      PluginState
	rpcMethods sync.Map // registered JSON-RPC methods

	runtime *qjs.Runtime
	sockets []*websocket.Conn // tracked loopback WebSocket connections
}

func NewKernelPlugin(petal *model.Petal) *KernelPlugin {
	token, _ := model.CreatePluginJWT(petal.Name)
	return &KernelPlugin{
		Petal:      petal,
		token:      token,
		state:      StateStopped,
		rpcMethods: sync.Map{},
	}
}

// State returns the current plugin state (safe for concurrent reads).
func (p *KernelPlugin) State() PluginState {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.state
}

// Start creates the QJS runtime, injects sandbox globals, and evaluates kernel.js.
func (p *KernelPlugin) Start() (retErr error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	defer func() {
		if r := recover(); r != nil {
			p.state = StateErrored
			if p.runtime != nil {
				p.runtime.Close()
				p.runtime = nil
			}
			logging.LogErrorf("[plugin:%s] panic during start: %v", p.Name, r)
			retErr = fmt.Errorf("panic during start: %v", r)
		}
	}()

	p.state = StateLoading

	rt, err := qjs.New()
	if err != nil {
		p.state = StateErrored
		logging.LogErrorf("[plugin:%s] failed to create QJS runtime: %s", p.Name, err)
		return fmt.Errorf("create QJS runtime: %w", err)
	}
	p.runtime = rt

	if err = injectSandboxGlobals(p); err != nil {
		p.state = StateErrored
		p.runtime.Close()
		p.runtime = nil
		logging.LogErrorf("[plugin:%s] failed to inject sandbox globals: %s", p.Name, err)
		return fmt.Errorf("inject sandbox globals: %w", err)
	}

	_, evalErr := p.runtime.Eval(p.Name+"/kernel.js", qjs.Code(p.Kernel.JS))
	if evalErr != nil {
		p.state = StateErrored
		p.runtime.Close()
		p.runtime = nil
		logging.LogErrorf("[plugin:%s] eval error: %s", p.Name, evalErr)
		return evalErr
	}

	p.OnLoad()

	p.state = StateRunning
	logging.LogDebugf("[plugin:%s] started", p.Name)
	return nil
}

// Stop cleanly shuts down the plugin: closes sockets, frees QJS runtime.
func (p *KernelPlugin) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.OnUnload()

	p.rpcMethods.Clear()

	for _, conn := range p.sockets {
		conn.Close()
	}
	p.sockets = p.sockets[:0:0]

	if p.runtime != nil {
		p.runtime.Close()
		p.runtime = nil
	}

	p.state = StateStopped
	logging.LogDebugf("[plugin:%s] stopped", p.Name)
}

// OnLoad is called after plugin start.
func (p *KernelPlugin) OnLoad() {
	p.invokeJsLifecycleHook("onload")
}

// OnUnload is called before plugin stop.
func (p *KernelPlugin) OnUnload() {
	p.invokeJsLifecycleHook("onunload")
}

// BindRpcMethod add or updates a JS function as a named RPC method.
func (p *KernelPlugin) BindRpcMethod(name string, method *qjs.Value) error {
	p.rpcMethods.Store(name, method)
	return nil
}

// UnbindRpcMethod removes a registered RPC method
func (p *KernelPlugin) UnbindRpcMethod(name string, method *qjs.Value) error {
	value, ok := p.rpcMethods.Load(name)
	if !ok {
		return nil
	}

	fn, ok := value.(*qjs.Value)
	if !ok {
		return nil
	}

	if fn.Raw() == method.Raw() {
		p.rpcMethods.Delete(name)
	}
	return nil
}

// CallRpcMethod invokes a registered JS RPC method with the given JSON params.
// Returns the JS function's return value as a Go interface{}.
func (p *KernelPlugin) CallRpcMethod(method string, params interface{}) (retResult interface{}, retErr error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("[plugin:%s] panic in RPC method %q: %v", p.Name, method, r)
			retErr = fmt.Errorf("internal error in method %q: %v", method, r)
		}
	}()

	if p.state != StateRunning {
		return nil, fmt.Errorf("plugin not running (state=%s)", p.state)
	}

	ctx := p.runtime.Context()

	// Convert params to JS value
	var paramVal *qjs.Value
	if params != nil {
		paramsJSON, err := json.Marshal(params)
		if err != nil {
			return nil, fmt.Errorf("marshal params: %w", err)
		}
		paramVal = ctx.ParseJSON(string(paramsJSON))
	} else {
		paramVal = ctx.NewNull()
	}

	fn := p.getRPCMethod(method)
	if fn == nil {
		return nil, fmt.Errorf("method %q not found", method)
	}

	// Call the JS function using ctx.Invoke(fn, thisVal, args...)
	result, err := ctx.Invoke(fn, ctx.Global(), paramVal)
	if err != nil {
		return nil, fmt.Errorf("call %q: %w", method, err)
	}

	// Await if Promise
	if result != nil && result.IsPromise() {
		result, err = result.Await()
		if err != nil {
			return nil, fmt.Errorf("await %q: %w", method, err)
		}
	}

	if result == nil || result.IsNull() || result.IsUndefined() {
		return nil, nil
	}

	// Convert JS result to Go via JSON round-trip using the built-in JSONStringify method.
	jsonStr, stringifyErr := result.JSONStringify()
	if stringifyErr != nil {
		return nil, fmt.Errorf("stringify result: %w", stringifyErr)
	}

	var goResult interface{}
	if err = json.Unmarshal([]byte(jsonStr), &goResult); err != nil {
		// If it's a primitive that doesn't unmarshal cleanly, return the raw string.
		return jsonStr, nil
	}
	return goResult, nil
}

// TrackSocket adds a WebSocket connection to the plugin's tracked list.
func (p *KernelPlugin) TrackSocket(conn *websocket.Conn) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sockets = append(p.sockets, conn)
}

// UntrackSocket removes a WebSocket connection from the plugin's tracked list.
func (p *KernelPlugin) UntrackSocket(conn *websocket.Conn) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i, c := range p.sockets {
		if c == conn {
			p.sockets = append(p.sockets[:i], p.sockets[i+1:]...)
			return
		}
	}
}

func (p *KernelPlugin) getRPCMethod(method string) *qjs.Value {
	value, ok := p.rpcMethods.Load(method)
	if !ok {
		return nil
	}

	fn, ok := value.(*qjs.Value)
	if !ok {
		return nil
	}

	if !fn.IsFunction() {
		return nil
	}

	return fn
}

// getJsContextValue safely retrieves a nested value from the plugin's JS context, returning nil if any step fails.
func (p *KernelPlugin) getJsContextValue(paths []any) (value *qjs.Value, retErr error) {
	defer func() {
		if r := recover(); r != nil {
			value = nil
			retErr = fmt.Errorf("panic during start: %v", r)
		}
	}()

	ctx := p.runtime.Context()
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
func (p *KernelPlugin) invokeJsLifecycleHook(name string, args ...interface{}) (result *qjs.Value, err error) {
	defer func() {
		if r := recover(); r != nil {
			result = nil
			err = fmt.Errorf("panic during start: %v", r)
		}
	}()

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
