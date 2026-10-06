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

package abort

import (
	"fmt"
	"reflect"
	"time"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
)

// signalStateType 是 SignalState 指针的反射类型：SignalOf 在调用 Object.Export() 前先用
// Object.ExportType() 判定接收者是否为本包创建的 AbortSignal。ExportType() 对普通对象返回固定的 map 类型、
// 对动态对象返回宿主类型，都不会访问任何属性；而 Object.Export() 对普通对象会遍历其所有自有可枚举属性并调用
// 它们的访问器：当接收者是 AbortSignal.prototype 本身时（aborted 等访问器就定义在它自己身上），直接 Export()
// 会再次进入这些访问器而无限递归，因此必须先用 ExportType() 过滤。
var signalStateType = reflect.TypeOf((*SignalState)(nil))

// signalListener 是 addEventListener("abort", ...) 登记的一个监听器。
type signalListener struct {
	callback goja.Value // 可调用值，或带 handleEvent 方法的对象
	once     bool
}

// SignalState 是 AbortSignal 的宿主对象实现：自身不暴露任何属性，属性由共享原型上的访问器提供
// （与 CryptoKey 一致），因此 Object.keys()/JSON.stringify() 的结果与浏览器一致。
// 除下面说明的 reason 外，所有字段只在事件循环线程上读写（JS 调用、setTimeout 回调都运行在循环线程），
// 因此不需要加锁。唯一的跨线程访问是 reason：goHooks 的回调可能在取消请求的 goroutine 上执行，随后该
// goroutine 会读取 reason 作为 Promise 的拒绝原因；triggerAbort 在调用 goHooks 之前就写入 reason 且此后再不修改，
// 配合调用方以原子变量记录回调是否已触发，这一读取是安全的（见 siyuan.client.fetch 的 abortHookFired）。
// goHooks 回调自身（例如 context.CancelFunc）由调用方保证并发安全。
type SignalState struct {
	self *goja.Object // 包装自身的 JS 对象，构造后立即回填，用于派发事件时作为 target

	aborted bool
	reason  goja.Value

	onabort   goja.Value // EventHandler：null 或可调用值
	listeners []signalListener

	// goHooks 在 triggerAbort 时按注册顺序同步调用一次，用于让 Go 侧（如 siyuan.client.fetch）
	// 在中止发生的瞬间收到通知；调用点必须在事件循环线程上完成注册，因为可能需要立即触发。
	goHooks []func()

	// dependents 是通过 AbortSignal.any() 以当前信号为源创建的下游信号，中止时按序传播。
	dependents []*SignalState
}

func (s *SignalState) Get(string) goja.Value       { return nil }
func (s *SignalState) Set(string, goja.Value) bool { return false }
func (s *SignalState) Has(string) bool             { return false }
func (s *SignalState) Delete(string) bool          { return false }
func (s *SignalState) Keys() []string              { return nil }

// triggerAbort 执行中止流程：仅在尚未中止时生效，设置 aborted/reason，依次调用 Go 回调、
// onabort 与 addEventListener 注册的监听器，并将中止传播给依赖信号。
func (s *SignalState) triggerAbort(rt *goja.Runtime, reason goja.Value) {
	if s.aborted {
		return
	}
	s.aborted = true
	if reason == nil || goja.IsUndefined(reason) {
		reason = newSignalError(rt, "AbortError", "signal is aborted without reason")
	}
	s.reason = reason

	hooks := s.goHooks
	s.goHooks = nil
	for _, hook := range hooks {
		hook()
	}

	s.dispatchAbortEvent(rt)

	dependents := s.dependents
	s.dependents = nil
	for _, dependent := range dependents {
		dependent.triggerAbort(rt, s.reason)
	}
}

