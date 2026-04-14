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
	Name      string
	TokenFunc func() string // injected by PluginManager; returns API token

	mu       sync.Mutex
	state    PluginState
	runtime  *qjs.Runtime
	rpcFuncs map[string]*qjs.Value // registered JSON-RPC methods
	regOpen  bool                  // true while rpc.register is allowed
	sockets  []*websocket.Conn     // tracked loopback WebSocket connections
}

func NewKernelPlugin(name string) *KernelPlugin {
	return &KernelPlugin{
		Name:     name,
		state:    StateStopped,
		rpcFuncs: make(map[string]*qjs.Value),
	}
}

// State returns the current plugin state (safe for concurrent reads).
func (p *KernelPlugin) State() PluginState {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.state
}

// Start creates the QJS runtime, injects sandbox globals, and evaluates kernel.js.
// jsCode is the content of the plugin's kernel.js file.
func (p *KernelPlugin) Start(jsCode string) (retErr error) {
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
	p.rpcFuncs = make(map[string]*qjs.Value)
	p.regOpen = true

	rt, err := qjs.New()
	if err != nil {
		p.state = StateErrored
		logging.LogErrorf("[plugin:%s] failed to create QJS runtime: %s", p.Name, err)
		return fmt.Errorf("create QJS runtime: %w", err)
	}
	p.runtime = rt

	if err = injectSandboxGlobals(p); err != nil {
		p.state = StateErrored
		rt.Close()
		p.runtime = nil
		logging.LogErrorf("[plugin:%s] failed to inject sandbox globals: %s", p.Name, err)
		return fmt.Errorf("inject sandbox globals: %w", err)
	}

	ctx := rt.Context()
	_, evalErr := ctx.Eval(jsCode)
	p.regOpen = false // close registration window

	if evalErr != nil {
		p.state = StateErrored
		rt.Close()
		p.runtime = nil
		logging.LogErrorf("[plugin:%s] eval error: %s", p.Name, evalErr)
		return fmt.Errorf("eval kernel.js: %w", evalErr)
	}

	p.state = StateRunning
	logging.LogInfof("[plugin:%s] started, %d RPC methods registered", p.Name, len(p.rpcFuncs))
	return nil
}

// Stop cleanly shuts down the plugin: closes sockets, frees QJS runtime.
func (p *KernelPlugin) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, conn := range p.sockets {
		conn.Close()
	}
	p.sockets = nil

	if p.runtime != nil {
		p.runtime.Close()
		p.runtime = nil
	}

	p.rpcFuncs = make(map[string]*qjs.Value)
	p.state = StateStopped
	logging.LogInfof("[plugin:%s] stopped", p.Name)
}

// RegisterRPCMethod registers a JS function as a named RPC method.
// Called from within the QJS sandbox during kernel.js evaluation.
func (p *KernelPlugin) RegisterRPCMethod(name string, fn *qjs.Value) error {
	// mu is already held by the eval goroutine via Start()
	if !p.regOpen {
		return fmt.Errorf("rpc: registration closed")
	}
	if _, exists := p.rpcFuncs[name]; exists {
		return fmt.Errorf("rpc: method %q already registered", name)
	}
	p.rpcFuncs[name] = fn
	return nil
}

// CallRPCMethod invokes a registered JS RPC method with the given JSON params.
// Returns the JS function's return value as a Go interface{}.
func (p *KernelPlugin) CallRPCMethod(method string, params interface{}) (retResult interface{}, retErr error) {
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

	fn, ok := p.rpcFuncs[method]
	if !ok {
		return nil, fmt.Errorf("method %q not found", method)
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
