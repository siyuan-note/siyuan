// SiYuan - From thought to insight, with agents
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
	"fmt"
	"reflect"

	"github.com/dop251/goja"
	"github.com/samber/lo"
)

// abortControllerState 是 AbortController 的宿主对象实现：自身不暴露任何属性，signal/abort 由共享原型上的访问器与方法提供。
type abortControllerState struct {
	signal *abortSignalState
}

func (c *abortControllerState) Get(string) goja.Value       { return nil }
func (c *abortControllerState) Set(string, goja.Value) bool { return false }
func (c *abortControllerState) Has(string) bool             { return false }
func (c *abortControllerState) Delete(string) bool          { return false }
func (c *abortControllerState) Keys() []string              { return nil }

// abortControllerStateType 用于在 Object.Export() 前用 Object.ExportType() 做判定，原因见 abortSignalStateType
// 的注释：AbortController.prototype 本身作为 receiver 时，直接 Export() 会因 signal 访问器无限递归。
var abortControllerStateType = reflect.TypeOf((*abortControllerState)(nil))

// EnableAbortAPI 把 AbortController 与 AbortSignal 挂到 runtime 的 globalThis，调用方式与
// url、buffer、console、encoding 一致，失败时 panic。
//
// 与规范的已知差异（与本沙箱其它构造函数一致）：实例不是 AbortController/AbortSignal 的真正
// ECMAScript 类，不用 new 直接调用构造函数也不会抛错；AbortSignal 本应完全不可直接构造
// （含 new 调用），这里仍沿用“不用 new 不抛错”的沙箱惯例，而不是单独为它实现更贴近规范的拒绝。
// addEventListener 的 options 只支持 {once}，capture/passive/signal 会被静默忽略。
func EnableAbortAPI(rt *goja.Runtime) {
	if err := registerAbortAPI(rt); err != nil {
		panic(err)
	}
}

// registerAbortAPI 构造并挂载 AbortController 与 AbortSignal。
func registerAbortAPI(rt *goja.Runtime) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("registerAbortAPI: %v", r)
		}
	}()

	signalPrototype := lo.Must(newAbortSignalPrototype(rt))
	signalCtor := lo.Must(newAbortSignalConstructor(rt, signalPrototype))
	lo.Must0(rt.Set("AbortSignal", signalCtor))

	controllerPrototype := lo.Must(newAbortControllerPrototype(rt, signalCtor))
	controllerCtor := newAbortControllerConstructor(rt, controllerPrototype, signalCtor)
	lo.Must0(rt.Set("AbortController", controllerCtor))
	return
}

// newAbortSignalObject 创建一个包装给定状态的 AbortSignal 对象，并绑定到共享原型。
func newAbortSignalObject(rt *goja.Runtime, prototype *goja.Object, state *abortSignalState) *goja.Object {
	object := rt.NewDynamicObject(state)
	lo.Must0(object.SetPrototype(prototype))
	state.self = object
	return object
}

// newAbortSignalConstructor 构造 AbortSignal 全局构造函数及其静态方法 abort/timeout/any。
func newAbortSignalConstructor(rt *goja.Runtime, prototype *goja.Object) (*goja.Object, error) {
	ctor := rt.ToValue(func(call goja.ConstructorCall) *goja.Object {
		panic(rt.NewTypeError("Illegal constructor"))
	}).(*goja.Object)

	if err := ctor.Set("prototype", prototype); err != nil {
		return nil, err
	}
	if err := prototype.Set("constructor", ctor); err != nil {
		return nil, err
	}

	// AbortSignal.abort(reason?) -> 返回一个已经中止的新信号。
	if err := ctor.Set("abort", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		state := &abortSignalState{}
		object := newAbortSignalObject(rt, prototype, state)
		reason := call.Argument(0)
		if goja.IsUndefined(reason) {
			reason = nil // 让 triggerAbort 套用默认的 AbortError
		}
		state.triggerAbort(rt, reason)
		return object
	})); err != nil {
		return nil, err
	}

	// AbortSignal.timeout(milliseconds) -> 到时后以 TimeoutError 中止的新信号。
	if err := ctor.Set("timeout", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		milliseconds := call.Argument(0).ToInteger()
		if milliseconds < 0 {
			milliseconds = 0
		}

		state := &abortSignalState{}
		object := newAbortSignalObject(rt, prototype, state)

		setTimeout, ok := goja.AssertFunction(rt.GlobalObject().Get("setTimeout"))
		if !ok {
			panic(rt.NewTypeError("globalThis.setTimeout is not available"))
		}
		if _, err := setTimeout(goja.Undefined(), rt.ToValue(func(goja.FunctionCall) goja.Value {
			state.triggerAbort(rt, newAbortSignalError(rt, "TimeoutError", "signal timed out"))
			return goja.Undefined()
		}), rt.ToValue(milliseconds)); err != nil {
			panic(err)
		}
		return object
	})); err != nil {
		return nil, err
	}

	// AbortSignal.any(signals) -> 任一源信号中止时跟随中止的新信号；源信号已中止则立即中止。
	if err := ctor.Set("any", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		sources := abortSignalArrayOf(rt, call.Argument(0))

		state := &abortSignalState{}
		object := newAbortSignalObject(rt, prototype, state)

		for _, source := range sources {
			if source.aborted {
				state.triggerAbort(rt, source.reason)
				break
			}
		}
		if !state.aborted {
			for _, source := range sources {
				source.dependents = append(source.dependents, state)
			}
		}
		return object
	})); err != nil {
		return nil, err
	}

	return ctor, nil
}