// dispatchAbortEvent 构造一个 type 为 "abort" 的事件对象，依次调用通过 addEventListener 登记的
// 监听器与 onabort；异常只记录日志，不中断后续监听器与依赖信号的通知。
func (s *SignalState) dispatchAbortEvent(rt *goja.Runtime) {
	event := newAbortEvent(rt, s.self)

	invoke := func(callback goja.Value) {
		if callback == nil || goja.IsUndefined(callback) || goja.IsNull(callback) {
			return
		}
		if fn, ok := goja.AssertFunction(callback); ok {
			if _, err := fn(s.self, event); err != nil {
				logging.LogErrorf("AbortSignal abort listener: %v", err)
			}
			return
		}
		if obj := callback.ToObject(rt); obj != nil {
			if fn, ok := goja.AssertFunction(obj.Get("handleEvent")); ok {
				if _, err := fn(obj, event); err != nil {
					logging.LogErrorf("AbortSignal abort listener: %v", err)
				}
			}
		}
	}

	// 登记时拷贝一份快照：触发中的监听器删除自身（once）或新增监听器都不应影响本轮派发。
	listeners := s.listeners
	remaining := make([]signalListener, 0, len(listeners))
	for _, listener := range listeners {
		invoke(listener.callback)
		if !listener.once {
			remaining = append(remaining, listener)
		}
	}
	s.listeners = remaining

	invoke(s.onabort)
}

// Aborted 返回信号是否已经中止。调用方必须在事件循环线程上调用本方法。
func (s *SignalState) Aborted() bool {
	return s.aborted
}

// Reason 返回中止原因，信号尚未中止时为 nil。应在事件循环线程上调用；唯一的例外见 SignalState 的文档：
// AddAbortHook 登记的回调触发之后，其他 goroutine 也可以安全读取。
func (s *SignalState) Reason() goja.Value {
	return s.reason
}

// AddAbortHook 登记一个中止时在事件循环线程调用一次的 Go 回调；若信号已经中止，立即调用。
// 调用方必须在事件循环线程上调用本方法。
func (s *SignalState) AddAbortHook(hook func()) {
	if s.aborted {
		hook()
		return
	}
	s.goHooks = append(s.goHooks, hook)
}

// newSignalError 构造一个 name 为给定值的 Error，供未显式提供 reason 时使用。
// 沙箱没有 DOMException，约定与 globalThis.crypto 一致：用普通 Error 并覆盖 name 属性，
// 调用方应按 error.name 分支而不是 instanceof 判断。
func newSignalError(rt *goja.Runtime, name, message string) goja.Value {
	err := rt.NewGoError(fmt.Errorf("%s", message))
	if setErr := err.Set("name", rt.ToValue(name)); setErr != nil {
		logging.LogErrorf("newSignalError: set name: %v", setErr)
	}
	return err
}

// newAbortEvent 构造派发给 abort 监听器的事件对象。字段与方法参照 DOM Event，但本身是一个冻结的
// 普通对象，不是 Event 的实例；AbortSignal 的 abort 事件从不冒泡、不可取消，因此传播相关方法均为空操作。
func newAbortEvent(rt *goja.Runtime, target *goja.Object) *goja.Object {
	event := rt.NewObject()
	noop := rt.ToValue(func(goja.FunctionCall) goja.Value { return goja.Undefined() })

	lo.Must0(event.Set("type", rt.ToValue("abort")))
	lo.Must0(event.Set("target", target))
	lo.Must0(event.Set("currentTarget", target))
	lo.Must0(event.Set("bubbles", rt.ToValue(false)))
	lo.Must0(event.Set("cancelable", rt.ToValue(false)))
	lo.Must0(event.Set("composed", rt.ToValue(false)))
	lo.Must0(event.Set("defaultPrevented", rt.ToValue(false)))
	lo.Must0(event.Set("isTrusted", rt.ToValue(true)))
	lo.Must0(event.Set("timeStamp", rt.ToValue(float64(time.Now().UnixMilli()))))
	lo.Must0(event.Set("preventDefault", noop))
	lo.Must0(event.Set("stopPropagation", noop))
	lo.Must0(event.Set("stopImmediatePropagation", noop))

	lo.Must0(objectFreeze(rt, event))
	return event
}

// SignalOf 从 JS 值取出 AbortSignal 的宿主状态，只接受由本包创建的 AbortSignal 对象。
func SignalOf(rt *goja.Runtime, value goja.Value, name string) (*SignalState, error) {
	if !isJsValueNotNull(value) {
		return nil, fmt.Errorf("%s must be an AbortSignal", name)
	}
	object := value.ToObject(rt)
	if object == nil || object.ExportType() != signalStateType {
		return nil, fmt.Errorf("%s must be an AbortSignal", name)
	}
	state, ok := object.Export().(*SignalState)
	if !ok {
		return nil, fmt.Errorf("%s must be an AbortSignal", name)
	}
	return state, nil
}