// abortSignalArrayOf 读取 AbortSignal.any() 的 signals 参数：接受数组，数组之外的可迭代对象未支持。
func abortSignalArrayOf(rt *goja.Runtime, value goja.Value) []*abortSignalState {
	if !isJsArray(rt, value) {
		panic(rt.NewTypeError("signals must be an array of AbortSignal"))
	}
	object := value.ToObject(rt)
	length := int64(object.Get("length").ToInteger())

	states := make([]*abortSignalState, 0, length)
	for i := int64(0); i < length; i++ {
		state, err := abortSignalOf(rt, object.Get(fmt.Sprint(i)), fmt.Sprintf("signals[%d]", i))
		if err != nil {
			panic(rt.NewTypeError(err.Error()))
		}
		states = append(states, state)
	}
	return states
}

// newAbortSignalPrototype 构造 AbortSignal.prototype：aborted/reason/onabort 访问器，
// throwIfAborted、addEventListener、removeEventListener、dispatchEvent 方法。
func newAbortSignalPrototype(rt *goja.Runtime) (*goja.Object, error) {
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *abortSignalState {
		state, err := abortSignalOf(rt, call.This, "this")
		if err != nil {
			panic(rt.NewTypeError("AbortSignal.prototype.%s called on an incompatible receiver", method))
		}
		return state
	}

	accessor := func(name string, get func(*abortSignalState) goja.Value) error {
		getter := rt.ToValue(func(call goja.FunctionCall) goja.Value {
			return get(self(call, name))
		})
		return prototype.DefineAccessorProperty(name, getter, nil, goja.FLAG_TRUE, goja.FLAG_TRUE)
	}

	if err := accessor("aborted", func(s *abortSignalState) goja.Value { return rt.ToValue(s.aborted) }); err != nil {
		return nil, err
	}
	if err := accessor("reason", func(s *abortSignalState) goja.Value {
		if s.reason == nil {
			return goja.Undefined()
		}
		return s.reason
	}); err != nil {
		return nil, err
	}

	onabortGetter := rt.ToValue(func(call goja.FunctionCall) goja.Value {
		s := self(call, "onabort")
		if s.onabort == nil {
			return goja.Null()
		}
		return s.onabort
	})
	onabortSetter := rt.ToValue(func(call goja.FunctionCall) goja.Value {
		s := self(call, "onabort")
		handler := call.Argument(0)
		if _, ok := goja.AssertFunction(handler); ok {
			s.onabort = handler
		} else {
			s.onabort = nil
		}
		return goja.Undefined()
	})
	if err := prototype.DefineAccessorProperty("onabort", onabortGetter, onabortSetter, goja.FLAG_TRUE, goja.FLAG_TRUE); err != nil {
		return nil, err
	}

	if err := prototype.Set("throwIfAborted", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		s := self(call, "throwIfAborted")
		if s.aborted {
			panic(s.reason)
		}
		return goja.Undefined()
	})); err != nil {
		return nil, err
	}

	if err := prototype.Set("addEventListener", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		s := self(call, "addEventListener")
		if call.Argument(0).String() != "abort" {
			return goja.Undefined()
		}
		callback := call.Argument(1)
		if !isJsValueNotNull(callback) {
			return goja.Undefined()
		}

		once := false
		if options := call.Argument(2); isJsValueNotNull(options) {
			if optionsObj := options.ToObject(rt); optionsObj != nil {
				once = optionsObj.Get("once").ToBoolean()
			}
		}

		for _, existing := range s.listeners {
			if existing.callback.SameAs(callback) {
				return goja.Undefined()
			}
		}
		s.listeners = append(s.listeners, abortListener{callback: callback, once: once})
		return goja.Undefined()
	})); err != nil {
		return nil, err
	}

	if err := prototype.Set("removeEventListener", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		s := self(call, "removeEventListener")
		if call.Argument(0).String() != "abort" {
			return goja.Undefined()
		}
		callback := call.Argument(1)

		remaining := make([]abortListener, 0, len(s.listeners))
		for _, existing := range s.listeners {
			if !existing.callback.SameAs(callback) {
				remaining = append(remaining, existing)
			}
		}
		s.listeners = remaining
		return goja.Undefined()
	})); err != nil {
		return nil, err
	}

	if err := prototype.Set("dispatchEvent", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		s := self(call, "dispatchEvent")
		eventType := ""
		if event := call.Argument(0); isJsValueNotNull(event) {
			if eventObj := event.ToObject(rt); eventObj != nil {
				eventType = eventObj.Get("type").String()
			}
		}
		if eventType == "abort" {
			s.dispatchAbortEvent(rt)
		}
		return rt.ToValue(true)
	})); err != nil {
		return nil, err
	}

	if err := prototype.DefineDataPropertySymbol(goja.SymToStringTag, rt.ToValue("AbortSignal"),
		goja.FLAG_FALSE, goja.FLAG_TRUE, goja.FLAG_FALSE); err != nil {
		return nil, err
	}
	return prototype, nil
}

// newAbortControllerConstructor 构造 AbortController 全局构造函数。
func newAbortControllerConstructor(rt *goja.Runtime, prototype *goja.Object, signalCtor *goja.Object) *goja.Object {
	signalPrototype := signalCtor.Get("prototype").ToObject(rt)

	ctor := rt.ToValue(func(call goja.ConstructorCall) *goja.Object {
		signalState := &abortSignalState{}
		newAbortSignalObject(rt, signalPrototype, signalState)

		controllerState := &abortControllerState{signal: signalState}
		object := rt.NewDynamicObject(controllerState)
		lo.Must0(object.SetPrototype(call.This.Prototype()))
		return object
	}).(*goja.Object)

	lo.Must0(ctor.Set("prototype", prototype))
	lo.Must0(prototype.Set("constructor", ctor))
	return ctor
}

// newAbortControllerPrototype 构造 AbortController.prototype：signal 访问器与 abort 方法。
func newAbortControllerPrototype(rt *goja.Runtime, signalCtor *goja.Object) (*goja.Object, error) {
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *abortControllerState {
		if call.This != nil {
			if object := call.This.ToObject(rt); object != nil && object.ExportType() == abortControllerStateType {
				if state, ok := object.Export().(*abortControllerState); ok {
					return state
				}
			}
		}
		panic(rt.NewTypeError("AbortController.prototype.%s called on an incompatible receiver", method))
	}

	getter := rt.ToValue(func(call goja.FunctionCall) goja.Value {
		state := self(call, "signal")
		return state.signal.self
	})
	if err := prototype.DefineAccessorProperty("signal", getter, nil, goja.FLAG_TRUE, goja.FLAG_TRUE); err != nil {
		return nil, err
	}

	if err := prototype.Set("abort", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		state := self(call, "abort")
		state.signal.triggerAbort(rt, call.Argument(0))
		return goja.Undefined()
	})); err != nil {
		return nil, err
	}

	if err := prototype.DefineDataPropertySymbol(goja.SymToStringTag, rt.ToValue("AbortController"),
		goja.FLAG_FALSE, goja.FLAG_TRUE, goja.FLAG_FALSE); err != nil {
		return nil, err
	}
	return prototype, nil
}
